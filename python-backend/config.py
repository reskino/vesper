import os

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")

os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

AI_CONFIGS = {
    "chatgpt": {
        "id": "chatgpt",
        "name": "ChatGPT",
        "url": "https://chat.openai.com",
        "icon": "openai",
        "selectors": {
            "input": "#prompt-textarea",
            "send_button": '[data-testid="send-button"]',
            "response": '[data-message-author-role="assistant"]',
            "response_done": '[data-testid="send-button"]:not([disabled])',
            "new_chat": 'a[href="/"]',
        },
        "login_check": "https://chat.openai.com",
        "login_indicator": "#prompt-textarea",
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
    },
}

FALLBACK_ORDER = ["chatgpt", "grok", "claude"]

DEFAULT_TIMEOUT = 120000
RESPONSE_POLL_INTERVAL = 2000
MAX_RESPONSE_WAIT = 180000
