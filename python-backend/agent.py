"""
Autonomous coding agent engine.

Works exactly like a senior engineer who:
1. Thinks through the task
2. Writes code, reads it back to verify
3. Runs commands and reads their output carefully
4. Starts servers in the background, verifies they respond with HTTP requests
5. Takes screenshots to visually inspect running web apps
6. Reads back files after writing to confirm correctness
7. Fixes errors, re-tests, iterates until everything is genuinely working
8. Reports TASK_COMPLETE only when the task is fully verified and working

Tool call format:
<tool>{"name": "tool_name", "params": {...}}</tool>

When complete:
TASK_COMPLETE: <one-line summary of what was built and how to use it>
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
# Matches:  <write_file> <parameter=path>foo.py</parameter> ...
#           <execute> <parameter=command>python3 foo.py</parameter> ...
_TOOL_NAMES_RE = (
    "execute|write_file|read_file|background_exec|kill_process|"
    "create_dir|delete|list_dir|check_port|http_get|http_post|"
    "screenshot_url|sleep"
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
    """
    Parse alternative tool-call formats that some LLMs produce instead of the
    required JSON-in-<tool> format.

    Handles:
      <write_file> <parameter=path>hello.py</parameter> <parameter=content>...</parameter>
      <execute> <parameter=command>python3 hello.py</parameter>
    """
    results = []
    for m in ALT_TOOL_RE.finditer(text):
        tool_name = m.group(1).lower()
        body = m.group(2) or ""
        params: dict = {}
        for pm in ALT_PARAM_RE.finditer(body):
            key = (pm.group(1) or "value").strip()
            val = pm.group(2).strip()
            params[key] = val
        # Also try "function call" style: <execute command="..." />
        if not params:
            for attr_m in re.finditer(r'(\w+)=["\']([^"\']*)["\']', body):
                params[attr_m.group(1)] = attr_m.group(2)
        if params:
            results.append({"name": tool_name, "params": params})
    return results


def _trim_conversation(conv: str, max_chars: int = 40_000) -> str:
    """
    If the conversation has grown too large, remove the oldest tool result
    blocks to stay within the context window.
    """
    if len(conv) <= max_chars:
        return conv
    # Keep the system prompt (first 3000 chars) and trim the middle
    head = conv[:3000]
    tail = conv[-(max_chars - 3500):]
    return head + "\n\n[...earlier history trimmed to fit context window...]\n\n" + tail

SCREENSHOT_DIR = Path(tempfile.gettempdir()) / "agent_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

# Registry of background processes started by the agent
_background_processes: dict[str, subprocess.Popen] = {}

SYSTEM_PROMPT = """You are an expert autonomous coding agent. You build complete, fully-verified, production-ready software by thinking step-by-step and using tools — exactly like a senior engineer would.

══════════════════════════════════════════
CRITICAL — TOOL CALL FORMAT (mandatory)
══════════════════════════════════════════
You MUST call tools using this EXACT JSON format. No other format is accepted:

<tool>{{"name": "write_file", "params": {{"path": "hello.py", "content": "print('hello')"}}}}</tool>

WRONG formats (will be ignored — do NOT use these):
  ✗  <write_file> <parameter=path>hello.py</parameter> ...
  ✗  ```write_file path=hello.py ...```
  ✗  [write_file](path=hello.py)

You have these tools available. Call them using this exact format:
<tool>{{"name": "tool_name", "params": {{...}}}}</tool>

═══════════════════════════════════════════
AVAILABLE TOOLS
═══════════════════════════════════════════

1. execute — Run any shell command (blocking, waits for output)
   <tool>{{"name": "execute", "params": {{"command": "python3 script.py", "cwd": "optional/path", "timeout": 30}}}}</tool>

2. background_exec — Start a long-running process (server, watcher) without blocking
   <tool>{{"name": "background_exec", "params": {{"command": "python3 server.py", "name": "my-server", "cwd": "optional/path"}}}}</tool>

3. kill_process — Stop a background process
   <tool>{{"name": "kill_process", "params": {{"name": "my-server"}}}}</tool>

4. write_file — Create or overwrite a file with full content
   <tool>{{"name": "write_file", "params": {{"path": "relative/path/file.py", "content": "full content here"}}}}</tool>

5. read_file — Read a file's contents (always do this after writing to verify)
   <tool>{{"name": "read_file", "params": {{"path": "relative/path/file.py"}}}}</tool>

6. create_dir — Create a directory and all parents
   <tool>{{"name": "create_dir", "params": {{"path": "relative/path"}}}}</tool>

7. delete — Delete a file or directory
   <tool>{{"name": "delete", "params": {{"path": "relative/path"}}}}</tool>

8. list_dir — List directory contents
   <tool>{{"name": "list_dir", "params": {{"path": "relative/path", "depth": 2}}}}</tool>

9. check_port — Check if a port is open (server is running)
   <tool>{{"name": "check_port", "params": {{"port": 8080, "host": "localhost", "retries": 5, "wait_seconds": 1}}}}</tool>

10. http_get — Make an HTTP GET request and see the response
    <tool>{{"name": "http_get", "params": {{"url": "http://localhost:8080/api/hello", "timeout": 10}}}}</tool>

11. http_post — Make an HTTP POST request with a JSON body
    <tool>{{"name": "http_post", "params": {{"url": "http://localhost:8080/api/items", "body": {{"name": "test"}}, "timeout": 10}}}}</tool>

12. screenshot_url — Take a screenshot of a web page and see its visible content
    <tool>{{"name": "screenshot_url", "params": {{"url": "http://localhost:8080", "wait_ms": 1000}}}}</tool>

13. sleep — Wait N seconds (use after starting a server to let it initialise)
    <tool>{{"name": "sleep", "params": {{"seconds": 2}}}}</tool>

═══════════════════════════════════════════
HOW YOU THINK AND WORK
═══════════════════════════════════════════

You work exactly like a meticulous senior engineer who never ships untested code:

WRITING CODE:
- Write the full file content — never use placeholders, never truncate with "..."
- After writing a file, read it back to verify it was saved correctly
- If the task needs multiple files, write them all before running

RUNNING & VERIFYING:
- After running code, read the output carefully — look for errors, warnings, tracebacks
- If the output shows an error, fix it immediately and re-run
- Do NOT assume it works — verify it works
- If you write a web server, use background_exec then check_port to confirm it started
- Then use http_get to call each endpoint and verify the responses
- Use screenshot_url to visually inspect web UIs
- If anything looks wrong in the screenshot or HTTP response, fix the code and re-test

ITERATION MINDSET:
- Never give up on first error — errors are expected, fix them
- Read error messages carefully — they tell you exactly what's wrong
- After fixing, re-run and re-verify
- Keep iterating until every verification passes

TASK_COMPLETE:
- Only say TASK_COMPLETE when you have personally verified the task works
- Include in the summary: what was built, where the files are, and what you verified

═══════════════════════════════════════════

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin your response by thinking through the approach, then use tools one at a time.
"""


_agent_status: dict = {"running": False, "task": None, "steps": [], "result": None}
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


# ─── Tool implementations ────────────────────────────────────────────────────

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

    # Kill existing process with same name
    if name in _background_processes:
        try:
            _background_processes[name].terminate()
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

    # Give it a moment to crash if it's going to
    time.sleep(0.8)
    if proc.poll() is not None:
        out = proc.stdout.read() if proc.stdout else ""
        err = proc.stderr.read() if proc.stderr else ""
        return (
            f"Process exited immediately (code {proc.returncode}) — it probably crashed.\n"
            f"STDOUT: {out[:500]}\nSTDERR: {err[:500]}\n"
            f"Fix the error and try again."
        )

    return (
        f"Started '{name}' in background (PID {proc.pid})\n"
        f"Use sleep + check_port to wait for it to be ready, then http_get to test it."
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
        return f"Terminated '{name}'"
    return f"No background process named '{name}' found. Running: {list(_background_processes.keys())}"


def _tool_write_file(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    content = params.get("content", "")
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE_ROOT, path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(content, encoding="utf-8")
    size = len(content.encode())
    lines = content.count("\n") + 1
    return f"Written: {params.get('path')} ({lines} lines, {size} bytes)\nVerify with read_file to confirm content is correct."


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
        content = content[:8000] + "\n\n[Truncated at 8000 chars — file is longer]"
    lang = get_language(path)
    return f"```{lang}\n{content}\n```"


def _tool_create_dir(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE_ROOT, path)
    Path(path).mkdir(parents=True, exist_ok=True)
    return f"Directory created: {params.get('path')}"


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
    return f"Deleted: {path}"


def _tool_list_dir(params: dict, cwd: str) -> str:
    path = params.get("path", ".")
    depth = int(params.get("depth", 2))
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    if not os.path.exists(full):
        return f"Directory not found: {path}"

    def _fmt(directory: str, rel: str, cur_depth: int) -> list[str]:
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
                    lines.extend(_fmt(entry.path, os.path.join(rel, entry.name), cur_depth + 1))
            else:
                size = entry.stat().st_size
                lines.append(f"{indent}{entry.name}  ({size}B)")
        return lines

    result = _fmt(full, path, 0)
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
            return f"✓ Port {port} is OPEN — server is running and accepting connections"
        except (ConnectionRefusedError, OSError):
            if attempt < retries - 1:
                time.sleep(wait_seconds)
    return f"✗ Port {port} is CLOSED after {retries} attempt(s) — server is not running or still starting up"


def _tool_http_get(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    timeout = float(params.get("timeout", 10))
    headers = params.get("headers", {})
    try:
        resp = _requests.get(url, headers=headers, timeout=timeout)
        body = resp.text
        if len(body) > 3000:
            body = body[:3000] + "\n[Truncated]"
        return (
            f"HTTP GET {url}\n"
            f"Status: {resp.status_code}\n"
            f"Headers: {dict(resp.headers)}\n"
            f"Body:\n{body}"
        )
    except _requests.exceptions.ConnectionError:
        return f"ERROR: Connection refused to {url} — is the server running?"
    except _requests.exceptions.Timeout:
        return f"ERROR: Request timed out after {timeout}s"
    except Exception as e:
        return f"ERROR: {e}"


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
        return (
            f"HTTP POST {url}\n"
            f"Request body: {json.dumps(body)}\n"
            f"Status: {resp.status_code}\n"
            f"Response:\n{resp_body}"
        )
    except _requests.exceptions.ConnectionError:
        return f"ERROR: Connection refused to {url} — is the server running?"
    except _requests.exceptions.Timeout:
        return f"ERROR: Request timed out after {timeout}s"
    except Exception as e:
        return f"ERROR: {e}"


def _tool_screenshot_url(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    wait_ms = int(params.get("wait_ms", 1000))

    try:
        from playwright.sync_api import sync_playwright
        from config import find_chromium

        with sync_playwright() as p:
            exe = find_chromium()
            browser = p.chromium.launch(
                headless=True,
                executable_path=exe,
                args=["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            try:
                response = page.goto(url, wait_until="networkidle", timeout=20000)
                status = response.status if response else 0

                if wait_ms > 0:
                    page.wait_for_timeout(wait_ms)

                title = page.title()
                visible_text = page.evaluate(
                    "() => (document.body ? document.body.innerText : '').slice(0, 4000)"
                )

                # Capture any console errors
                errors_on_page = page.evaluate(
                    """() => {
                        const errs = [];
                        const orig = console.error.bind(console);
                        return errs;
                    }"""
                )

                # Take screenshot
                screenshot_bytes = page.screenshot(full_page=False)
                fname = f"screenshot_{int(time.time()*1000)}.png"
                fpath = SCREENSHOT_DIR / fname
                fpath.write_bytes(screenshot_bytes)

                result = (
                    f"SCREENSHOT: {url}\n"
                    f"HTTP Status: {status}\n"
                    f"Page Title: {title}\n"
                    f"Screenshot saved: {fname}\n"
                    f"Screenshot API path: /api/agent/screenshot/{fname}\n\n"
                    f"VISIBLE CONTENT:\n{visible_text}"
                )

                if status >= 400:
                    result += f"\n\n⚠ HTTP {status} error — the page returned an error status"

                return result

            except Exception as e:
                return f"ERROR loading {url}: {e}"
            finally:
                browser.close()

    except Exception as e:
        return f"ERROR with browser automation: {e}"


def _tool_sleep(params: dict, cwd: str) -> str:
    seconds = float(params.get("seconds", 2))
    seconds = min(seconds, 30)
    time.sleep(seconds)
    return f"Waited {seconds:.1f}s"


# ─── Tool dispatcher ─────────────────────────────────────────────────────────

TOOL_MAP = {
    "execute": _tool_execute,
    "background_exec": _tool_background_exec,
    "kill_process": _tool_kill_process,
    "write_file": _tool_write_file,
    "read_file": _tool_read_file,
    "create_dir": _tool_create_dir,
    "delete": _tool_delete,
    "list_dir": _tool_list_dir,
    "check_port": _tool_check_port,
    "http_get": _tool_http_get,
    "http_post": _tool_http_post,
    "screenshot_url": _tool_screenshot_url,
    "sleep": _tool_sleep,
}


def _execute_tool(tool_name: str, params: dict, cwd: str) -> str:
    fn = TOOL_MAP.get(tool_name)
    if fn is None:
        return f"ERROR: Unknown tool '{tool_name}'. Available tools: {list(TOOL_MAP.keys())}"
    try:
        return fn(params, cwd)
    except Exception as e:
        logger.error(f"Tool '{tool_name}' error: {e}", exc_info=True)
        return f"ERROR in {tool_name}: {e}"


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
    _agent_status = {"running": True, "task": task, "steps": [], "result": None}

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
                "error": "No AI session found. Please create a session first in the Sessions page.",
                "summary": None,
            },
        }
        return _agent_status

    steps = []
    system = SYSTEM_PROMPT.format(
        cwd=cwd,
        workspace_root=WORKSPACE_ROOT,
        max_steps=max_steps,
    )
    conversation = (
        f"{system}\n\n{'═'*50}\nTASK: {task}\n{'═'*50}\n\n"
        f"Start by thinking through your approach, then call your first tool:"
    )

    start_time = time.time()
    last_response: str = ""

    for step_num in range(max_steps):
        step_start = time.time()

        # Check if the user requested a stop
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
            }
            return _agent_status

        # Trim conversation to avoid overflowing the model's context window
        conversation = _trim_conversation(conversation)

        success, ai_response, error = send_prompt(actual_ai, conversation)

        if not success or not ai_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": f"AI call failed: {error}",
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
            break

        # ── Repetition guard ──────────────────────────────────────────────────
        # If the model outputs the exact same text twice in a row it has
        # looped.  Stop immediately instead of wasting all remaining steps.
        if ai_response.strip() == last_response.strip() and last_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": (
                    "Agent detected a repeated response — the model is stuck in a loop. "
                    "This usually means the model isn't following the required tool-call format. "
                    "Try a different AI model (ChatGPT or Claude work most reliably with Agent Mode)."
                ),
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
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
            # Take the first non-empty line of the match as the summary
            summary = complete_match.group(1).strip().splitlines()[0].strip()
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
            }
            return _agent_status

        # ── Parse tool calls (primary JSON format) ───────────────────────────
        primary_tool_jsons = TOOL_PATTERN.findall(ai_response)

        # ── Parse tool calls (alternative XML/parameter format fallback) ──────
        alt_tool_dicts: list[dict] = []
        if not primary_tool_jsons:
            alt_tool_dicts = _try_parse_alt_tool(ai_response)

        if not primary_tool_jsons and not alt_tool_dicts:
            # The model didn't call any tool AND didn't say TASK_COMPLETE.
            # Nudge it with a very explicit reminder of the required format.
            steps_remaining = max_steps - step_num - 1
            conversation += (
                f"\n\nAssistant: {ai_response}"
                f"\n\nSystem: ⚠ No tool call detected and task is not complete."
                f" You MUST use tools to make progress. Required format (copy this exactly):\n\n"
                f'<tool>{{"name": "write_file", "params": {{"path": "hello.py", "content": "print(\'hi\')"}}}}</tool>\n\n'
                f"Or when done:\nTASK_COMPLETE: brief summary of what was built\n\n"
                f"Steps remaining: {steps_remaining}. Use a tool now."
                f"\n\nAssistant:"
            )
            continue

        # ── Execute all tool calls ────────────────────────────────────────────
        tool_results_text_parts: list[str] = []

        # Process primary (JSON) tool calls
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
                tool_results_text_parts.append(f"[ERROR] {err_msg}")
                continue

            tool_name = tool_data.get("name", "")
            tool_params = tool_data.get("params", {})
            tool_result = _execute_tool(tool_name, tool_params, cwd)

            steps.append({
                "step": step_num + 1,
                "type": "tool",
                "tool": tool_name,
                "params": tool_params,
                "result": tool_result,
                "elapsedMs": 0,
            })
            _agent_status["steps"] = list(steps)
            tool_results_text_parts.append(f"[Tool: {tool_name}]\n{tool_result}")

        # Process alternative-format tool calls
        for tool_data in alt_tool_dicts:
            tool_name = tool_data.get("name", "")
            tool_params = tool_data.get("params", {})
            tool_result = _execute_tool(tool_name, tool_params, cwd)

            steps.append({
                "step": step_num + 1,
                "type": "tool",
                "tool": tool_name,
                "params": tool_params,
                "result": tool_result,
                "elapsedMs": 0,
            })
            _agent_status["steps"] = list(steps)
            tool_results_text_parts.append(f"[Tool: {tool_name}]\n{tool_result}")

        tool_results_block = "\n\n---\n\n".join(tool_results_text_parts)
        steps_remaining = max_steps - step_num - 1
        conversation += (
            f"\n\nAssistant: {ai_response}"
            f"\n\nTool Results:\n{tool_results_block}"
            f"\n\nSystem: Continue. Steps remaining: {steps_remaining}."
            f" Use more tools to make progress, read back files to verify,"
            f" test your code, or say TASK_COMPLETE when fully done and verified."
            f"\n\nAssistant:"
        )

    # Ran out of steps
    _agent_status = {
        "running": False,
        "task": task,
        "steps": steps,
        "result": {
            "success": False,
            "summary": None,
            "error": f"Reached maximum steps ({max_steps}) without completing the task.",
            "totalElapsedMs": int((time.time() - start_time) * 1000),
        },
    }
    return _agent_status


def get_screenshot_path(filename: str) -> Optional[Path]:
    """Return the full path for a screenshot file, or None if not found."""
    path = SCREENSHOT_DIR / filename
    if path.exists() and path.suffix == ".png":
        return path
    return None
