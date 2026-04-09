"""
api_client.py
Replaces playwright_utils.py — sends prompts via official REST APIs.

Supported backends:
  chatgpt  → OpenAI API (https://api.openai.com/v1)
  grok     → xAI API   (https://api.x.ai/v1, OpenAI-compatible)
  claude   → Anthropic API (https://api.anthropic.com)

API keys are read from environment variables first, then from a local
keys.json file stored in the sessions directory.
"""
import os
import json
import logging
import time
from typing import Tuple

from config import AI_CONFIGS, SESSIONS_DIR, get_active_model

logger = logging.getLogger(__name__)

KEYS_FILE = os.path.join(SESSIONS_DIR, "keys.json")

# ─── Key storage ─────────────────────────────────────────────────────────────

def _load_keys() -> dict:
    if os.path.exists(KEYS_FILE):
        try:
            with open(KEYS_FILE) as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def _save_keys(keys: dict):
    os.makedirs(SESSIONS_DIR, exist_ok=True)
    with open(KEYS_FILE, "w") as f:
        json.dump(keys, f, indent=2)


def get_api_key(ai_id: str) -> str | None:
    config = AI_CONFIGS.get(ai_id, {})
    env_var = config.get("api_env_var", "")
    if env_var:
        val = os.environ.get(env_var, "").strip()
        if val:
            return val
    keys = _load_keys()
    val = keys.get(ai_id, "").strip()
    return val or None


def set_api_key(ai_id: str, key: str) -> bool:
    if ai_id not in AI_CONFIGS:
        return False
    keys = _load_keys()
    keys[ai_id] = key.strip()
    _save_keys(keys)
    return True


def delete_api_key(ai_id: str) -> Tuple[bool, str]:
    keys = _load_keys()
    if ai_id in keys:
        del keys[ai_id]
        _save_keys(keys)
        return True, f"API key removed for {ai_id}"
    return False, f"No stored key found for {ai_id}"


def key_exists(ai_id: str) -> bool:
    return get_api_key(ai_id) is not None


def get_key_info(ai_id: str) -> dict:
    key = get_api_key(ai_id)
    config = AI_CONFIGS.get(ai_id, {})
    env_var = config.get("api_env_var", "")
    from_env = bool(env_var and os.environ.get(env_var, "").strip())
    if key:
        masked = key[:8] + "…" + key[-4:] if len(key) > 12 else "****"
        return {
            "hasSession": True,
            "maskedKey": masked,
            "fromEnv": from_env,
            "lastUsed": None,
        }
    return {"hasSession": False, "maskedKey": None, "fromEnv": False, "lastUsed": None}


# ─── Keep backward-compat aliases used in main.py / agent.py ─────────────────

def session_exists(ai_id: str) -> bool:
    return key_exists(ai_id)


def get_session_info(ai_id: str) -> dict:
    return get_key_info(ai_id)


def delete_session(ai_id: str) -> Tuple[bool, str]:
    return delete_api_key(ai_id)


# ─── Official API calls ───────────────────────────────────────────────────────

def _call_openai_compat(base_url: str, api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    try:
        from openai import OpenAI
        client = OpenAI(api_key=api_key, base_url=base_url)
        response = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            timeout=120,
        )
        text = response.choices[0].message.content or ""
        return True, text.strip(), ""
    except Exception as e:
        logger.error("OpenAI-compat error (%s): %s", base_url, e)
        return False, "", str(e)


def _call_anthropic(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    try:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        message = client.messages.create(
            model=model,
            max_tokens=8096,
            messages=[{"role": "user", "content": prompt}],
        )
        text = message.content[0].text if message.content else ""
        return True, text.strip(), ""
    except Exception as e:
        logger.error("Anthropic error: %s", e)
        return False, "", str(e)


def send_prompt(ai_id: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to the specified AI using its official API.
    Returns (success, response_text, error_message).
    """
    config = AI_CONFIGS.get(ai_id)
    if not config:
        return False, "", f"Unknown AI: {ai_id}"

    api_key = get_api_key(ai_id)
    if not api_key:
        return False, "", f"No API key configured for {ai_id}. Please add one on the API Keys page."

    model = get_active_model(ai_id)
    api_type = config.get("api_type", "openai")
    api_base = config.get("api_base", "https://api.openai.com/v1")

    start = time.time()
    logger.info("Sending prompt to %s (model=%s, %d chars)", ai_id, model, len(prompt))

    if api_type == "anthropic":
        success, text, error = _call_anthropic(api_key, model, prompt)
    else:
        success, text, error = _call_openai_compat(api_base, api_key, model, prompt)

    elapsed = int((time.time() - start) * 1000)
    if success:
        logger.info("Got response from %s in %dms (%d chars)", ai_id, elapsed, len(text))
    else:
        logger.warning("Failed call to %s in %dms: %s", ai_id, elapsed, error)

    return success, text, error


def check_ai_available(ai_id: str) -> bool:
    return key_exists(ai_id)
