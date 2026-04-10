"""
Vesper Autonomous Coding Agent

Works exactly like a senior engineer:
1. Plans first, then codes
2. Installs dependencies before running
3. Reads files back after writing to verify
4. Runs code, reads output carefully, fixes errors immediately
5. Tests every endpoint / feature before declaring done
6. Only says TASK_COMPLETE after personal verification

Tool call format:
<tool>{"name": "tool_name", "params": {...}}</tool>

When complete:
TASK_COMPLETE: <one-line summary of what was built and verified>
"""
import json
import re
import os
import socket
import signal
import subprocess
import time
import logging
import base64
import urllib.request
import urllib.error
import tempfile
from typing import Optional
from pathlib import Path

import requests as _requests

from playwright_utils import send_prompt, session_exists
from file_manager import get_language
from terminal_manager import exec_command, get_cwd, WORKSPACE_ROOT
from config import FALLBACK_ORDER, set_active_model

logger = logging.getLogger(__name__)

MAX_STEPS = 25
TOOL_PATTERN = re.compile(r"<tool>(.*?)</tool>", re.DOTALL)
COMPLETE_PATTERN = re.compile(
    r"TASK[_ ]COMPLETE[:\s]+(.+)",
    re.IGNORECASE | re.DOTALL,
)

# ── Alternative tool-call formats some models produce ────────────────────────
_TOOL_NAMES_RE = (
    "execute|background_exec|kill_process|write_file|read_file|"
    "create_dir|delete|list_dir|check_port|http_get|http_post|"
    "screenshot_url|sleep|install_packages|patch_file"
)
ALT_TOOL_RE = re.compile(
    rf"<({_TOOL_NAMES_RE})>(.*?)(?:</(?:{_TOOL_NAMES_RE})>|(?=<(?:{_TOOL_NAMES_RE})>)|$)",
    re.DOTALL | re.IGNORECASE,
)
ALT_PARAM_RE = re.compile(
    r"<parameter(?:=(\w+))?>(.*?)</parameter>",
    re.DOTALL | re.IGNORECASE,
)


def _try_parse_alt_tool(text: str) -> list[dict]:
    """Parse alternative tool-call formats some LLMs emit."""
    results = []
    for m in ALT_TOOL_RE.finditer(text):
        tool_name = m.group(1).lower()
        body = m.group(2) or ""
        params: dict = {}
        for pm in ALT_PARAM_RE.finditer(body):
            key = (pm.group(1) or "value").strip()
            val = pm.group(2).strip()
            params[key] = val
        if not params:
            for attr_m in re.finditer(r'(\w+)=["\']([^"\']*)["\']', body):
                params[attr_m.group(1)] = attr_m.group(2)
        if params:
            results.append({"name": tool_name, "params": params})
    return results


def _trim_conversation(conv: str, max_chars: int = 40_000) -> str:
    """Remove oldest tool result blocks to stay within context window."""
    if len(conv) <= max_chars:
        return conv
    head = conv[:3000]
    tail = conv[-(max_chars - 3500):]
    return head + "\n\n[...earlier history trimmed to fit context window...]\n\n" + tail


SCREENSHOT_DIR = Path(tempfile.gettempdir()) / "agent_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

_background_processes: dict[str, subprocess.Popen] = {}

SYSTEM_PROMPT = """You are Vesper, an autonomous coding agent running inside a Replit workspace. You build complete, fully-tested software step by step — exactly like a meticulous senior engineer.

══════════════════════════════════════
MANDATORY TOOL FORMAT
══════════════════════════════════════
Call tools using ONLY this exact JSON format:

<tool>{{"name": "write_file", "params": {{"path": "app.py", "content": "print('hello')"}}}}</tool>

❌ Wrong formats (will be ignored):
  <write_file path="app.py">...</write_file>
  ```write_file ...```

══════════════════════════════════════
AVAILABLE TOOLS
══════════════════════════════════════

1. install_packages — Install Python/Node packages (ALWAYS do this before importing)
   <tool>{{"name": "install_packages", "params": {{"packages": ["flask", "requests"], "manager": "pip"}}}}</tool>
   manager: "pip" (default) | "npm" | "pnpm"

2. execute — Run a shell command (blocking, waits for output)
   <tool>{{"name": "execute", "params": {{"command": "python3 app.py", "timeout": 30}}}}</tool>

3. background_exec — Start a server / watcher without blocking
   <tool>{{"name": "background_exec", "params": {{"command": "python3 server.py", "name": "my-server"}}}}</tool>

4. kill_process — Stop a background process
   <tool>{{"name": "kill_process", "params": {{"name": "my-server"}}}}</tool>

5. write_file — Create or overwrite a file with full content
   <tool>{{"name": "write_file", "params": {{"path": "src/app.py", "content": "full file content here"}}}}</tool>

6. patch_file — Append content to a file (useful for adding tests, etc.)
   <tool>{{"name": "patch_file", "params": {{"path": "app.py", "content": "\\n# added section\\n..."}}}}</tool>

7. read_file — Read a file's contents (always do this after writing to verify)
   <tool>{{"name": "read_file", "params": {{"path": "app.py"}}}}</tool>

8. create_dir — Create a directory tree
   <tool>{{"name": "create_dir", "params": {{"path": "src/utils"}}}}</tool>

9. delete — Delete a file or directory
   <tool>{{"name": "delete", "params": {{"path": "old_file.py"}}}}</tool>

10. list_dir — List directory contents
    <tool>{{"name": "list_dir", "params": {{"path": ".", "depth": 2}}}}</tool>

11. check_port — Verify a server started on a port
    <tool>{{"name": "check_port", "params": {{"port": 5000, "retries": 5, "wait_seconds": 1}}}}</tool>

12. http_get — Test an API endpoint (GET)
    <tool>{{"name": "http_get", "params": {{"url": "http://localhost:5000/api/hello"}}}}</tool>

13. http_post — Test an API endpoint (POST)
    <tool>{{"name": "http_post", "params": {{"url": "http://localhost:5000/api/items", "body": {{"name": "test"}}}}}}</tool>

14. screenshot_url — Take a screenshot of a web page and see its content
    <tool>{{"name": "screenshot_url", "params": {{"url": "http://localhost:5000", "wait_ms": 1500}}}}</tool>

15. sleep — Wait N seconds (let a server start up)
    <tool>{{"name": "sleep", "params": {{"seconds": 2}}}}</tool>

══════════════════════════════════════
HOW YOU WORK (follow this workflow)
══════════════════════════════════════

STEP 1 — PLAN: Think through what needs to be built, which files, which packages.

STEP 2 — SETUP: Create directories, install ALL required packages with install_packages.

STEP 3 — CODE: Write every file with complete content. Never use "..." or placeholders.
  → After each write_file, immediately read_file to verify it saved correctly.

STEP 4 — RUN: Execute or background_exec the code.
  → Read ALL output. Look for errors, tracebacks, import errors, port conflicts.

STEP 5 — VERIFY:
  → If a server: use sleep then check_port then http_get each endpoint.
  → If a script: check exit code 0 and expected output.
  → If a web app: screenshot_url to see it rendering.

STEP 6 — FIX & ITERATE:
  → If ANYTHING fails: fix the code, re-run, re-verify. Never skip this.
  → Import errors → install the missing package with install_packages.
  → Syntax errors → fix the file, re-read to verify, re-run.
  → Port in use → kill_process the old server, background_exec again.

STEP 7 — TASK_COMPLETE: Only say this after ALL verifications pass.
  Format: TASK_COMPLETE: <what was built, where files are, what was verified>

══════════════════════════════════════
RULES
══════════════════════════════════════
✓ Install packages BEFORE running code that imports them.
✓ Write COMPLETE file content — no ellipsis, no "add rest here".
✓ Read files back after writing — always verify.
✓ Fix every error before moving on.
✓ Test every endpoint and feature.
✓ Use ports 5000-5009 for servers (they're available in the workspace).

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Start by planning your approach, then call your first tool.
"""


_agent_status: dict = {
    "running": False, "task": None, "steps": [],
    "result": None, "current_action": None, "files_written": [],
}
_stop_requested: bool = False


def get_status() -> dict:
    return dict(_agent_status)


def stop_agent() -> bool:
    global _stop_requested
    if _agent_status.get("running"):
        _stop_requested = True
        return True
    return False


def _pick_ai(ai_id: str) -> Optional[str]:
    candidates = [ai_id] + [a for a in FALLBACK_ORDER if a != ai_id]
    for ai in candidates:
        if session_exists(ai):
            return ai
    return None


def _set_action(action: str) -> None:
    """Update the current_action field that the UI polls."""
    _agent_status["current_action"] = action


# ─── Tool implementations ────────────────────────────────────────────────────

def _tool_install_packages(params: dict, cwd: str) -> str:
    packages = params.get("packages", [])
    manager = params.get("manager", "pip")

    if isinstance(packages, str):
        packages = [p.strip() for p in packages.replace(",", " ").split() if p.strip()]
    if not packages:
        return "ERROR: No packages specified. Provide a list: {\"packages\": [\"flask\", \"requests\"]}"

    pkg_str = " ".join(f'"{p}"' if " " in p else p for p in packages)

    if manager in ("pip", "pip3"):
        cmd = f"pip install {pkg_str} --quiet --no-warn-script-location"
    elif manager == "npm":
        cmd = f"npm install {pkg_str}"
    elif manager in ("pnpm",):
        cmd = f"pnpm add {pkg_str}"
    else:
        cmd = f"pip install {pkg_str} --quiet --no-warn-script-location"

    res = exec_command(cmd, cwd=cwd, timeout=180)
    out = (res["stdout"] or "").strip()
    err = (res["stderr"] or "").strip()
    combined = "\n".join(filter(None, [out, err]))[:600]

    if res["exitCode"] == 0:
        return f"✓ Installed: {', '.join(packages)}\n{combined}".strip()
    else:
        return f"✗ Install failed (exit {res['exitCode']}):\n{combined}\nTry fixing the package names and retry."


def _tool_execute(params: dict, cwd: str) -> str:
    command = params.get("command", "")
    work_dir = params.get("cwd")
    timeout = int(params.get("timeout", 60))
    if work_dir and not os.path.isabs(work_dir):
        work_dir = os.path.join(WORKSPACE_ROOT, work_dir)
    res = exec_command(command, cwd=work_dir or cwd, timeout=timeout)
    parts = []
    if res["stdout"]:
        parts.append(f"STDOUT:\n{res['stdout']}")
    if res["stderr"]:
        parts.append(f"STDERR:\n{res['stderr']}")
    parts.append(f"Exit code: {res['exitCode']}")
    return "\n".join(parts) if parts else "(no output)"


def _tool_background_exec(params: dict, cwd: str) -> str:
    command = params.get("command", "")
    name = params.get("name", command[:40])
    work_dir = params.get("cwd")
    if work_dir and not os.path.isabs(work_dir):
        work_dir = os.path.join(WORKSPACE_ROOT, work_dir)
    work_dir = work_dir or cwd

    if name in _background_processes:
        try:
            _background_processes[name].terminate()
            time.sleep(0.3)
        except Exception:
            pass

    proc = subprocess.Popen(
        command,
        shell=True,
        cwd=work_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )
    _background_processes[name] = proc

    time.sleep(1.2)
    if proc.poll() is not None:
        out = proc.stdout.read() if proc.stdout else ""
        err = proc.stderr.read() if proc.stderr else ""
        return (
            f"Process '{name}' exited immediately (code {proc.returncode}) — it crashed.\n"
            f"STDOUT: {out[:400]}\nSTDERR: {err[:400]}\n"
            f"Fix the error and try again."
        )

    return (
        f"✓ Started '{name}' in background (PID {proc.pid}).\n"
        f"Next: use sleep({{'seconds': 2}}) then check_port to confirm it's ready, "
        f"then http_get to test an endpoint."
    )


def _tool_kill_process(params: dict, cwd: str) -> str:
    name = params.get("name", "")
    pid = params.get("pid")
    if pid:
        try:
            os.kill(int(pid), signal.SIGTERM)
            return f"Sent SIGTERM to PID {pid}"
        except Exception as e:
            return f"Error killing PID {pid}: {e}"
    if name in _background_processes:
        proc = _background_processes.pop(name)
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
        return f"✓ Terminated '{name}'"
    return f"No background process named '{name}'. Running: {list(_background_processes.keys())}"


def _tool_write_file(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        return "ERROR: path is required"
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE_ROOT, path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(content, encoding="utf-8")
    size = len(content.encode())
    lines = content.count("\n") + 1
    rel = params.get("path", path)
    # Track written files in status
    files = _agent_status.get("files_written", [])
    if rel not in files:
        files.append(rel)
        _agent_status["files_written"] = files
    return (
        f"✓ Written: {rel} ({lines} lines, {size} bytes)\n"
        f"→ Verify with read_file to confirm content is correct."
    )


def _tool_patch_file(params: dict, cwd: str) -> str:
    """Append content to a file."""
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        return "ERROR: path is required"
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    p = Path(full)
    if not p.exists():
        return f"ERROR: File not found: {path}. Use write_file to create it first."
    existing = p.read_text(encoding="utf-8")
    p.write_text(existing + content, encoding="utf-8")
    lines = (existing + content).count("\n") + 1
    return f"✓ Patched (appended to): {path} — now {lines} lines total."


def _tool_read_file(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    p = Path(full)
    if not p.exists():
        return f"ERROR: File not found: {path}"
    content = p.read_text(encoding="utf-8", errors="replace")
    if len(content) > 8000:
        content = content[:8000] + "\n\n[Truncated at 8000 chars]"
    lang = get_language(path)
    lines = content.count("\n") + 1
    return f"```{lang}\n# File: {params.get('path', path)} ({lines} lines)\n{content}\n```"


def _tool_create_dir(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE_ROOT, path)
    Path(path).mkdir(parents=True, exist_ok=True)
    return f"✓ Directory created: {params.get('path')}"


def _tool_delete(params: dict, cwd: str) -> str:
    import shutil
    path = params.get("path", "")
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    p = Path(full)
    if p.is_dir():
        shutil.rmtree(full)
    elif p.is_file():
        p.unlink()
    else:
        return f"Not found: {path}"
    return f"✓ Deleted: {path}"


def _tool_list_dir(params: dict, cwd: str) -> str:
    path = params.get("path", ".")
    depth = int(params.get("depth", 2))
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    if not os.path.exists(full):
        return f"Directory not found: {path}"

    def _fmt(directory: str, cur_depth: int) -> list[str]:
        lines = []
        try:
            entries = sorted(os.scandir(directory), key=lambda e: (e.is_file(), e.name))
        except PermissionError:
            return ["(permission denied)"]
        for entry in entries:
            if entry.name.startswith("."):
                continue
            indent = "  " * cur_depth
            if entry.is_dir():
                lines.append(f"{indent}{entry.name}/")
                if cur_depth < depth:
                    lines.extend(_fmt(entry.path, cur_depth + 1))
            else:
                size = entry.stat().st_size
                lines.append(f"{indent}{entry.name}  ({size}B)")
        return lines

    result = _fmt(full, 0)
    return f"{path}/\n" + "\n".join(result) if result else f"{path}/ (empty)"


def _tool_check_port(params: dict, cwd: str) -> str:
    host = params.get("host", "localhost")
    port = int(params.get("port", 8080))
    retries = int(params.get("retries", 1))
    wait_seconds = float(params.get("wait_seconds", 1.0))

    for attempt in range(retries):
        try:
            sock = socket.create_connection((host, port), timeout=2)
            sock.close()
            return f"✓ Port {port} is OPEN — server is running and accepting connections."
        except (ConnectionRefusedError, OSError):
            if attempt < retries - 1:
                time.sleep(wait_seconds)
    return (
        f"✗ Port {port} is CLOSED after {retries} attempt(s) — server not running or still starting.\n"
        f"Check background_exec output or try adding more sleep time."
    )


def _tool_http_get(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    timeout = float(params.get("timeout", 10))
    headers = params.get("headers", {})
    try:
        resp = _requests.get(url, headers=headers, timeout=timeout)
        body = resp.text
        if len(body) > 3000:
            body = body[:3000] + "\n[Truncated]"
        status_emoji = "✓" if resp.status_code < 400 else "✗"
        return (
            f"{status_emoji} HTTP GET {url}\n"
            f"Status: {resp.status_code}\n"
            f"Body:\n{body}"
        )
    except _requests.exceptions.ConnectionError:
        return f"✗ Connection refused to {url} — is the server running? Use check_port first."
    except _requests.exceptions.Timeout:
        return f"✗ Request timed out after {timeout}s — server may be overloaded or starting."
    except Exception as e:
        return f"✗ ERROR: {e}"


def _tool_http_post(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    body = params.get("body", {})
    timeout = float(params.get("timeout", 10))
    headers = params.get("headers", {})
    try:
        resp = _requests.post(url, json=body, headers=headers, timeout=timeout)
        resp_body = resp.text
        if len(resp_body) > 3000:
            resp_body = resp_body[:3000] + "\n[Truncated]"
        status_emoji = "✓" if resp.status_code < 400 else "✗"
        return (
            f"{status_emoji} HTTP POST {url}\n"
            f"Request body: {json.dumps(body)}\n"
            f"Status: {resp.status_code}\n"
            f"Response:\n{resp_body}"
        )
    except _requests.exceptions.ConnectionError:
        return f"✗ Connection refused to {url} — server not running?"
    except _requests.exceptions.Timeout:
        return f"✗ Request timed out after {timeout}s"
    except Exception as e:
        return f"✗ ERROR: {e}"


def _tool_screenshot_url(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    wait_ms = int(params.get("wait_ms", 1500))

    try:
        from playwright.sync_api import sync_playwright
        from config import find_chromium

        with sync_playwright() as p:
            exe = find_chromium()
            browser = p.chromium.launch(
                headless=True,
                executable_path=exe,
                args=["--no-sandbox", "--disable-setuid-sandbox",
                      "--disable-dev-shm-usage", "--disable-gpu"],
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            try:
                response = page.goto(url, wait_until="networkidle", timeout=20000)
                status = response.status if response else 0
                if wait_ms > 0:
                    page.wait_for_timeout(wait_ms)
                title = page.title()
                visible_text = page.evaluate(
                    "() => (document.body ? document.body.innerText : '').slice(0, 3000)"
                )
                screenshot_bytes = page.screenshot(full_page=False)
                fname = f"screenshot_{int(time.time()*1000)}.png"
                fpath = SCREENSHOT_DIR / fname
                fpath.write_bytes(screenshot_bytes)

                status_emoji = "✓" if status < 400 else "✗"
                result = (
                    f"{status_emoji} Screenshot: {url}\n"
                    f"HTTP Status: {status} | Page Title: {title}\n"
                    f"Screenshot API path: /api/agent/screenshot/{fname}\n\n"
                    f"VISIBLE CONTENT:\n{visible_text}"
                )
                if status >= 400:
                    result += f"\n\n⚠ HTTP {status} error returned — check server logs."
                return result
            except Exception as e:
                return f"✗ ERROR loading {url}: {e}"
            finally:
                browser.close()
    except Exception as e:
        return f"✗ ERROR with browser: {e}"


def _tool_sleep(params: dict, cwd: str) -> str:
    seconds = float(params.get("seconds", 2))
    seconds = min(seconds, 30)
    time.sleep(seconds)
    return f"✓ Waited {seconds:.1f}s"


# ─── Tool dispatcher ─────────────────────────────────────────────────────────

TOOL_MAP = {
    "install_packages": _tool_install_packages,
    "execute":          _tool_execute,
    "background_exec":  _tool_background_exec,
    "kill_process":     _tool_kill_process,
    "write_file":       _tool_write_file,
    "patch_file":       _tool_patch_file,
    "read_file":        _tool_read_file,
    "create_dir":       _tool_create_dir,
    "delete":           _tool_delete,
    "list_dir":         _tool_list_dir,
    "check_port":       _tool_check_port,
    "http_get":         _tool_http_get,
    "http_post":        _tool_http_post,
    "screenshot_url":   _tool_screenshot_url,
    "sleep":            _tool_sleep,
}


def _execute_tool(tool_name: str, params: dict, cwd: str) -> str:
    fn = TOOL_MAP.get(tool_name)
    if fn is None:
        available = ", ".join(TOOL_MAP.keys())
        return (
            f"ERROR: Unknown tool '{tool_name}'.\n"
            f"Available: {available}\n"
            f"Use the exact tool name from the AVAILABLE TOOLS list."
        )
    try:
        _set_action(f"{tool_name}: {_describe_params(tool_name, params)}")
        return fn(params, cwd)
    except Exception as e:
        logger.error(f"Tool '{tool_name}' error: {e}", exc_info=True)
        return f"ERROR in {tool_name}: {e}"


def _describe_params(tool_name: str, params: dict) -> str:
    """Human-readable summary of what a tool call is doing."""
    if tool_name in ("write_file", "read_file", "patch_file", "delete"):
        return str(params.get("path", ""))
    if tool_name in ("execute", "background_exec"):
        return str(params.get("command", ""))[:60]
    if tool_name in ("http_get", "http_post", "screenshot_url"):
        return str(params.get("url", ""))
    if tool_name == "install_packages":
        pkgs = params.get("packages", [])
        if isinstance(pkgs, list):
            return ", ".join(pkgs)
        return str(pkgs)
    if tool_name == "check_port":
        return f"port {params.get('port', '')}"
    if tool_name == "sleep":
        return f"{params.get('seconds', '')}s"
    return str(params)[:60]


# ─── Agent loop ───────────────────────────────────────────────────────────────

def run_agent(
    ai_id: str,
    task: str,
    working_dir: Optional[str] = None,
    max_steps: int = MAX_STEPS,
    model_id: Optional[str] = None,
) -> dict:
    global _agent_status, _stop_requested

    cwd = working_dir or get_cwd()
    if not os.path.isabs(cwd):
        cwd = os.path.join(WORKSPACE_ROOT, cwd)

    _stop_requested = False
    _agent_status = {
        "running": True,
        "task": task,
        "steps": [],
        "result": None,
        "current_action": "Starting up…",
        "files_written": [],
    }

    if model_id:
        set_active_model(ai_id, model_id)

    actual_ai = _pick_ai(ai_id)
    if not actual_ai:
        _agent_status = {
            "running": False,
            "task": task,
            "steps": [],
            "result": {
                "success": False,
                "error": (
                    "No AI session found. Go to the Sessions page and connect an AI provider first. "
                    "Pollinations AI works for free — no key needed."
                ),
                "summary": None,
            },
            "current_action": None,
            "files_written": [],
        }
        return _agent_status

    steps = []
    system = SYSTEM_PROMPT.format(
        cwd=cwd,
        workspace_root=WORKSPACE_ROOT,
        max_steps=max_steps,
    )
    conversation = (
        f"{system}\n\n{'═'*50}\n"
        f"TASK: {task}\n"
        f"{'═'*50}\n\n"
        f"Start by thinking through your approach, then call your first tool:"
    )

    start_time = time.time()
    last_response: str = ""
    consecutive_no_tool = 0

    _set_action("Thinking…")

    for step_num in range(max_steps):
        step_start = time.time()

        if _stop_requested:
            _agent_status = {
                "running": False,
                "task": task,
                "steps": steps,
                "result": {
                    "success": False,
                    "summary": None,
                    "error": "Agent stopped by user.",
                    "totalElapsedMs": int((time.time() - start_time) * 1000),
                },
                "current_action": None,
                "files_written": _agent_status.get("files_written", []),
            }
            return _agent_status

        conversation = _trim_conversation(conversation)

        _set_action(f"Thinking (step {step_num + 1}/{max_steps})…")
        success, ai_response, error = send_prompt(actual_ai, conversation)

        if not success or not ai_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": f"AI call failed: {error}",
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
            _agent_status["steps"] = list(steps)
            break

        # ── Repetition guard ──────────────────────────────────────────────────
        if ai_response.strip() == last_response.strip() and last_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": (
                    "Agent is stuck in a loop — the model produced the same response twice.\n"
                    "This usually means the model isn't following the required <tool>...</tool> format.\n"
                    "Recommendation: Switch to a stronger model (Claude, GPT-4o, or Gemini 2.5 Flash)."
                ),
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
            _agent_status["steps"] = list(steps)
            break
        last_response = ai_response

        steps.append({
            "step": step_num + 1,
            "type": "thought",
            "content": ai_response,
            "elapsedMs": int((time.time() - step_start) * 1000),
        })
        _agent_status["steps"] = list(steps)

        # ── Check for task completion ─────────────────────────────────────────
        complete_match = COMPLETE_PATTERN.search(ai_response)
        if complete_match:
            summary_lines = complete_match.group(1).strip().splitlines()
            summary = next((l.strip() for l in summary_lines if l.strip()), "Task complete.")
            _agent_status = {
                "running": False,
                "task": task,
                "steps": steps,
                "result": {
                    "success": True,
                    "summary": summary,
                    "error": None,
                    "totalElapsedMs": int((time.time() - start_time) * 1000),
                },
                "current_action": None,
                "files_written": _agent_status.get("files_written", []),
            }
            return _agent_status

        # ── Parse tool calls ─────────────────────────────────────────────────
        primary_tool_jsons = TOOL_PATTERN.findall(ai_response)
        alt_tool_dicts: list[dict] = []
        if not primary_tool_jsons:
            alt_tool_dicts = _try_parse_alt_tool(ai_response)

        if not primary_tool_jsons and not alt_tool_dicts:
            consecutive_no_tool += 1
            steps_remaining = max_steps - step_num - 1

            if consecutive_no_tool >= 3:
                # Give up — model can't follow format
                steps.append({
                    "step": step_num + 1,
                    "type": "error",
                    "content": (
                        "Model failed to use tools 3 times in a row.\n"
                        "This model doesn't follow the required format reliably.\n"
                        "Switch to Claude, GPT-4o, or Gemini 2.5 Flash for better results."
                    ),
                    "elapsedMs": 0,
                })
                _agent_status["steps"] = list(steps)
                break

            # Nudge the model
            conversation += (
                f"\n\nAssistant: {ai_response}"
                f"\n\nSystem: ⚠ No tool call found and task is not complete."
                f" You MUST call a tool to make progress. Required format:\n\n"
                f'<tool>{{"name": "write_file", "params": {{"path": "hello.py", "content": "print(\'hi\')"}}}}</tool>\n\n'
                f'Or to install packages:\n'
                f'<tool>{{"name": "install_packages", "params": {{"packages": ["flask"]}}}}</tool>\n\n'
                f"When done and verified:\nTASK_COMPLETE: brief one-line summary\n\n"
                f"Steps remaining: {steps_remaining}. Call a tool NOW."
                f"\n\nAssistant:"
            )
            continue

        consecutive_no_tool = 0

        # ── Execute all tool calls in this response ───────────────────────────
        tool_results_parts: list[str] = []

        def _run_tool_call(tool_name: str, tool_params: dict) -> None:
            tool_start = time.time()
            tool_result = _execute_tool(tool_name, tool_params, cwd)
            elapsed = int((time.time() - tool_start) * 1000)
            steps.append({
                "step": step_num + 1,
                "type": "tool",
                "tool": tool_name,
                "params": tool_params,
                "result": tool_result,
                "elapsedMs": elapsed,
            })
            _agent_status["steps"] = list(steps)
            tool_results_parts.append(f"[Tool: {tool_name}]\n{tool_result}")

        for tool_json in primary_tool_jsons:
            try:
                tool_data = json.loads(tool_json.strip())
            except json.JSONDecodeError as e:
                err_msg = f"JSON parse error in tool call: {e}\nRaw: {tool_json[:200]}"
                steps.append({
                    "step": step_num + 1,
                    "type": "error",
                    "content": err_msg,
                    "elapsedMs": 0,
                })
                _agent_status["steps"] = list(steps)
                tool_results_parts.append(f"[ERROR] {err_msg}")
                continue
            _run_tool_call(tool_data.get("name", ""), tool_data.get("params", {}))

        for tool_data in alt_tool_dicts:
            _run_tool_call(tool_data.get("name", ""), tool_data.get("params", {}))

        tool_results_block = "\n\n---\n\n".join(tool_results_parts)
        steps_remaining = max_steps - step_num - 1

        conversation += (
            f"\n\nAssistant: {ai_response}"
            f"\n\nTool Results:\n{tool_results_block}"
            f"\n\nSystem: Continue working. Steps remaining: {steps_remaining}."
            f"\n• If there were errors above, fix them immediately and re-run."
            f"\n• If a file was written, read it back to verify."
            f"\n• If a server was started, check_port then http_get to test endpoints."
            f"\n• Say TASK_COMPLETE only after ALL features are verified working."
            f"\n\nAssistant:"
        )

        _set_action(f"Step {step_num + 2}/{max_steps} — Analyzing results…")

    # Ran out of steps
    _agent_status = {
        "running": False,
        "task": task,
        "steps": steps,
        "result": {
            "success": False,
            "summary": None,
            "error": f"Reached maximum steps ({max_steps}) without completing. Try increasing Max Steps or use a smarter model.",
            "totalElapsedMs": int((time.time() - start_time) * 1000),
        },
        "current_action": None,
        "files_written": _agent_status.get("files_written", []),
    }
    return _agent_status


def get_screenshot_path(filename: str) -> Optional[Path]:
    """Return the full path for a screenshot file, or None if not found."""
    path = SCREENSHOT_DIR / filename
    if path.exists() and path.suffix == ".png":
        return path
    return None
