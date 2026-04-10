import os

SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")
LOGS_DIR = os.path.join(os.path.dirname(__file__), "logs")

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
            {"id": "openai",            "name": "GPT-4o (via Pollinations)",     "tier": "free"},
            {"id": "openai-large",      "name": "GPT-4.1 (via Pollinations)",    "tier": "free"},
            {"id": "mistral",           "name": "Mistral (via Pollinations)",    "tier": "free"},
            {"id": "claude-sonnet-3-7", "name": "Claude 3.7 (via Pollinations)", "tier": "free"},
            {"id": "deepseek",          "name": "DeepSeek (via Pollinations)",   "tier": "free"},
        ],
        "defaultModel": "openai",
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
            {"id": "llama-3.3-70b-versatile",        "name": "Llama 3.3 70B",         "tier": "free"},
            {"id": "llama-3.1-8b-instant",           "name": "Llama 3.1 8B",          "tier": "free"},
            {"id": "gemma2-9b-it",                   "name": "Gemma 2 9B",            "tier": "free"},
            {"id": "llama-3.2-90b-vision-preview",   "name": "Llama 3.2 90B Vision",  "tier": "free"},
            {"id": "llama-3.2-11b-vision-preview",   "name": "Llama 3.2 11B Vision",  "tier": "free"},
        ],
        "defaultModel": "llama-3.3-70b-versatile",
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
            {"id": "gemini-2.0-flash",       "name": "Gemini 2.0 Flash",       "tier": "free"},
            {"id": "gemini-2.0-flash-lite",  "name": "Gemini 2.0 Flash Lite",  "tier": "free"},
            {"id": "gemini-1.5-flash",       "name": "Gemini 1.5 Flash",       "tier": "free"},
            {"id": "gemini-1.5-flash-8b",    "name": "Gemini 1.5 Flash-8B",    "tier": "free"},
            {"id": "gemini-1.5-pro",         "name": "Gemini 1.5 Pro",         "tier": "free"},
            {"id": "gemini-2.5-pro-preview-06-05", "name": "Gemini 2.5 Pro",   "tier": "plus"},
        ],
        "defaultModel": "gemini-2.0-flash",
        "freeModel":    "gemini-2.0-flash",
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
            {"id": "meta-llama/llama-3.3-70b-instruct:free",     "name": "Llama 3.3 70B (free)",         "tier": "free"},
            {"id": "deepseek/deepseek-r1:free",                  "name": "DeepSeek R1 (free)",           "tier": "free"},
            {"id": "deepseek/deepseek-chat-v3-0324:free",        "name": "DeepSeek V3 (free)",           "tier": "free"},
            {"id": "google/gemini-2.0-flash-exp:free",           "name": "Gemini 2.0 Flash Exp (free)",  "tier": "free"},
            {"id": "mistralai/mistral-7b-instruct:free",         "name": "Mistral 7B (free)",            "tier": "free"},
            {"id": "qwen/qwen3-235b-a22b:free",                  "name": "Qwen3 235B (free)",            "tier": "free"},
            {"id": "microsoft/mai-ds-r1:free",                   "name": "Microsoft MAI DS R1 (free)",   "tier": "free"},
            {"id": "nousresearch/hermes-3-llama-3.1-405b:free",  "name": "Hermes 3 Llama 405B (free)",   "tier": "free"},
            {"id": "anthropic/claude-3.5-haiku",                 "name": "Claude 3.5 Haiku",             "tier": "plus"},
            {"id": "openai/gpt-4o-mini",                         "name": "GPT-4o Mini",                  "tier": "plus"},
        ],
        "defaultModel": "meta-llama/llama-3.3-70b-instruct:free",
        "freeModel":    "meta-llama/llama-3.3-70b-instruct:free",
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
            {"id": "mistral-small-latest",   "name": "Mistral Small",   "tier": "free"},
            {"id": "open-mistral-7b",        "name": "Mistral 7B",      "tier": "free"},
            {"id": "open-mixtral-8x7b",      "name": "Mixtral 8×7B",   "tier": "free"},
            {"id": "mistral-medium-latest",  "name": "Mistral Medium",  "tier": "plus"},
            {"id": "mistral-large-latest",   "name": "Mistral Large",   "tier": "plus"},
        ],
        "defaultModel": "mistral-small-latest",
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
            {"id": "command-r",       "name": "Command R",       "tier": "free"},
            {"id": "command-r-plus",  "name": "Command R+",      "tier": "free"},
            {"id": "command-a-03-2025","name": "Command A",       "tier": "plus"},
        ],
        "defaultModel": "command-r",
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
            {"id": "meta-llama/Llama-3.3-70B-Instruct-Turbo",   "name": "Llama 3.3 70B",          "tier": "free"},
            {"id": "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo","name": "Llama 3.1 8B Turbo",     "tier": "free"},
            {"id": "mistralai/Mixtral-8x7B-Instruct-v0.1",       "name": "Mixtral 8×7B",           "tier": "free"},
            {"id": "Qwen/Qwen2.5-72B-Instruct-Turbo",            "name": "Qwen 2.5 72B",           "tier": "free"},
            {"id": "deepseek-ai/DeepSeek-R1",                     "name": "DeepSeek R1",            "tier": "plus"},
        ],
        "defaultModel": "meta-llama/Llama-3.3-70B-Instruct-Turbo",
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
            {"id": "llama-3.3-70b",  "name": "Llama 3.3 70B",  "tier": "free"},
            {"id": "llama3.1-8b",    "name": "Llama 3.1 8B",   "tier": "free"},
            {"id": "qwen-3-32b",     "name": "Qwen 3 32B",     "tier": "free"},
        ],
        "defaultModel": "llama-3.3-70b",
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
            {"id": "deepseek-chat",    "name": "DeepSeek V3",    "tier": "free"},
            {"id": "deepseek-reasoner","name": "DeepSeek R1",    "tier": "free"},
        ],
        "defaultModel": "deepseek-chat",
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
            {"id": "gpt-4o-mini", "name": "GPT-4o Mini",  "tier": "free"},
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
        "auth_mode": "cookies",
        "models": [
            {"id": "grok-3-mini", "name": "Grok 3 Mini", "tier": "free"},
            {"id": "grok-2",      "name": "Grok 2",       "tier": "free"},
            {"id": "grok-3",      "name": "Grok 3",       "tier": "plus"},
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
        "auth_mode": "api_key_or_cookies",
        "key_label": "Anthropic API Key",
        "key_prefix": "sk-ant-",
        "key_url": "https://console.anthropic.com/settings/keys",
        "key_url_label": "Get Anthropic API key",
        "key_note": "API key bypasses Cloudflare protection. Cookies are unreliable from cloud servers.",
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

FALLBACK_ORDER = [
    "pollinations", "groq", "gemini", "openrouter", "mistral",
    "cerebras", "together", "deepseek", "cohere",
    "chatgpt", "grok", "claude",
]

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
