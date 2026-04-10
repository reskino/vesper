"""
session_browser_worker.py
Runs inside an xvfb-run virtual display.
Launches a visible browser, takes periodic screenshots, and handles
simple file-based commands (save / quit / click / type / key).

Usage (invoked by main.py):
    xvfb-run -a python3 session_browser_worker.py <ai_id> <work_dir>
"""

import os
import sys
import json
import time
import signal
import logging

# Ensure Chrome can find its shared libraries in the Replit/NixOS environment.
# REPLIT_LD_LIBRARY_PATH / REPLIT_PYTHON_LD_LIBRARY_PATH have all the Nix-store
# library paths, but LD_LIBRARY_PATH itself is empty for the Chrome subprocess.
_STUB_LIB_DIR = os.path.join(os.path.dirname(__file__), "lib")

def _fix_ld_library_path():
    parts = [_STUB_LIB_DIR]  # our stub libgbm.so.1 etc come first
    for var in ("REPLIT_LD_LIBRARY_PATH", "REPLIT_PYTHON_LD_LIBRARY_PATH", "LD_LIBRARY_PATH"):
        val = os.environ.get(var, "")
        if val:
            parts.extend(val.split(":"))
    unique = list(dict.fromkeys(p for p in parts if p))
    os.environ["LD_LIBRARY_PATH"] = ":".join(unique)

_fix_ld_library_path()

from playwright.sync_api import sync_playwright

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("browser_worker")

SCREENSHOT_INTERVAL = 1.0   # seconds between screenshots
CMD_POLL_INTERVAL  = 0.25   # seconds between command checks


def write_status(work_dir: str, status: str, url: str = "", error: str = ""):
    with open(os.path.join(work_dir, "status.json"), "w") as f:
        json.dump({"status": status, "url": url, "error": error}, f)


def main():
    if len(sys.argv) < 3:
        print("Usage: session_browser_worker.py <ai_id> <work_dir>")
        sys.exit(1)

    ai_id    = sys.argv[1]
    work_dir = sys.argv[2]
    os.makedirs(work_dir, exist_ok=True)

    # Import config inside worker to avoid circular deps
    sys.path.insert(0, os.path.dirname(__file__))
    from config import AI_CONFIGS, SESSIONS_DIR

    config = AI_CONFIGS.get(ai_id)
    if not config:
        write_status(work_dir, "error", error=f"Unknown AI: {ai_id}")
        sys.exit(1)

    cmd_file        = os.path.join(work_dir, "command.txt")
    screenshot_file = os.path.join(work_dir, "latest.png")

    write_status(work_dir, "starting")

    pw   = sync_playwright().start()
    browser = pw.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu",
            "--disable-software-rasterizer",
        ],
    )
    context = browser.new_context(
        viewport={"width": 1280, "height": 900},
        user_agent=(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
    )
    page = context.new_page()

    # Mark ready immediately and take a blank screenshot so the UI shows right away
    write_status(work_dir, "ready", url=config["url"])
    try:
        page.screenshot(path=screenshot_file, type="png")
    except Exception:
        pass
    logger.info("Browser ready, navigating to %s", config["url"])

    # Use wait_until="commit" — returns as soon as the server starts responding,
    # so we don't block for the full page load / Cloudflare JS challenge.
    try:
        page.goto(config["url"], timeout=60_000, wait_until="commit")
        write_status(work_dir, "ready", url=page.url)
        logger.info("Navigation committed to %s", page.url)
    except Exception as e:
        logger.warning("Navigation warning (non-fatal): %s", e)
        write_status(work_dir, "ready", url=config["url"])

    last_screenshot = 0.0

    while True:
        now = time.time()

        # ── Take screenshot ──────────────────────────────────────────────────
        if now - last_screenshot >= SCREENSHOT_INTERVAL:
            try:
                page.screenshot(path=screenshot_file, type="png")
                write_status(work_dir, "ready", url=page.url)
                last_screenshot = now
            except Exception as e:
                logger.warning("Screenshot failed: %s", e)

        # ── Check for commands ──────────────────────────────────────────────
        if os.path.exists(cmd_file):
            try:
                with open(cmd_file) as f:
                    raw = f.read().strip()
                os.remove(cmd_file)
                cmd = json.loads(raw) if raw.startswith("{") else {"action": raw}
            except Exception:
                cmd = {}

            action = cmd.get("action", "")
            logger.info("Got command: %s", action)

            if action == "save":
                try:
                    session_path = os.path.join(SESSIONS_DIR, f"{ai_id}_state.json")
                    os.makedirs(SESSIONS_DIR, exist_ok=True)
                    context.storage_state(path=session_path)
                    write_status(work_dir, "saved", url=page.url)
                    logger.info("Session saved to %s", session_path)
                except Exception as e:
                    logger.error("Save failed: %s", e)
                    write_status(work_dir, "error", error=str(e))
                break

            elif action == "quit":
                write_status(work_dir, "quit")
                break

            elif action == "click":
                try:
                    x, y = cmd.get("x", 0), cmd.get("y", 0)
                    page.mouse.click(x, y)
                except Exception as e:
                    logger.warning("Click failed: %s", e)

            elif action == "type":
                try:
                    page.keyboard.type(cmd.get("text", ""), delay=50)
                except Exception as e:
                    logger.warning("Type failed: %s", e)

            elif action == "key":
                try:
                    page.keyboard.press(cmd.get("key", ""))
                except Exception as e:
                    logger.warning("Key failed: %s", e)

            elif action == "navigate":
                try:
                    page.goto(cmd.get("url", config["url"]), timeout=15_000)
                except Exception as e:
                    logger.warning("Navigate failed: %s", e)

        time.sleep(CMD_POLL_INTERVAL)

    try:
        context.close()
        browser.close()
        pw.stop()
    except Exception:
        pass

    logger.info("Worker done")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    main()
