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
        headless=False,
        args=[
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
        ],
    )
    context = browser.new_context(
        viewport={"width": 1280, "height": 900},
        user_agent=(
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
            "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        ),
    )
    page = context.new_page()

    try:
        page.goto(config["url"], timeout=30_000)
    except Exception as e:
        write_status(work_dir, "error", error=str(e))
        browser.close()
        pw.stop()
        sys.exit(1)

    write_status(work_dir, "ready", url=page.url)
    logger.info("Browser ready at %s", config["url"])

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
