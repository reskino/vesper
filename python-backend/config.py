import os
import shutil

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")


def find_chromium() -> str | None:
    """
    Return a path to a working Chromium/Chrome binary, or None to let
    Playwright use its own bundled headless-shell (which crashes in Replit's
    NixOS sandbox with SIGSEGV).

    Priority order:
      1. CHROMIUM_PATH env-var (user override)
      2. System chromium / chromium-browser on $PATH  (Nix-provided)
      3. google-chrome on $PATH (fallback)
    """
    override = os.environ.get("CHROMIUM_PATH", "").strip()
    if override and os.path.isfile(override):
        return override

    for name in ("chromium", "chromium-browser", "google-chrome", "google-chrome-stable"):
        path = shutil.which(name)
        if path:
            return path

    return None

os.makedirs(SESSIONS_DIR, exist_ok=True)
os.makedirs(LOGS_DIR, exist_ok=True)

# tier: "free" → works on free accounts / free-tier API keys
#        "plus" → requires paid subscription / paid API credits
#        "pro"  → requires top-tier paid plan
AI_CONFIGS = {
    # ── No-auth (completely free, no key needed) ──────────────────────────────
    "pollinations": {
        "id": "pollinations",
        "name": "Pollinations AI",
        "url": "https://pollinations.ai",
        "login_url": "https://pollinations.ai",
        "icon": "pollinations",
        "auth_mode": "none",
        "models": [
            {"id": "__auto__",          "name": "Auto — Best Available",         "tier": "free"},
            {"id": "openai",            "name": "GPT-4o (via Pollinations)",     "tier": "free"},
            {"id": "openai-large",      "name": "GPT-4.1 (via Pollinations)",    "tier": "free"},
            {"id": "mistral",           "name": "Mistral (via Pollinations)",    "tier": "free"},
            {"id": "claude-sonnet-3-7", "name": "Claude 3.7 (via Pollinations)", "tier": "free"},
            {"id": "deepseek",          "name": "DeepSeek (via Pollinations)",   "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "openai",
    },

    # ── Free-tier API key providers ───────────────────────────────────────────
    "groq": {
        "id": "groq",
        "name": "Groq",
        "url": "https://console.groq.com",
        "login_url": "https://console.groq.com/keys",
        "icon": "groq",
        "auth_mode": "api_key",
        "key_label": "Groq API Key",
        "key_prefix": "gsk_",
        "key_url": "https://console.groq.com/keys",
        "key_url_label": "Get free Groq API key (no credit card)",
        "key_note": "Free tier: ~1,000 requests/day. No credit card required.",
        "models": [
            {"id": "__auto__",                       "name": "Auto — Best Available",  "tier": "free"},
            {"id": "llama-3.3-70b-versatile",        "name": "Llama 3.3 70B",         "tier": "free"},
            {"id": "llama-3.1-8b-instant",           "name": "Llama 3.1 8B",          "tier": "free"},
            {"id": "gemma2-9b-it",                   "name": "Gemma 2 9B",            "tier": "free"},
            {"id": "llama-3.2-90b-vision-preview",   "name": "Llama 3.2 90B Vision",  "tier": "free"},
            {"id": "llama-3.2-11b-vision-preview",   "name": "Llama 3.2 11B Vision",  "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "llama-3.3-70b-versatile",
    },
    "gemini": {
        "id": "gemini",
        "name": "Google Gemini",
        "url": "https://aistudio.google.com",
        "login_url": "https://aistudio.google.com/apikey",
        "icon": "google",
        "auth_mode": "api_key",
        "key_label": "Google AI Studio API Key",
        "key_prefix": "AIza",
        "key_url": "https://aistudio.google.com/apikey",
        "key_url_label": "Get free Gemini API key",
        "key_note": "Free tier: 1,500 req/day on Flash, 50 req/day on Pro. No credit card.",
        "models": [
            {"id": "__auto__",                       "name": "Auto — Best Available",  "tier": "free"},
            {"id": "gemini-2.5-flash-preview-05-20", "name": "Gemini 2.5 Flash",      "tier": "free"},
            {"id": "gemini-2.0-flash",               "name": "Gemini 2.0 Flash",      "tier": "free"},
            {"id": "gemini-2.0-flash-lite",          "name": "Gemini 2.0 Flash Lite", "tier": "free"},
            {"id": "gemini-1.5-flash",               "name": "Gemini 1.5 Flash",      "tier": "free"},
            {"id": "gemini-1.5-flash-8b",            "name": "Gemini 1.5 Flash-8B",   "tier": "free"},
            {"id": "gemini-1.5-pro",                 "name": "Gemini 1.5 Pro",        "tier": "free"},
            {"id": "gemini-2.5-pro-preview-06-05",   "name": "Gemini 2.5 Pro",        "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "gemini-2.5-flash-preview-05-20",
    },
    "openrouter": {
        "id": "openrouter",
        "name": "OpenRouter",
        "url": "https://openrouter.ai",
        "login_url": "https://openrouter.ai/keys",
        "icon": "openrouter",
        "auth_mode": "api_key",
        "key_label": "OpenRouter API Key",
        "key_prefix": "sk-or-",
        "key_url": "https://openrouter.ai/keys",
        "key_url_label": "Get OpenRouter API key (free credits on signup)",
        "key_note": "Many models are completely free with :free tag. Free credits on signup.",
        "models": [
            {"id": "__auto__",                                    "name": "Auto — Best Available",         "tier": "free"},
            {"id": "openrouter/free",                             "name": "Auto — Best Free Available",    "tier": "free"},
            {"id": "meta-llama/llama-3.3-70b-instruct:free",     "name": "Llama 3.3 70B",                 "tier": "free"},
            {"id": "openai/gpt-oss-120b:free",                   "name": "OpenAI GPT OSS 120B",           "tier": "free"},
            {"id": "google/gemma-3-27b-it:free",                 "name": "Gemma 3 27B",                   "tier": "free"},
            {"id": "google/gemma-3-12b-it:free",                 "name": "Gemma 3 12B",                   "tier": "free"},
            {"id": "nvidia/nemotron-3-super-120b-a12b:free",     "name": "NVIDIA Nemotron 3 Super 120B",  "tier": "free"},
            {"id": "nvidia/nemotron-nano-9b-v2:free",            "name": "NVIDIA Nemotron Nano 9B",       "tier": "free"},
            {"id": "meta-llama/llama-3.2-3b-instruct:free",      "name": "Llama 3.2 3B (fast)",           "tier": "free"},
            {"id": "arcee-ai/trinity-large-preview:free",        "name": "Arcee Trinity Large",           "tier": "free"},
            {"id": "z-ai/glm-4.5-air:free",                      "name": "GLM 4.5 Air",                   "tier": "free"},
            {"id": "anthropic/claude-3.5-haiku",                 "name": "Claude 3.5 Haiku",              "tier": "plus"},
            {"id": "openai/gpt-4o-mini",                         "name": "GPT-4o Mini",                   "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "openrouter/free",
    },
    "mistral": {
        "id": "mistral",
        "name": "Mistral AI",
        "url": "https://console.mistral.ai",
        "login_url": "https://console.mistral.ai/api-keys",
        "icon": "mistral",
        "auth_mode": "api_key",
        "key_label": "Mistral API Key",
        "key_prefix": "",
        "key_url": "https://console.mistral.ai/api-keys",
        "key_url_label": "Get Mistral API key (free tier available)",
        "key_note": "Free tier available with rate limits. No credit card required initially.",
        "models": [
            {"id": "__auto__",               "name": "Auto — Best Available", "tier": "free"},
            {"id": "mistral-small-latest",   "name": "Mistral Small 3.1",     "tier": "free"},
            {"id": "mistral-large-latest",   "name": "Mistral Large 2",       "tier": "plus"},
            {"id": "codestral-latest",       "name": "Codestral",             "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "mistral-small-latest",
    },
    "cohere": {
        "id": "cohere",
        "name": "Cohere",
        "url": "https://dashboard.cohere.com",
        "login_url": "https://dashboard.cohere.com/api-keys",
        "icon": "cohere",
        "auth_mode": "api_key",
        "key_label": "Cohere API Key",
        "key_prefix": "",
        "key_url": "https://dashboard.cohere.com/api-keys",
        "key_url_label": "Get free Cohere API key (trial key, no credit card)",
        "key_note": "Trial API keys are free and have generous rate limits for testing.",
        "models": [
            {"id": "__auto__",         "name": "Auto — Best Available", "tier": "free"},
            {"id": "command-r",        "name": "Command R",             "tier": "free"},
            {"id": "command-r-plus",   "name": "Command R+",            "tier": "free"},
            {"id": "command-a-03-2025","name": "Command A",             "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "command-r",
    },
    "together": {
        "id": "together",
        "name": "Together AI",
        "url": "https://api.together.xyz",
        "login_url": "https://api.together.xyz/settings/api-keys",
        "icon": "together",
        "auth_mode": "api_key",
        "key_label": "Together AI API Key",
        "key_prefix": "",
        "key_url": "https://api.together.xyz/settings/api-keys",
        "key_url_label": "Get Together AI API key ($5 free credit on signup)",
        "key_note": "$5 free credit on signup. Runs top open-source models.",
        "models": [
            {"id": "__auto__",                                    "name": "Auto — Best Available",  "tier": "free"},
            {"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",    "name": "Llama 3.3 70B",          "tier": "free"},
            {"id": "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo","name": "Llama 3.1 8B Turbo",     "tier": "free"},
            {"id": "mistralai/Mixtral-8x7B-Instruct-v0.1",        "name": "Mixtral 8×7B",           "tier": "free"},
            {"id": "Qwen/Qwen2.5-72B-Instruct-Turbo",             "name": "Qwen 2.5 72B",           "tier": "free"},
            {"id": "deepseek-ai/DeepSeek-R1",                      "name": "DeepSeek R1",            "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    },
    "cerebras": {
        "id": "cerebras",
        "name": "Cerebras",
        "url": "https://cloud.cerebras.ai",
        "login_url": "https://cloud.cerebras.ai/platform/api-keys",
        "icon": "cerebras",
        "auth_mode": "api_key",
        "key_label": "Cerebras API Key",
        "key_prefix": "csk-",
        "key_url": "https://cloud.cerebras.ai/platform/api-keys",
        "key_url_label": "Get free Cerebras API key (fastest inference)",
        "key_note": "Free tier with rate limits. Ultra-fast inference on custom AI chips.",
        "models": [
            {"id": "__auto__",       "name": "Auto — Best Available", "tier": "free"},
            {"id": "llama-3.3-70b",  "name": "Llama 3.3 70B",         "tier": "free"},
            {"id": "llama3.1-8b",    "name": "Llama 3.1 8B",          "tier": "free"},
            {"id": "qwen-3-32b",     "name": "Qwen 3 32B",            "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "llama-3.3-70b",
    },
    "deepseek": {
        "id": "deepseek",
        "name": "DeepSeek",
        "url": "https://platform.deepseek.com",
        "login_url": "https://platform.deepseek.com/api_keys",
        "icon": "deepseek",
        "auth_mode": "api_key",
        "key_label": "DeepSeek API Key",
        "key_prefix": "sk-",
        "key_url": "https://platform.deepseek.com/api_keys",
        "key_url_label": "Get DeepSeek API key (very low cost, ~$0.14/1M tokens)",
        "key_note": "Extremely affordable. DeepSeek R1 rivals o1 at a fraction of the cost.",
        "models": [
            {"id": "__auto__",         "name": "Auto — Best Available", "tier": "free"},
            {"id": "deepseek-chat",    "name": "DeepSeek V3",           "tier": "free"},
            {"id": "deepseek-reasoner","name": "DeepSeek R1",           "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "deepseek-chat",
    },

    # ── Cookie / API key (web scraping-based) ─────────────────────────────────
    "chatgpt": {
        "id": "chatgpt",
        "name": "ChatGPT",
        "url": "https://chatgpt.com",
        "login_url": "https://chatgpt.com",
        "icon": "openai",
        "auth_mode": "api_key_or_cookies",
        "key_label": "OpenAI API Key",
        "key_prefix": "sk-",
        "key_url": "https://platform.openai.com/api-keys",
        "key_url_label": "Get OpenAI API key",
        "key_note": "API key bypasses Cloudflare and gives direct access. Cookies are unreliable from cloud servers.",
        "models": [
            {"id": "gpt-5-chat-latest", "name": "Latest (Auto-routed)",          "tier": "free"},
            {"id": "gpt-5.3",           "name": "Instant 5.3 — Everyday chats", "tier": "free"},
            {"id": "gpt-5.4",           "name": "Thinking 5.4 — Complex tasks", "tier": "plus"},
            {"id": "gpt-5.4-pro",       "name": "Pro 5.4 — Research-grade",     "tier": "pro"},
            {"id": "gpt-5.4-mini",      "name": "GPT-5.4 Mini (Fast)",          "tier": "free"},
            {"id": "gpt-5.4-nano",      "name": "GPT-5.4 Nano (Cheapest)",      "tier": "free"},
            {"id": "gpt-4o-mini",       "name": "GPT-4o Mini (Legacy free)",    "tier": "free"},
        ],
        "defaultModel": "gpt-5.3",
        "freeModel":    "gpt-5.3",
    },
    "grok": {
        "id": "grok",
        "name": "Grok",
        "url": "https://grok.com",
        "login_url": "https://grok.com",
        "icon": "xai",
        "auth_mode": "cookies",
        "models": [
            {"id": "__auto__",      "name": "Auto — Best Available",        "tier": "free"},
            {"id": "grok-3-mini",   "name": "Grok 3 Mini (Free)",           "tier": "free"},
            {"id": "grok-3",        "name": "Grok 3",                       "tier": "free"},
            {"id": "grok-4",        "name": "Grok 4.20 Fast (SuperGrok)",   "tier": "plus"},
            {"id": "grok-4-expert", "name": "Grok 4.20 Expert (SuperGrok)", "tier": "plus"},
            {"id": "grok-4-heavy",  "name": "Grok 4.20 Heavy (SuperGrok)",  "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "grok-3-mini",
    },
    "claude": {
        "id": "claude",
        "name": "Claude",
        "url": "https://claude.ai",
        "login_url": "https://claude.ai/new",
        "icon": "anthropic",
        "auth_mode": "api_key_or_cookies",
        "key_label": "Anthropic API Key",
        "key_prefix": "sk-ant-",
        "key_url": "https://console.anthropic.com/settings/keys",
        "key_url_label": "Get Anthropic API key",
        "key_note": "API key bypasses Cloudflare protection. Cookies are unreliable from cloud servers.",
        "models": [
            {"id": "__auto__",                   "name": "Auto — Best Available", "tier": "free"},
            {"id": "claude-3-5-haiku-20241022",  "name": "Claude 3.5 Haiku",     "tier": "free"},
            {"id": "claude-3-5-sonnet-20241022", "name": "Claude 3.5 Sonnet",    "tier": "plus"},
            {"id": "claude-3-7-sonnet-20250219", "name": "Claude 3.7 Sonnet",    "tier": "plus"},
            {"id": "claude-sonnet-4-5",          "name": "Claude Sonnet 4.5",    "tier": "plus"},
            {"id": "claude-opus-4-5",            "name": "Claude Opus 4.5",      "tier": "pro"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "claude-3-5-haiku-20241022",
    },
}

FALLBACK_ORDER = [
    "pollinations", "groq", "gemini", "openrouter", "mistral",
    "cerebras", "together", "deepseek", "cohere",
    "chatgpt", "grok", "claude",
]

DEFAULT_TIMEOUT = 120000
RESPONSE_POLL_INTERVAL = 2000
MAX_RESPONSE_WAIT = 180000

_active_models: dict = {}


AUTO_MODEL_ID = "__auto__"


def get_active_model(ai_id: str) -> str:
    if ai_id in _active_models:
        return _active_models[ai_id]
    config = AI_CONFIGS.get(ai_id, {})
    return config.get("defaultModel", AUTO_MODEL_ID)


def get_free_model(ai_id: str) -> str:
    config = AI_CONFIGS.get(ai_id, {})
    return config.get("freeModel", "")


def resolve_model(ai_id: str, model_id: str) -> str:
    """Resolve __auto__ to the provider's best real model ID."""
    if model_id != AUTO_MODEL_ID:
        return model_id
    config = AI_CONFIGS.get(ai_id, {})
    return config.get("freeModel", "") or config.get("defaultModel", "")


def set_active_model(ai_id: str, model_id: str) -> bool:
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False
    valid_ids = {m["id"] for m in config.get("models", [])}
    if model_id not in valid_ids:
        return False
    _active_models[ai_id] = model_id
    return True
