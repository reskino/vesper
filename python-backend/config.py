import os

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")

os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

# tier: "free" → works on free accounts
#        "plus" → requires ChatGPT Plus / Claude Pro / X Premium
#        "pro"  → requires the top-tier paid plan
AI_CONFIGS = {
    "chatgpt": {
        "id": "chatgpt",
        "name": "ChatGPT",
        "url": "https://chatgpt.com",
        "login_url": "https://chatgpt.com",
        "icon": "openai",
        "models": [
            {"id": "gpt-4o-mini", "name": "GPT-4o mini",  "tier": "free"},
            {"id": "gpt-4o",      "name": "GPT-4o",        "tier": "plus"},
            {"id": "gpt-4",       "name": "GPT-4",         "tier": "plus"},
            {"id": "o1",          "name": "o1",             "tier": "plus"},
            {"id": "o3-mini",     "name": "o3-mini",        "tier": "plus"},
            {"id": "o3",          "name": "o3",             "tier": "pro"},
        ],
        "defaultModel": "gpt-4o-mini",
        "freeModel":    "gpt-4o-mini",
    },
    "grok": {
        "id": "grok",
        "name": "Grok",
        "url": "https://grok.com",
        "login_url": "https://grok.com",
        "icon": "xai",
        "models": [
            {"id": "grok-3-mini", "name": "Grok 3 Mini", "tier": "free"},
            {"id": "grok-2",      "name": "Grok 2",       "tier": "free"},
            {"id": "grok-3",      "name": "Grok 3",        "tier": "plus"},
        ],
        "defaultModel": "grok-3-mini",
        "freeModel":    "grok-3-mini",
    },
    "claude": {
        "id": "claude",
        "name": "Claude",
        "url": "https://claude.ai",
        "login_url": "https://claude.ai/new",
        "icon": "anthropic",
        "models": [
            {"id": "claude-3-5-haiku-20241022",  "name": "Claude 3.5 Haiku",  "tier": "free"},
            {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet", "tier": "plus"},
            {"id": "claude-3-7-sonnet-20250219", "name": "Claude 3.7 Sonnet", "tier": "plus"},
            {"id": "claude-sonnet-4-5",          "name": "Claude Sonnet 4.5", "tier": "plus"},
            {"id": "claude-opus-4-5",            "name": "Claude Opus 4.5",   "tier": "pro"},
        ],
        "defaultModel": "claude-3-5-haiku-20241022",
        "freeModel":    "claude-3-5-haiku-20241022",
    },
}

FALLBACK_ORDER = ["chatgpt", "grok", "claude"]

DEFAULT_TIMEOUT = 120000
RESPONSE_POLL_INTERVAL = 2000
MAX_RESPONSE_WAIT = 180000

_active_models: dict = {}


def get_active_model(ai_id: str) -> str:
    if ai_id in _active_models:
        return _active_models[ai_id]
    config = AI_CONFIGS.get(ai_id, {})
    return config.get("defaultModel", "")


def get_free_model(ai_id: str) -> str:
    config = AI_CONFIGS.get(ai_id, {})
    return config.get("freeModel", get_active_model(ai_id))


def set_active_model(ai_id: str, model_id: str) -> bool:
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False
    valid_ids = {m["id"] for m in config.get("models", [])}
    if model_id not in valid_ids:
        return False
    _active_models[ai_id] = model_id
    return True
