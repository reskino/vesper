import os
import subprocess
import shutil
import time
import logging
from pathlib import Path

import token_reducer

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", "/home/runner/workspace")
MAX_OUTPUT_BYTES = 64 * 1024  # 64KB max output
DEFAULT_TIMEOUT = 60


_cwd = WORKSPACE_ROOT


def get_cwd() -> str:
    return _cwd


def set_cwd(path: str) -> str:
    global _cwd
    resolved = str(Path(path).resolve())
    if not os.path.isdir(resolved):
        raise FileNotFoundError(f"Directory not found: {path}")
    _cwd = resolved
    return _cwd


def get_env_info() -> dict:
    python_ver = subprocess.run(
        ["python3", "--version"], capture_output=True, text=True
    ).stdout.strip()
    node_ver = subprocess.run(
        ["node", "--version"], capture_output=True, text=True
    ).stdout.strip()
    return {
        "cwd": _cwd,
        "workspaceRoot": WORKSPACE_ROOT,
        "python": python_ver,
        "node": node_ver,
    }


def exec_command(
    command: str,
    cwd: str | None = None,
    timeout: int = DEFAULT_TIMEOUT,
    extra_env: dict | None = None,
) -> dict:
    """Execute a shell command and return stdout, stderr, exit code."""
    working_dir = cwd or _cwd
    start = time.time()

    # Handle cd specially — update the persistent CWD
    stripped = command.strip()
    if stripped.startswith("cd "):
        target = stripped[3:].strip().strip('"').strip("'")
        if not os.path.isabs(target):
            target = os.path.join(working_dir, target)
        try:
            new_dir = set_cwd(target)
            return {
                "stdout": f"Changed directory to: {new_dir}",
                "stderr": "",
                "exitCode": 0,
                "elapsedMs": int((time.time() - start) * 1000),
                "cwd": new_dir,
            }
        except Exception as e:
            return {
                "stdout": "",
                "stderr": str(e),
                "exitCode": 1,
                "elapsedMs": int((time.time() - start) * 1000),
                "cwd": working_dir,
            }

    try:
        env = os.environ.copy()
        env["TERM"] = "xterm-256color"
        if extra_env:
            env.update(extra_env)

        result = subprocess.run(
            command,
            shell=True,
            cwd=working_dir,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
        )

        stdout = result.stdout
        stderr = result.stderr

        # Hard cap before token reduction (avoid OOM on pathological output)
        if len(stdout.encode()) > MAX_OUTPUT_BYTES:
            stdout = stdout[: MAX_OUTPUT_BYTES // 2] + "\n\n[Output hard-capped before reduction...]\n"
        if len(stderr.encode()) > MAX_OUTPUT_BYTES:
            stderr = stderr[: MAX_OUTPUT_BYTES // 2] + "\n\n[Stderr hard-capped before reduction...]\n"

        # RTK-style token reduction
        try:
            stdout, stderr = token_reducer.reduce(command, stdout, stderr, result.returncode)
        except Exception as exc:
            logger.warning("token_reducer.reduce failed: %s", exc)

        elapsed = int((time.time() - start) * 1000)
        return {
            "stdout": stdout,
            "stderr": stderr,
            "exitCode": result.returncode,
            "elapsedMs": elapsed,
            "cwd": working_dir,
        }
    except subprocess.TimeoutExpired:
        return {
            "stdout": "",
            "stderr": f"Command timed out after {timeout}s",
            "exitCode": 124,
            "elapsedMs": int((time.time() - start) * 1000),
            "cwd": working_dir,
        }
    except Exception as e:
        return {
            "stdout": "",
            "stderr": str(e),
            "exitCode": 1,
            "elapsedMs": int((time.time() - start) * 1000),
            "cwd": working_dir,
        }
