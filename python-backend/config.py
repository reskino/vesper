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
            {"id": "__auto__",                                  "name": "Auto — Best Available",      "tier": "free"},
            {"id": "openai/gpt-oss-120b",                       "name": "OpenAI GPT-OSS 120B",        "tier": "free"},
            {"id": "openai/gpt-oss-20b",                        "name": "OpenAI GPT-OSS 20B (1000 t/s)", "tier": "free"},
            {"id": "llama-3.3-70b-versatile",                   "name": "Llama 3.3 70B",              "tier": "free"},
            {"id": "llama-3.1-8b-instant",                      "name": "Llama 3.1 8B",               "tier": "free"},
            {"id": "meta-llama/llama-4-scout-17b-16e-instruct", "name": "Llama 4 Scout 17B",          "tier": "free"},
            {"id": "qwen/qwen3-32b",                             "name": "Qwen 3 32B",                 "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "openai/gpt-oss-120b",
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
            {"id": "__auto__",               "name": "Auto — Best Available",    "tier": "free"},
            {"id": "gemini-2.5-flash",       "name": "Gemini 2.5 Flash",        "tier": "free"},
            {"id": "gemini-2.5-flash-lite",  "name": "Gemini 2.5 Flash Lite",   "tier": "free"},
            {"id": "gemini-2.0-flash",       "name": "Gemini 2.0 Flash",        "tier": "free"},
            {"id": "gemini-2.0-flash-lite",  "name": "Gemini 2.0 Flash Lite",   "tier": "free"},
            {"id": "gemini-2.5-pro",         "name": "Gemini 2.5 Pro",          "tier": "plus"},
            {"id": "gemini-3-flash-preview", "name": "Gemini 3 Flash (Preview)","tier": "plus"},
            {"id": "gemini-3-pro-preview",   "name": "Gemini 3 Pro (Preview)",  "tier": "pro"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "gemini-2.5-flash",
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
            {"id": "__auto__",                       "name": "Auto — Best Available", "tier": "free"},
            {"id": "gpt-oss-120b",                   "name": "OpenAI GPT-OSS 120B",   "tier": "free"},
            {"id": "llama3.1-8b",                    "name": "Llama 3.1 8B",          "tier": "free"},
            {"id": "qwen-3-235b-a22b-instruct-2507", "name": "Qwen 3 235B",           "tier": "free"},
            {"id": "zai-glm-4.7",                    "name": "ZAI GLM 4.7",           "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "gpt-oss-120b",
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
            {"id": "gpt-4o",       "name": "GPT-4o (Latest)",        "tier": "free"},
            {"id": "gpt-4o-mini",  "name": "GPT-4o Mini (Fastest)",  "tier": "free"},
            {"id": "gpt-4.1",      "name": "GPT-4.1",                "tier": "free"},
            {"id": "gpt-4.1-mini", "name": "GPT-4.1 Mini",          "tier": "free"},
            {"id": "o3",           "name": "o3 (Reasoning)",         "tier": "plus"},
            {"id": "o4-mini",      "name": "o4-mini (Fast Reason)",  "tier": "plus"},
        ],
        "defaultModel": "gpt-4o",
        "freeModel":    "gpt-4o",
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
        "key_note": "API key gives direct access to all Claude models. Free tier (cookies): Haiku & Sonnet 3.5 with daily limits.",
        "models": [
            {"id": "__auto__",           "name": "Auto — Best Available",         "tier": "free"},
            {"id": "claude-haiku-4-5",   "name": "Claude Haiku 4.5 (Free, Fast)", "tier": "free"},
            {"id": "claude-sonnet-4-6",  "name": "Claude Sonnet 4.6",             "tier": "free"},
            {"id": "claude-opus-4-6",    "name": "Claude Opus 4.6 (Pro)",         "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "claude-haiku-4-5",
    },

    # ── New free-tier API providers ───────────────────────────────────────────
    "nvidia": {
        "id": "nvidia",
        "name": "NVIDIA NIM",
        "url": "https://build.nvidia.com",
        "login_url": "https://build.nvidia.com/explore/discover",
        "icon": "nvidia",
        "auth_mode": "api_key",
        "api_format": "openai_compat",
        "key_label": "NVIDIA API Key",
        "key_prefix": "nvapi-",
        "key_url": "https://build.nvidia.com/explore/discover",
        "key_url_label": "Get free NVIDIA NIM API key (189 models, 40 RPM)",
        "key_note": "Free tier with 40 RPM. Access to Llama 4, Mistral, Qwen3, DeepSeek-R1 and 180+ models.",
        "models": [
            {"id": "__auto__",                                    "name": "Auto — Best Available",        "tier": "free"},
            {"id": "meta/llama-3.3-70b-instruct",                 "name": "Llama 3.3 70B",                "tier": "free"},
            {"id": "meta/llama-4-maverick-17b-128e-instruct",     "name": "Llama 4 Maverick 17B",         "tier": "free"},
            {"id": "meta/llama-4-scout-17b-16e-instruct",         "name": "Llama 4 Scout 17B",            "tier": "free"},
            {"id": "nvidia/llama-3.3-nemotron-super-49b-v1",      "name": "Nemotron Super 49B",           "tier": "free"},
            {"id": "mistralai/mistral-large-2-instruct",          "name": "Mistral Large 2",              "tier": "free"},
            {"id": "deepseek-ai/deepseek-r1-distill-llama-8b",    "name": "DeepSeek R1 Distill 8B",       "tier": "free"},
            {"id": "microsoft/phi-4-mini-instruct",               "name": "Phi-4 Mini",                   "tier": "free"},
            {"id": "qwen/qwen3-coder-480b-a35b-instruct",         "name": "Qwen3 Coder 480B",             "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "meta/llama-3.3-70b-instruct",
    },
    "github": {
        "id": "github",
        "name": "GitHub Models",
        "url": "https://github.com/marketplace/models",
        "login_url": "https://github.com/marketplace/models",
        "icon": "github",
        "auth_mode": "api_key",
        "api_format": "openai_compat",
        "key_label": "GitHub Personal Access Token",
        "key_prefix": "github_pat_",
        "key_url": "https://github.com/settings/tokens",
        "key_url_label": "Get GitHub PAT (free, 10-15 RPM, 50-150 RPD)",
        "key_note": "Use a GitHub PAT with no special permissions. Free access to GPT-4o, Llama, DeepSeek-R1 and more.",
        "models": [
            {"id": "__auto__",                          "name": "Auto — Best Available",       "tier": "free"},
            {"id": "gpt-4o",                            "name": "GPT-4o",                      "tier": "free"},
            {"id": "gpt-4o-mini",                       "name": "GPT-4o Mini",                 "tier": "free"},
            {"id": "Meta-Llama-3.3-70B-Instruct",       "name": "Llama 3.3 70B",               "tier": "free"},
            {"id": "DeepSeek-R1",                       "name": "DeepSeek R1",                 "tier": "free"},
            {"id": "Phi-4",                             "name": "Phi-4",                       "tier": "free"},
            {"id": "Mistral-large-2411",                "name": "Mistral Large",               "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "gpt-4o",
    },
    "huggingface": {
        "id": "huggingface",
        "name": "Hugging Face",
        "url": "https://huggingface.co",
        "login_url": "https://huggingface.co/settings/tokens",
        "icon": "huggingface",
        "auth_mode": "api_key",
        "api_format": "openai_compat",
        "key_label": "HuggingFace API Token",
        "key_prefix": "hf_",
        "key_url": "https://huggingface.co/settings/tokens",
        "key_url_label": "Get free HuggingFace token ($0.10/mo free credits, 120 models)",
        "key_note": "Free tier includes $0.10/month in inference credits via the HuggingFace router. 120+ models.",
        "models": [
            {"id": "__auto__",                          "name": "Auto — Best Available",       "tier": "free"},
            {"id": "openai/gpt-oss-120b",               "name": "GPT-OSS 120B",                "tier": "free"},
            {"id": "deepseek-ai/DeepSeek-R1",           "name": "DeepSeek R1",                 "tier": "free"},
            {"id": "moonshotai/Kimi-K2.5",              "name": "Kimi K2.5",                   "tier": "free"},
            {"id": "Qwen/Qwen3.5-9B",                   "name": "Qwen 3.5 9B",                 "tier": "free"},
            {"id": "meta-llama/Llama-3.1-8B-Instruct",  "name": "Llama 3.1 8B",               "tier": "free"},
            {"id": "google/gemma-4-31B-it",             "name": "Gemma 4 31B",                 "tier": "free"},
            {"id": "Qwen/Qwen3-Coder-Next",             "name": "Qwen3 Coder (Latest)",        "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "Qwen/Qwen3.5-9B",
    },
    "kluster": {
        "id": "kluster",
        "name": "Kluster AI",
        "url": "https://platform.kluster.ai",
        "login_url": "https://platform.kluster.ai/apikeys",
        "icon": "kluster",
        "auth_mode": "api_key",
        "api_format": "openai_compat",
        "key_label": "Kluster AI API Key",
        "key_prefix": "",
        "key_url": "https://platform.kluster.ai/apikeys",
        "key_url_label": "Get free Kluster AI API key (Llama 4, DeepSeek-R1, Qwen3)",
        "key_note": "Free tier with undocumented rate limits. Access to Llama 4 Maverick, DeepSeek-R1, Qwen3-235B.",
        "models": [
            {"id": "__auto__",                                          "name": "Auto — Best Available",    "tier": "free"},
            {"id": "deepseek-ai/DeepSeek-R1-0528",                      "name": "DeepSeek R1 (May 2025)",   "tier": "free"},
            {"id": "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8", "name": "Llama 4 Maverick 17B",    "tier": "free"},
            {"id": "meta-llama/Llama-4-Scout-17B-16E-Instruct",         "name": "Llama 4 Scout 17B",       "tier": "free"},
            {"id": "klusterai/Meta-Llama-3.3-70B-Instruct-Turbo",       "name": "Llama 3.3 70B Turbo",     "tier": "free"},
            {"id": "Qwen/Qwen3-235B-A22B-FP8",                          "name": "Qwen3 235B",              "tier": "free"},
            {"id": "mistralai/Magistral-Small-2506",                     "name": "Magistral Small",         "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "klusterai/Meta-Llama-3.3-70B-Instruct-Turbo",
    },
    "siliconflow": {
        "id": "siliconflow",
        "name": "SiliconFlow",
        "url": "https://cloud.siliconflow.cn",
        "login_url": "https://cloud.siliconflow.cn/account/ak",
        "icon": "siliconflow",
        "auth_mode": "api_key",
        "api_format": "openai_compat",
        "key_label": "SiliconFlow API Key",
        "key_prefix": "sk-",
        "key_url": "https://cloud.siliconflow.cn/account/ak",
        "key_url_label": "Get free SiliconFlow API key (13 free models, 1K RPM)",
        "key_note": "Permanent free tier with 1K RPM and 50K TPM. Qwen3, DeepSeek-R1, GLM and more.",
        "models": [
            {"id": "__auto__",                                  "name": "Auto — Best Available",          "tier": "free"},
            {"id": "Qwen/Qwen3-8B",                             "name": "Qwen3 8B",                       "tier": "free"},
            {"id": "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B",  "name": "DeepSeek R1 Distill Qwen 7B",    "tier": "free"},
            {"id": "THUDM/glm-4-9b-chat",                       "name": "GLM-4 9B",                       "tier": "free"},
            {"id": "Qwen/Qwen2.5-7B-Instruct",                  "name": "Qwen 2.5 7B",                    "tier": "free"},
            {"id": "meta-llama/Meta-Llama-3.1-8B-Instruct",     "name": "Llama 3.1 8B",                   "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "Qwen/Qwen3-8B",
    },
    "zhipu": {
        "id": "zhipu",
        "name": "Zhipu AI",
        "url": "https://open.bigmodel.cn",
        "login_url": "https://open.bigmodel.cn/usercenter/apikeys",
        "icon": "zhipu",
        "auth_mode": "api_key",
        "api_format": "openai_compat",
        "key_label": "Zhipu AI API Key",
        "key_prefix": "",
        "key_url": "https://open.bigmodel.cn/usercenter/apikeys",
        "key_url_label": "Get free Zhipu AI API key (GLM models, limits undocumented)",
        "key_note": "Permanent free tier for GLM Flash models. High-quality Chinese AI lab, GLM-4 series.",
        "models": [
            {"id": "__auto__",      "name": "Auto — Best Available",  "tier": "free"},
            {"id": "glm-4-flash",   "name": "GLM-4 Flash (Free)",     "tier": "free"},
            {"id": "glm-4-air",     "name": "GLM-4 Air",              "tier": "free"},
            {"id": "glm-4-airx",    "name": "GLM-4 AirX (Fast)",      "tier": "free"},
            {"id": "glm-4",         "name": "GLM-4",                  "tier": "plus"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "glm-4-flash",
    },
    "llm7": {
        "id": "llm7",
        "name": "LLM7",
        "url": "https://llm7.io",
        "login_url": "https://token.llm7.io",
        "icon": "llm7",
        "auth_mode": "none",
        "api_format": "openai_compat",
        "models": [
            {"id": "__auto__",                                          "name": "Auto — Best Available",    "tier": "free"},
            {"id": "gpt-oss-20b",                                       "name": "GPT-OSS 20B",              "tier": "free"},
            {"id": "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",      "name": "Llama 3.1 8B Turbo",       "tier": "free"},
            {"id": "codestral-latest",                                  "name": "Codestral (Latest)",       "tier": "free"},
            {"id": "ministral-8b-2512",                                 "name": "Ministral 8B",             "tier": "free"},
            {"id": "GLM-4.6V-Flash",                                    "name": "GLM-4.6V Flash",           "tier": "free"},
        ],
        "defaultModel": "__auto__",
        "freeModel":    "gpt-oss-20b",
    },
}

FALLBACK_ORDER = [
    "pollinations", "llm7", "groq", "gemini", "openrouter", "mistral",
    "cerebras", "together", "deepseek", "cohere", "nvidia", "github",
    "huggingface", "kluster", "siliconflow", "zhipu",
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
