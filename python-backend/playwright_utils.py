import os
import json
import time
import logging
import shutil
import threading
import subprocess
import tempfile
import base64
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

# Fix LD_LIBRARY_PATH so Chromium can find its shared libs on Replit/NixOS
_STUB_LIB_DIR = os.path.join(os.path.dirname(__file__), "lib")

def _fix_ld_library_path():
    parts = [_STUB_LIB_DIR]
    for var in ("REPLIT_LD_LIBRARY_PATH", "REPLIT_PYTHON_LD_LIBRARY_PATH", "LD_LIBRARY_PATH"):
        val = os.environ.get(var, "")
        if val:
            parts.extend(val.split(":"))
    unique = list(dict.fromkeys(p for p in parts if p))
    os.environ["LD_LIBRARY_PATH"] = ":".join(unique)

_fix_ld_library_path()

from playwright.sync_api import sync_playwright, Browser, BrowserContext, Page, TimeoutError as PlaywrightTimeout

from config import AI_CONFIGS, SESSIONS_DIR, DEFAULT_TIMEOUT, MAX_RESPONSE_WAIT, get_model_url_param

logger = logging.getLogger(__name__)

# ─── Remote browser session state ────────────────────────────────────────────
# Keyed by ai_id, holds live browser session info for the "Desktop" login flow

_remote_sessions: Dict[str, Dict[str, Any]] = {}
_remote_lock = threading.Lock()

def _get_free_display() -> int:
    """Return a free X display number (99..199)."""
    for num in range(99, 200):
        lock_file = f"/tmp/.X{num}-lock"
        if not os.path.exists(lock_file):
            return num
    return 99


def _start_xvfb(display: int) -> Optional[subprocess.Popen]:
    """Start an Xvfb process on :display and return it (or None on failure)."""
    xvfb = shutil.which("Xvfb") or shutil.which("xvfb-run")
    if not xvfb:
        logger.warning("Xvfb not found; browser may not be able to open without a display")
        return None
    try:
        # Use Xvfb directly if available, else fall back to xvfb-run
        if "xvfb-run" in xvfb:
            return None  # xvfb-run wraps a command; we can't use it as a daemon easily
        proc = subprocess.Popen(
            ["Xvfb", f":{display}", "-screen", "0", "1280x900x24", "-ac"],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        time.sleep(1)  # give Xvfb a moment to start
        return proc
    except Exception as exc:
        logger.warning("Failed to start Xvfb: %s", exc)
        return None


def get_remote_session(ai_id: str) -> Optional[Dict[str, Any]]:
    with _remote_lock:
        return _remote_sessions.get(ai_id)


def close_remote_session(ai_id: str):
    with _remote_lock:
        info = _remote_sessions.pop(ai_id, None)
    if info:
        try:
            info.get("context") and info["context"].close()
        except Exception:
            pass
        try:
            info.get("browser") and info["browser"].close()
        except Exception:
            pass
        try:
            info.get("playwright") and info["playwright"].stop()
        except Exception:
            pass
        try:
            xvfb_proc = info.get("xvfb_proc")
            xvfb_proc and xvfb_proc.terminate()
        except Exception:
            pass


def get_session_path(ai_id: str) -> str:
    return os.path.join(SESSIONS_DIR, f"{ai_id}_state.json")


def session_exists(ai_id: str) -> bool:
    path = get_session_path(ai_id)
    return os.path.exists(path) and os.path.getsize(path) > 10


def get_session_info(ai_id: str) -> dict:
    path = get_session_path(ai_id)
    if os.path.exists(path):
        mtime = os.path.getmtime(path)
        return {
            "hasSession": True,
            "sessionFile": path,
            "lastUsed": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(mtime)),
        }
    return {"hasSession": False, "sessionFile": None, "lastUsed": None}


def launch_browser(playwright, headless: bool = True, storage_state: Optional[str] = None):
    browser = playwright.chromium.launch(
        headless=headless,
        args=["--no-sandbox", "--disable-setuid-sandbox"],
    )
    context_kwargs = {
        "viewport": {"width": 1280, "height": 900},
        "user_agent": (
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    }
    if storage_state and os.path.exists(storage_state):
        context_kwargs["storage_state"] = storage_state
    context = browser.new_context(**context_kwargs)
    return browser, context


def create_session_interactive(ai_id: str) -> Tuple[bool, str]:
    """
    Launch a visible browser window for the user to log in manually.
    Saves the storage state after the browser is closed.
    """
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False, f"Unknown AI: {ai_id}"

    session_path = get_session_path(ai_id)
    logger.info(f"Creating session for {ai_id}. Opening browser for manual login...")

    try:
        with sync_playwright() as p:
            browser, context = launch_browser(p, headless=False)
            page = context.new_page()
            page.goto(config["url"])

            logger.info(f"Browser opened for {ai_id}. Waiting for user to log in and close...")
            logger.info("Please log in to the AI service, then close the browser window.")

            browser.on("disconnected", lambda: None)
            try:
                page.wait_for_event("close", timeout=300000)
            except Exception:
                pass

            try:
                context.storage_state(path=session_path)
                logger.info(f"Session saved for {ai_id} at {session_path}")
                return True, f"Session created and saved for {config['name']}"
            except Exception as e:
                logger.error(f"Failed to save session for {ai_id}: {e}")
                return False, f"Failed to save session: {e}"
    except Exception as e:
        logger.error(f"Error creating session for {ai_id}: {e}")
        return False, str(e)


def delete_session(ai_id: str) -> Tuple[bool, str]:
    session_path = get_session_path(ai_id)
    if os.path.exists(session_path):
        os.remove(session_path)
        return True, f"Session deleted for {ai_id}"
    return False, f"No session found for {ai_id}"


def check_captcha(page: Page) -> bool:
    captcha_indicators = [
        "captcha", "hcaptcha", "recaptcha", "verify you are human",
        "robot", "security check"
    ]
    try:
        content = page.content().lower()
        return any(indicator in content for indicator in captcha_indicators)
    except Exception:
        return False


def check_session_expired(page: Page, config: dict) -> bool:
    try:
        login_indicator = config.get("login_indicator", "")
        if login_indicator:
            return not page.is_visible(login_indicator)
    except Exception:
        return False
    return False


def wait_for_response_complete(page: Page, config: dict) -> str:
    """
    Wait for the AI to finish responding and extract the final text.
    Polls until the send button is re-enabled (meaning AI is done).
    """
    selectors = config.get("selectors", {})
    response_selector = selectors.get("response", "")
    done_selector = selectors.get("response_done", "")

    start_time = time.time()
    max_wait_ms = MAX_RESPONSE_WAIT / 1000

    time.sleep(2)

    while (time.time() - start_time) < max_wait_ms:
        if done_selector:
            try:
                if page.is_visible(done_selector):
                    break
            except Exception:
                pass
        time.sleep(1)

    if not response_selector:
        return ""

    try:
        elements = page.query_selector_all(response_selector)
        if elements:
            last = elements[-1]
            return last.inner_text()
    except Exception as e:
        logger.error(f"Error extracting response: {e}")

    return ""


def send_prompt(ai_id: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to the specified AI using a saved session.
    Returns (success, response_text, error_message)
    """
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False, "", f"Unknown AI: {ai_id}"

    session_path = get_session_path(ai_id)
    if not session_exists(ai_id):
        return False, "", f"No session found for {ai_id}. Please create a session first."

    selectors = config.get("selectors", {})

    try:
        with sync_playwright() as p:
            browser, context = launch_browser(p, headless=True, storage_state=session_path)
            page = context.new_page()

            # Build the URL — for ChatGPT, append ?model=<urlParam> if a model is selected
            nav_url = config["url"]
            url_param = get_model_url_param(ai_id)
            if url_param:
                nav_url = f"{nav_url}/?model={url_param}"
            logger.info(f"Navigating to {nav_url} for {ai_id}")
            page.goto(nav_url, wait_until="networkidle", timeout=DEFAULT_TIMEOUT)

            if check_captcha(page):
                browser.close()
                return False, "", "CAPTCHA detected. Please open the session and solve it manually."

            input_selector = selectors.get("input", "")
            if not input_selector:
                browser.close()
                return False, "", f"No input selector configured for {ai_id}"

            try:
                page.wait_for_selector(input_selector, timeout=DEFAULT_TIMEOUT)
            except PlaywrightTimeout:
                browser.close()
                return False, "", f"Input field not found. Session may be expired for {ai_id}."

            if check_session_expired(page, config):
                browser.close()
                delete_session(ai_id)
                return False, "", f"Session expired for {ai_id}. Please re-login."

            page.fill(input_selector, prompt)
            time.sleep(0.5)

            send_selector = selectors.get("send_button", "")
            if send_selector:
                try:
                    page.click(send_selector, timeout=10000)
                except Exception:
                    page.keyboard.press("Enter")
            else:
                page.keyboard.press("Enter")

            response_text = wait_for_response_complete(page, config)

            try:
                context.storage_state(path=session_path)
            except Exception:
                pass

            browser.close()
            return True, response_text, ""

    except Exception as e:
        logger.error(f"Error sending prompt to {ai_id}: {e}")
        return False, "", str(e)


def check_ai_available(ai_id: str) -> bool:
    """Quick check if the AI is reachable (just HTTP, no browser)."""
    import urllib.request
    config = AI_CONFIGS.get(ai_id, {})
    url = config.get("url", "")
    if not url:
        return False
    try:
        req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=5):
            return True
    except Exception:
        return False
