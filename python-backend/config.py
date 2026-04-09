import os

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")

os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

AI_CONFIGS = {
    "chatgpt": {
        "id": "chatgpt",
        "name": "ChatGPT",
        "url": "https://chatgpt.com",
        "icon": "openai",
        "selectors": {
            "input": "#prompt-textarea",
            "send_button": '[data-testid="send-button"]',
            "response": '[data-message-author-role="assistant"]',
            "response_done": '[data-testid="send-button"]:not([disabled])',
            "new_chat": 'a[href="/"]',
        },
        "login_check": "https://chatgpt.com",
        "login_indicator": "#prompt-textarea",
        "models": [
            {"id": "gpt-4o",      "name": "GPT-4o",       "urlParam": "gpt-4o"},
            {"id": "gpt-4o-mini", "name": "GPT-4o mini",  "urlParam": "gpt-4o-mini"},
            {"id": "gpt-4",       "name": "GPT-4",        "urlParam": "gpt-4"},
            {"id": "o1",          "name": "o1",            "urlParam": "o1"},
            {"id": "o3-mini",     "name": "o3-mini",       "urlParam": "o3-mini"},
        ],
        "defaultModel": "gpt-4o",
    },
    "grok": {
        "id": "grok",
        "name": "Grok",
        "url": "https://grok.x.ai",
        "icon": "xai",
        "selectors": {
            "input": 'textarea[placeholder]',
            "send_button": 'button[type="submit"]',
            "response": '.message-bubble',
            "response_done": 'button[type="submit"]:not([disabled])',
        },
        "login_check": "https://grok.x.ai",
        "login_indicator": 'textarea[placeholder]',
        "models": [
            {"id": "grok-3",      "name": "Grok 3",       "urlParam": None},
            {"id": "grok-2",      "name": "Grok 2",       "urlParam": None},
        ],
        "defaultModel": "grok-3",
    },
    "claude": {
        "id": "claude",
        "name": "Claude",
        "url": "https://claude.ai",
        "icon": "anthropic",
        "selectors": {
            "input": '[contenteditable="true"]',
            "send_button": 'button[aria-label="Send Message"]',
            "response": '[data-is-streaming="false"]',
            "response_done": 'button[aria-label="Send Message"]:not([disabled])',
        },
        "login_check": "https://claude.ai/new",
        "login_indicator": '[contenteditable="true"]',
        "models": [
            {"id": "claude-3-7-sonnet",  "name": "Claude 3.7 Sonnet",  "urlParam": None},
            {"id": "claude-3-5-sonnet",  "name": "Claude 3.5 Sonnet",  "urlParam": None},
            {"id": "claude-3-opus",      "name": "Claude 3 Opus",      "urlParam": None},
        ],
        "defaultModel": "claude-3-7-sonnet",
    },
}

FALLBACK_ORDER = ["chatgpt", "grok", "claude"]

DEFAULT_TIMEOUT = 120000
RESPONSE_POLL_INTERVAL = 2000
MAX_RESPONSE_WAIT = 180000

# Runtime model selection (in-memory, resets on restart)
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


def get_model_url_param(ai_id: str) -> str | None:
    model_id = get_active_model(ai_id)
    config = AI_CONFIGS.get(ai_id, {})
    for m in config.get("models", []):
        if m["id"] == model_id:
            return m.get("urlParam")
    return None
