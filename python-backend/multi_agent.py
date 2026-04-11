"""
Multi-Agent Manager for Vesper.

Spawns multiple independent agent instances in background threads,
each identified by a UUID. Each agent has its own AI provider and task.

Public API:
  spawn(...)         → agent_id str
  get(agent_id)      → status dict
  list_all()         → list of status dicts
  stop(agent_id)     → bool
  clear(agent_id)    → bool
  clear_all_done()   → int (number cleared)
"""

from __future__ import annotations
import threading
import uuid
import time
import logging
from typing import Optional

import agent as _agent_module

logger = logging.getLogger(__name__)

_REGISTRY_LOCK = threading.Lock()
_REGISTRY: dict[str, dict] = {}  # id → {thread, created_at, label, role, ai_id}


def spawn(
    ai_id: str,
    task: str,
    role: str = "builder",
    working_dir: Optional[str] = None,
    max_steps: int = 20,
    model_id: Optional[str] = None,
    label: Optional[str] = None,
) -> str:
    """
    Spawn a new agent in a background thread. Returns the agent_id.

    Args:
        ai_id:       AI provider ID (e.g. 'claude', 'chatgpt')
        task:        The task description for the agent.
        role:        Agent role: 'builder', 'scholar', 'search_master', 'orchestrator'
        working_dir: Optional working directory override.
        max_steps:   Maximum reasoning steps (default 20, capped at 50).
        model_id:    Optional model override.
        label:       Human-readable name for the swarm view.
    """
    agent_id = str(uuid.uuid4())[:8]
    max_steps = min(int(max_steps), 50)

    _registry_meta = {
        "agent_id": agent_id,
        "label": label or task[:60],
        "role": role,
        "ai_id": ai_id,
        "created_at": time.time(),
        "thread": None,
    }
    with _REGISTRY_LOCK:
        _REGISTRY[agent_id] = _registry_meta

    def _run():
        try:
            _agent_module.run_agent(
                ai_id=ai_id,
                task=task,
                working_dir=working_dir,
                max_steps=max_steps,
                model_id=model_id,
                agent_type=role,
                agent_id=agent_id,
            )
        except Exception as e:
            logger.error(f"Multi-agent {agent_id} crashed: {e}", exc_info=True)
            try:
                with _agent_module._multi_lock:
                    if agent_id in _agent_module._multi_states:
                        _agent_module._multi_states[agent_id]["running"] = False
                        _agent_module._multi_states[agent_id]["result"] = {
                            "success": False,
                            "error": str(e),
                            "summary": None,
                        }
            except Exception:
                pass

    t = threading.Thread(target=_run, daemon=True, name=f"vesper-agent-{agent_id}")
    with _REGISTRY_LOCK:
        _REGISTRY[agent_id]["thread"] = t
    t.start()

    logger.info(f"Spawned multi-agent {agent_id} | role={role} | ai={ai_id}")
    return agent_id


def get(agent_id: str) -> dict:
    """Return the full status dict for an agent."""
    meta = {}
    with _REGISTRY_LOCK:
        meta = dict(_REGISTRY.get(agent_id, {}))
    meta.pop("thread", None)

    status = _agent_module.get_multi_status(agent_id)
    if not status:
        status = {
            "agent_id": agent_id,
            "running": False,
            "task": None,
            "steps": [],
            "result": None,
            "current_action": None,
            "files_written": [],
        }
    status.update({k: v for k, v in meta.items() if k not in status})
    return status


def list_all() -> list[dict]:
    """Return status dicts for all registered agents, newest first."""
    with _REGISTRY_LOCK:
        ids = list(reversed(list(_REGISTRY.keys())))
    return [get(aid) for aid in ids]


def stop(agent_id: str) -> bool:
    """Request a running agent to stop gracefully."""
    return _agent_module.stop_multi_agent(agent_id)


def clear(agent_id: str) -> bool:
    """Remove a completed/failed agent from the registry."""
    ok = _agent_module.clear_multi_agent(agent_id)
    if ok:
        with _REGISTRY_LOCK:
            _REGISTRY.pop(agent_id, None)
    return ok


def clear_all_done() -> int:
    """Remove all completed/failed agents. Returns count removed."""
    with _REGISTRY_LOCK:
        ids = list(_REGISTRY.keys())
    count = 0
    for aid in ids:
        if clear(aid):
            count += 1
    return count
