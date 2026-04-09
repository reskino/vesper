import os

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")

os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

AI_CONFIGS = {
    "chatgpt": {
        "id": "chatgpt",
        "name": "ChatGPT",
        "url": "https://platform.openai.com/api-keys",
        "icon": "openai",
        "api_type": "openai",
        "api_base": "https://api.openai.com/v1",
        "api_env_var": "OPENAI_API_KEY",
        "api_docs": "https://platform.openai.com/api-keys",
        "key_prefix": "sk-",
        "models": [
            {"id": "gpt-4.1",      "name": "GPT-4.1"},
            {"id": "gpt-4o",       "name": "GPT-4o"},
            {"id": "gpt-4o-mini",  "name": "GPT-4o mini"},
            {"id": "o3-mini",      "name": "o3-mini"},
            {"id": "o1",           "name": "o1"},
        ],
        "defaultModel": "gpt-4o",
    },
    "grok": {
        "id": "grok",
        "name": "Grok",
        "url": "https://console.x.ai",
        "icon": "xai",
        "api_type": "openai",
        "api_base": "https://api.x.ai/v1",
        "api_env_var": "XAI_API_KEY",
        "api_docs": "https://console.x.ai",
        "key_prefix": "xai-",
        "models": [
            {"id": "grok-3",            "name": "Grok 3"},
            {"id": "grok-3-mini",       "name": "Grok 3 Mini"},
            {"id": "grok-2-1212",       "name": "Grok 2"},
        ],
        "defaultModel": "grok-3",
    },
    "claude": {
        "id": "claude",
        "name": "Claude",
        "url": "https://console.anthropic.com/settings/keys",
        "icon": "anthropic",
        "api_type": "anthropic",
        "api_base": "https://api.anthropic.com",
        "api_env_var": "ANTHROPIC_API_KEY",
        "api_docs": "https://console.anthropic.com/settings/keys",
        "key_prefix": "sk-ant-",
        "models": [
            {"id": "claude-opus-4-5",    "name": "Claude Opus 4.5"},
            {"id": "claude-sonnet-4-5",  "name": "Claude Sonnet 4.5"},
            {"id": "claude-3-7-sonnet-20250219", "name": "Claude 3.7 Sonnet"},
            {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet"},
        ],
        "defaultModel": "claude-sonnet-4-5",
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


def set_active_model(ai_id: str, model_id: str) -> bool:
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False
    valid_ids = {m["id"] for m in config.get("models", [])}
    if model_id not in valid_ids:
        return False
    _active_models[ai_id] = model_id
    return True
