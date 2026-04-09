import json
import os
import uuid
import time
from datetime import datetime, timezone
from typing import List, Optional
from config import LOGS_DIR

HISTORY_FILE = os.path.join(LOGS_DIR, "conversation_history.json")


def _load() -> dict:
    if not os.path.exists(HISTORY_FILE):
        return {}
    try:
        with open(HISTORY_FILE, "r") as f:
            return json.load(f)
    except Exception:
        return {}


def _save(data: dict):
    os.makedirs(LOGS_DIR, exist_ok=True)
    with open(HISTORY_FILE, "w") as f:
        json.dump(data, f, indent=2)


def add_message(ai_id: str, role: str, content: str, conversation_id: Optional[str] = None) -> dict:
    data = _load()
    if ai_id not in data:
        data[ai_id] = []

    if not conversation_id:
        conversation_id = str(uuid.uuid4())

    message = {
        "id": str(uuid.uuid4()),
        "role": role,
        "content": content,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "conversationId": conversation_id,
    }
    data[ai_id].append(message)
    _save(data)
    return message


def get_messages(ai_id: str) -> List[dict]:
    data = _load()
    return data.get(ai_id, [])


def get_all_summaries(ai_configs: dict) -> List[dict]:
    data = _load()
    summaries = []
    for ai_id, config in ai_configs.items():
        messages = data.get(ai_id, [])
        last_msg = None
        last_updated = datetime.now(timezone.utc).isoformat()
        if messages:
            last_msg = messages[-1].get("content", "")[:200]
            last_updated = messages[-1].get("timestamp", last_updated)
        summaries.append({
            "aiId": ai_id,
            "aiName": config["name"],
            "messageCount": len(messages),
            "lastMessage": last_msg,
            "lastUpdated": last_updated,
        })
    return summaries


def clear_messages(ai_id: str):
    data = _load()
    data[ai_id] = []
    _save(data)


def get_stats(ai_configs: dict) -> dict:
    data = _load()
    total = 0
    by_ai = {}
    most_used = None
    max_count = 0

    for ai_id in ai_configs:
        msgs = data.get(ai_id, [])
        count = len(msgs)
        by_ai[ai_id] = count
        total += count
        if count > max_count:
            max_count = count
            most_used = ai_id

    return {
        "totalMessages": total,
        "messagesByAi": by_ai,
        "totalSessions": sum(1 for ai_id in ai_configs if os.path.exists(
            os.path.join(os.path.dirname(__file__), "sessions", f"{ai_id}_state.json")
        )),
        "mostUsedAi": most_used,
    }
