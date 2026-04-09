"""
Autonomous coding agent engine.

The agent receives a task description and iteratively:
1. Thinks about the next step
2. Calls a tool (read_file, write_file, execute, install, create_dir, search)
3. Observes the result
4. Repeats until done or max_steps reached

Tool call format the AI must use in its responses:
<tool>{"name": "tool_name", "params": {...}}</tool>

When complete:
TASK_COMPLETE: <one-line summary of what was built>
"""
import json
import re
import os
import time
import logging
from typing import Optional
from pathlib import Path

from playwright_utils import send_prompt, session_exists
from file_manager import read_file, write_file, create_file, delete_path, rename_path, get_language
from terminal_manager import exec_command, get_cwd, set_cwd, WORKSPACE_ROOT
from config import AI_CONFIGS, FALLBACK_ORDER

logger = logging.getLogger(__name__)

MAX_STEPS = 20
TOOL_PATTERN = re.compile(r"<tool>(.*?)</tool>", re.DOTALL)
COMPLETE_PATTERN = re.compile(r"TASK_COMPLETE:\s*(.+)", re.IGNORECASE)

SYSTEM_PROMPT = """You are an expert autonomous coding agent. You can build complete, production-ready applications by thinking step-by-step and using tools.

You have these tools available. Call them using this exact format:
<tool>{"name": "tool_name", "params": {...}}</tool>

AVAILABLE TOOLS:

1. execute — Run any shell command (bash, git, pip, npm, pnpm, python3, etc.)
   <tool>{"name": "execute", "params": {"command": "bash command here", "cwd": "optional/path"}}</tool>

2. write_file — Create or overwrite a file with content
   <tool>{"name": "write_file", "params": {"path": "relative/path/to/file.py", "content": "full file content"}}</tool>

3. read_file — Read a file's contents
   <tool>{"name": "read_file", "params": {"path": "relative/path/to/file"}}</tool>

4. create_dir — Create a directory (including parents)
   <tool>{"name": "create_dir", "params": {"path": "relative/path"}}</tool>

5. delete — Delete a file or directory
   <tool>{"name": "delete", "params": {"path": "relative/path"}}</tool>

6. list_dir — List the contents of a directory
   <tool>{"name": "list_dir", "params": {"path": "relative/path", "depth": 2}}</tool>

RULES:
- Always think before acting. Start responses with your reasoning.
- Use execute for: installing packages, running code, testing, git operations, scaffolding
- Create all parent directories before writing files
- After writing code, always execute it to test — fix any errors before completing
- Write real, working code — no placeholders, no TODOs unless explicitly told
- When the task is fully complete and tested, end your response with:
  TASK_COMPLETE: <brief summary of what was built and how to use it>
- Do NOT include TASK_COMPLETE until the task is actually done and working
- Maximum {max_steps} tool calls total — be efficient

WORKING DIRECTORY: {cwd}
"""


_agent_status: dict = {"running": False, "task": None, "steps": [], "result": None}


def get_status() -> dict:
    return dict(_agent_status)


def _pick_ai(ai_id: str) -> Optional[str]:
    """Find a working AI with a session."""
    candidates = [ai_id] + [a for a in FALLBACK_ORDER if a != ai_id]
    for ai in candidates:
        if session_exists(ai):
            return ai
    return None


def _execute_tool(tool_name: str, params: dict, cwd: str) -> str:
    """Execute a single tool call and return a string result."""
    try:
        if tool_name == "execute":
            command = params.get("command", "")
            work_dir = params.get("cwd")
            if work_dir and not os.path.isabs(work_dir):
                work_dir = os.path.join(WORKSPACE_ROOT, work_dir)
            res = exec_command(command, cwd=work_dir or cwd, timeout=120)
            parts = []
            if res["stdout"]:
                parts.append(f"STDOUT:\n{res['stdout']}")
            if res["stderr"]:
                parts.append(f"STDERR:\n{res['stderr']}")
            parts.append(f"Exit code: {res['exitCode']}")
            return "\n".join(parts) if parts else "(no output)"

        elif tool_name == "write_file":
            path = params.get("path", "")
            content = params.get("content", "")
            if not os.path.isabs(path):
                path = os.path.join(WORKSPACE_ROOT, path)
            # Ensure parent dir
            Path(path).parent.mkdir(parents=True, exist_ok=True)
            Path(path).write_text(content, encoding="utf-8")
            return f"File written: {params.get('path')}"

        elif tool_name == "read_file":
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
            return f"```{get_language(path)}\n{content}\n```"

        elif tool_name == "create_dir":
            path = params.get("path", "")
            if not os.path.isabs(path):
                path = os.path.join(WORKSPACE_ROOT, path)
            Path(path).mkdir(parents=True, exist_ok=True)
            return f"Directory created: {params.get('path')}"

        elif tool_name == "delete":
            path = params.get("path", "")
            if not os.path.isabs(path):
                path_rel = params.get("path")
                full = os.path.join(WORKSPACE_ROOT, path_rel)
            else:
                full = path
            import shutil
            p = Path(full)
            if p.is_dir():
                shutil.rmtree(full)
            elif p.is_file():
                p.unlink()
            else:
                return f"Not found: {params.get('path')}"
            return f"Deleted: {params.get('path')}"

        elif tool_name == "list_dir":
            path = params.get("path", ".")
            depth = int(params.get("depth", 2))
            if not os.path.isabs(path):
                path = os.path.join(WORKSPACE_ROOT, path)

            from file_manager import build_tree
            tree = build_tree(path, params.get("path", "."), 0, depth)

            def fmt(node, indent=0):
                prefix = "  " * indent
                icon = "/" if node["type"] == "directory" else ""
                lines = [f"{prefix}{node['name']}{icon}"]
                for child in (node.get("children") or []):
                    lines.extend(fmt(child, indent + 1))
                return lines

            return "\n".join(fmt(tree))

        else:
            return f"ERROR: Unknown tool: {tool_name}"

    except Exception as e:
        logger.error(f"Tool error {tool_name}: {e}")
        return f"ERROR: {e}"


def run_agent(ai_id: str, task: str, working_dir: Optional[str] = None, max_steps: int = MAX_STEPS) -> dict:
    """
    Run the agent loop for a task. Returns a full trace of steps.
    This is a synchronous blocking call.
    """
    global _agent_status

    cwd = working_dir or get_cwd()
    if not os.path.isabs(cwd):
        cwd = os.path.join(WORKSPACE_ROOT, cwd)

    _agent_status = {"running": True, "task": task, "steps": [], "result": None}

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
            }
        }
        return _agent_status

    steps = []
    system = SYSTEM_PROMPT.format(cwd=cwd, max_steps=max_steps)
    conversation = f"{system}\n\n--- TASK ---\n{task}\n\nBegin:"

    start_time = time.time()

    for step_num in range(max_steps):
        step_start = time.time()

        # Send current conversation to AI
        success, ai_response, error = send_prompt(actual_ai, conversation)

        if not success or not ai_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": f"AI failed: {error}",
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
            break

        steps.append({
            "step": step_num + 1,
            "type": "thought",
            "content": ai_response,
            "elapsedMs": int((time.time() - step_start) * 1000),
        })
        _agent_status["steps"] = list(steps)

        # Check for task complete signal
        complete_match = COMPLETE_PATTERN.search(ai_response)
        if complete_match:
            summary = complete_match.group(1).strip()
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

        # Parse and execute tool calls
        tool_calls = TOOL_PATTERN.findall(ai_response)
        if not tool_calls:
            # No tool calls but also no TASK_COMPLETE — AI might be done or confused
            # Add a prompt to continue
            conversation += f"\n\nAssistant: {ai_response}\n\nHuman: Continue. Use a tool or say TASK_COMPLETE if finished."
            continue

        tool_results = []
        for tool_json in tool_calls:
            try:
                tool_data = json.loads(tool_json.strip())
                tool_name = tool_data.get("name", "")
                tool_params = tool_data.get("params", {})

                tool_result = _execute_tool(tool_name, tool_params, cwd)

                tool_results.append({
                    "tool": tool_name,
                    "params": tool_params,
                    "result": tool_result,
                })

                steps.append({
                    "step": step_num + 1,
                    "type": "tool",
                    "tool": tool_name,
                    "params": tool_params,
                    "result": tool_result,
                    "elapsedMs": 0,
                })
                _agent_status["steps"] = list(steps)

            except json.JSONDecodeError as e:
                steps.append({
                    "step": step_num + 1,
                    "type": "error",
                    "content": f"Failed to parse tool call: {e}\nRaw: {tool_json}",
                    "elapsedMs": 0,
                })

        # Build next conversation turn
        tool_results_text = "\n\n".join(
            f"[Tool: {r['tool']}]\n{r['result']}" for r in tool_results
        )
        conversation += f"\n\nAssistant: {ai_response}\n\nTool Results:\n{tool_results_text}\n\nHuman: Continue based on the tool results. Use more tools if needed, or say TASK_COMPLETE when fully done and tested."

    # If we exit the loop without TASK_COMPLETE
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
