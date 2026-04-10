"""
playwright_utils.py

Session management (login, save, delete) is handled via Playwright's browser.
Prompt sending is handled via web_session_client (curl_cffi + internal web APIs)
— this completely avoids Cloudflare bot detection and broken UI selectors.
"""
import os
import json
import time
import logging
import shutil
import threading
import subprocess
import tempfile
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

# Fix LD_LIBRARY_PATH so Chromium can find its shared libs on NixOS
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

from config import AI_CONFIGS, SESSIONS_DIR, get_active_model, resolve_model
from key_store import (
    save_api_key, load_api_key, delete_api_key, api_key_exists,
    save_session_state, load_session_state, delete_session_state, session_state_exists,
    migrate_legacy_files,
)
from web_session_client import send_prompt_via_session

logger = logging.getLogger(__name__)

# ─── Remote browser session state ────────────────────────────────────────────
_remote_sessions: Dict[str, Dict[str, Any]] = {}
_remote_lock = threading.Lock()


def get_session_path(ai_id: str) -> str:
    return os.path.join(SESSIONS_DIR, f"{ai_id}_state.json")


def session_exists(ai_id: str) -> bool:
    """True if we have credentials or the AI needs none (e.g. Pollinations)."""
    from config import AI_CONFIGS
    cfg = AI_CONFIGS.get(ai_id, {})
    if cfg.get("auth_mode") == "none":
        return True
    return api_key_exists(ai_id) or session_state_exists(ai_id)


def get_session_info(ai_id: str) -> dict:
    has_key = api_key_exists(ai_id)
    has_state = session_state_exists(ai_id)
    has = has_key or has_state
    path = get_session_path(ai_id)
    mtime_str = None
    if os.path.exists(path):
        mtime_str = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(os.path.getmtime(path)))
    return {"hasSession": has, "sessionFile": path if has_state else None, "lastUsed": mtime_str}


def delete_session(ai_id: str) -> Tuple[bool, str]:
    deleted = []
    if api_key_exists(ai_id):
        delete_api_key(ai_id)
        deleted.append("API key")
    if session_state_exists(ai_id):
        delete_session_state(ai_id)
        deleted.append("cookies")
    if deleted:
        return True, f"Deleted {' and '.join(deleted)} for {ai_id}"
    return False, f"No session found for {ai_id}"


# ─── Browser launch helpers (for login flow only) ────────────────────────────

def _launch_browser(playwright, headless: bool = True, storage_state: Optional[str] = None):
    from config import find_chromium  # noqa: PLC0415
    _chrome_exe = find_chromium()
    _launch_kw: dict = {
        "headless": headless,
        "args": ["--no-sandbox", "--disable-setuid-sandbox",
                 "--disable-dev-shm-usage", "--disable-gpu"],
    }
    if _chrome_exe:
        _launch_kw["executable_path"] = _chrome_exe
    browser = playwright.chromium.launch(**_launch_kw)
    context_kwargs: dict = {
        "viewport": {"width": 1280, "height": 900},
        "user_agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
        ),
    }
    if storage_state and os.path.exists(storage_state):
        context_kwargs["storage_state"] = storage_state
    context = browser.new_context(**context_kwargs)
    return browser, context


def create_session_interactive(ai_id: str) -> Tuple[bool, str]:
    """
    Launch a visible browser window for the user to log in manually.
    Saves the storage state (cookies + localStorage) after the browser closes.
    """
    from playwright.sync_api import sync_playwright

    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False, f"Unknown AI: {ai_id}"

    session_path = get_session_path(ai_id)
    logger.info("Creating session for %s — opening browser for manual login…", ai_id)

    try:
        with sync_playwright() as p:
            browser, context = _launch_browser(p, headless=False)
            page = context.new_page()
            page.goto(config["login_url"])

            logger.info("Browser open for %s. Log in, then close the browser.", ai_id)
            try:
                page.wait_for_event("close", timeout=300_000)
            except Exception:
                pass

            try:
                context.storage_state(path=session_path)
                logger.info("Session saved for %s at %s", ai_id, session_path)
                # Also persist to KV so the session survives filesystem resets
                try:
                    with open(session_path) as _f:
                        import json as _json_mod
                        _state = _json_mod.load(_f)
                    save_session_state(ai_id, _state)
                except Exception as _exc:
                    logger.warning("KV save after browser login failed for %s: %s", ai_id, _exc)
                return True, f"Session created and saved for {config['name']}"
            except Exception as exc:
                logger.error("Failed to save session for %s: %s", ai_id, exc)
                return False, f"Failed to save session: {exc}"
    except Exception as exc:
        logger.error("Error creating session for %s: %s", ai_id, exc)
        return False, str(exc)


# ─── Sending prompts (via internal web API, NOT browser UI) ──────────────────

def send_prompt(ai_id: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to the specified AI.
    Tries API key first (for ChatGPT/Claude), then falls back to session cookies.
    Returns (success, response_text, error_message).
    """
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False, "", f"Unknown AI: {ai_id}"

    if not session_exists(ai_id):
        return False, "", (
            f"No session found for {ai_id}. "
            "Please log in on the Sessions page first."
        )

    model = resolve_model(ai_id, get_active_model(ai_id))
    logger.info("Sending prompt to %s (model=%s, %d chars)", ai_id, model, len(prompt))

    # Pollinations — no auth needed, send directly
    if ai_id == "pollinations":
        from web_session_client import send_pollinations
        return send_pollinations(model, prompt)

    # Check for API key first (bypasses Cloudflare for ChatGPT/Claude/Groq)
    api_key = load_api_key(ai_id)
    if api_key:
        from web_session_client import send_via_api_key
        return send_via_api_key(ai_id, api_key, model, prompt)

    session_path = get_session_path(ai_id)
    # If file is missing/empty, try to restore from KV on the fly
    if not os.path.exists(session_path) or os.path.getsize(session_path) <= 10:
        state = load_session_state(ai_id)
        if state:
            import json as _json_mod
            os.makedirs(os.path.dirname(session_path), exist_ok=True)
            try:
                with open(session_path, "w") as _f:
                    _json_mod.dump(state, _f)
                logger.info("Restored %s session file from KV on-demand", ai_id)
            except Exception as _exc:
                logger.warning("On-demand restore failed for %s: %s", ai_id, _exc)
        if not os.path.exists(session_path) or os.path.getsize(session_path) <= 10:
            return False, "", (
                f"No valid session for {ai_id}. "
                "Please import cookies or an API key on the Sessions page."
            )

    success, text, error = send_prompt_via_session(ai_id, session_path, model, prompt)
    return success, text, error


def check_ai_available(ai_id: str) -> bool:
    return session_exists(ai_id)
