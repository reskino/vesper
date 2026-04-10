"""
web_session_client.py

Sends prompts to ChatGPT / Claude / Grok using saved browser cookies and
curl_cffi (Chrome TLS-fingerprint impersonation).

ChatGPT  → backend-anon + sentinel PoW  (no /api/auth/session needed)
Claude   → claude.ai internal API
Grok     → grok.com API  (moved from grok.x.ai)
"""
import base64
import hashlib
import json
import logging
import time
import uuid
from typing import Tuple

from config import get_free_model

logger = logging.getLogger(__name__)


# ─── Cookie helpers ────────────────────────────────────────────────────────────

def _load_cookies(session_path: str, domain_hint: str = "") -> dict:
    """
    Convert a Playwright storage_state JSON file into a simple {name: value}
    cookie dict.  Pass domain_hint="" to load everything.
    """
    try:
        with open(session_path) as f:
            state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot read session file: {exc}") from exc

    result = {}
    for cookie in state.get("cookies", []):
        name  = cookie.get("name", "")
        value = cookie.get("value", "")
        domain = cookie.get("domain", "")
        if not name or not value:
            continue
        if not domain_hint or domain_hint in domain:
            result[name] = value
    return result


def _impersonate_session(cookies: dict):
    """Return a curl_cffi Session with Chrome 124 TLS fingerprint + cookies."""
    from curl_cffi import requests as cf
    sess = cf.Session(impersonate="chrome124")
    sess.cookies.update(cookies)
    return sess


def _chrome_headers(origin: str, referer: str, extra: dict | None = None) -> dict:
    """Standard headers that make requests look like Chrome 124."""
    h = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Origin": origin,
        "Referer": referer,
        "sec-ch-ua": '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
    }
    if extra:
        h.update(extra)
    return h


# ─── ChatGPT ──────────────────────────────────────────────────────────────────

def _solve_chatgpt_pow(pow_data: dict) -> str:
    """
    Solve ChatGPT's sentinel Proof-of-Work challenge.

    The server sends { seed, difficulty }.  We increment a counter until
    SHA3-512(json([seed, counter])) has enough leading zero bits, then
    base64-encode the winning value as  "gAAAAAB" + b64(json([seed, counter])).
    """
    seed       = pow_data.get("seed", "")
    difficulty = pow_data.get("difficulty", "000000")
    if not seed:
        return ""

    # How many leading zero bits are required?
    required_bits = 0
    for ch in difficulty:
        nibble = int(ch, 16)
        if nibble == 0:
            required_bits += 4
        else:
            required_bits += 4 - nibble.bit_length()
            break

    start = time.time()
    for counter in range(10_000_000):
        candidate = json.dumps([seed, counter], separators=(",", ":"))
        digest = hashlib.sha3_512(candidate.encode()).digest()

        # Count leading zero bits
        bits = 0
        for byte in digest:
            if byte == 0:
                bits += 8
            else:
                bits += 8 - byte.bit_length()
                break

        if bits >= required_bits:
            token = "gAAAAAB" + base64.b64encode(candidate.encode()).decode()
            logger.debug("ChatGPT PoW solved in %d attempts (%.2fs)", counter, time.time() - start)
            return token

    logger.warning("ChatGPT PoW: could not solve in 10M attempts")
    return ""


def _parse_chatgpt_sse(text: str) -> str:
    """Walk ChatGPT SSE lines and return the last complete assistant message."""
    final = ""
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        if raw == "[DONE]":
            break
        try:
            data = json.loads(raw)
            msg = data.get("message") or {}
            if msg.get("author", {}).get("role") == "assistant":
                parts = msg.get("content", {}).get("parts", [])
                if parts and isinstance(parts[0], str):
                    final = parts[0]
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
    return final.strip()


def send_chatgpt(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to ChatGPT using the backend-anon API with sentinel PoW.
    Does NOT require /api/auth/session (avoids Cloudflare block).
    Session cookies are loaded to associate the request with the user's account.
    """
    try:
        from curl_cffi import requests as cf  # noqa: PLC0415
    except ImportError:
        return False, "", "curl_cffi not installed — run: pip install curl_cffi"

    try:
        cookies = _load_cookies(session_path, "")
        if not cookies:
            return False, "", "Session file is empty. Please re-import your ChatGPT cookies."

        sess = _impersonate_session(cookies)
        device_id = str(uuid.uuid4())

        base_headers = _chrome_headers(
            "https://chatgpt.com",
            "https://chatgpt.com/",
            {"oai-device-id": device_id, "Content-Type": "application/json"},
        )
        sess.headers.update(base_headers)

        # ── Step 1: get sentinel token (+ optional PoW spec) ─────────────────
        req_resp = sess.post(
            "https://chatgpt.com/backend-anon/sentinel/chat-requirements",
            json={},
            timeout=30,
        )
        logger.debug("ChatGPT sentinel status=%s", req_resp.status_code)

        if req_resp.status_code == 403:
            return False, "", (
                "ChatGPT is blocking our request (Cloudflare 403 on sentinel). "
                "Re-export your cookies while logged in on chatgpt.com, then re-import."
            )
        if req_resp.status_code != 200:
            return False, "", f"ChatGPT sentinel failed ({req_resp.status_code})."

        try:
            req_data = req_resp.json()
        except Exception:
            return False, "", "ChatGPT sentinel returned unexpected data."

        sentinel_token = req_data.get("token", "")

        # ── Step 2: solve PoW if required ─────────────────────────────────────
        proof_token = ""
        pow_spec = req_data.get("proofofwork") or {}
        if pow_spec.get("required"):
            proof_token = _solve_chatgpt_pow(pow_spec)

        # ── Step 3: send conversation ──────────────────────────────────────────
        def _do_conversation(mdl: str):
            payload = {
                "action": "next",
                "messages": [{
                    "id": str(uuid.uuid4()),
                    "author": {"role": "user"},
                    "content": {"content_type": "text", "parts": [prompt]},
                    "metadata": {},
                }],
                "parent_message_id": str(uuid.uuid4()),
                "model": mdl,
                "timezone_offset_min": 0,
                "history_and_training_disabled": False,
                "conversation_mode": {"kind": "primary_assistant"},
            }
            extra = {"openai-sentinel-chat-requirements-token": sentinel_token}
            if proof_token:
                extra["openai-sentinel-proof-token"] = proof_token

            return sess.post(
                "https://chatgpt.com/backend-anon/conversation",
                json=payload,
                headers=extra,
                timeout=180,
            )

        resp = _do_conversation(model)
        logger.debug("ChatGPT conversation status=%s", resp.status_code)

        if resp.status_code == 401:
            return False, "", "ChatGPT: not authenticated — please re-import your cookies."
        if resp.status_code == 403:
            body = resp.text.lower()
            if any(k in body for k in ("subscri", "plus", "upgrade", "not available", "plan")):
                free_model = get_free_model("chatgpt")
                if free_model and free_model != model:
                    logger.info("ChatGPT: %s requires paid plan, retrying with %s", model, free_model)
                    resp2 = _do_conversation(free_model)
                    if resp2.status_code == 200:
                        text = _parse_chatgpt_sse(resp2.text)
                        if text:
                            note = (
                                f"\n\n_(Answered with **GPT-4o mini** — your account doesn't have "
                                f"access to **{model}**. Upgrade to ChatGPT Plus for premium models.)_"
                            )
                            return True, text + note, ""
            return False, "", (
                "ChatGPT access denied (403). Your account may need a subscription "
                "for this model — try switching to GPT-4o mini (free)."
            )
        if resp.status_code == 429:
            return False, "", "ChatGPT rate limit hit. Wait a minute and try again."
        if resp.status_code >= 400:
            return False, "", f"ChatGPT error {resp.status_code}: {resp.text[:300]}"

        text = _parse_chatgpt_sse(resp.text)
        if text:
            return True, text, ""
        return False, "", "ChatGPT returned an empty response."

    except Exception as exc:
        logger.error("ChatGPT send error: %s", exc, exc_info=True)
        return False, "", f"ChatGPT error: {exc}"


# ─── Claude ───────────────────────────────────────────────────────────────────

def _parse_claude_sse(text: str) -> str:
    """Reconstruct the full response from Claude's text_delta SSE events."""
    chunks: list[str] = []
    for line in text.splitlines():
        if not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        try:
            event = json.loads(raw)
            etype = event.get("type", "")
            if etype == "content_block_delta":
                delta = event.get("delta", {})
                if delta.get("type") == "text_delta":
                    chunks.append(delta.get("text", ""))
            elif etype == "message_stop":
                break
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
    return "".join(chunks).strip()


def send_claude(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    try:
        from curl_cffi import requests as cf  # noqa: PLC0415
    except ImportError:
        return False, "", "curl_cffi not installed"

    try:
        cookies = _load_cookies(session_path, "")
        if not cookies:
            return False, "", "Session file is empty. Please re-import your Claude cookies."

        sess = _impersonate_session(cookies)
        sess.headers.update(_chrome_headers(
            "https://claude.ai",
            "https://claude.ai/",
            {"Content-Type": "application/json"},
        ))

        # Discover the org UUID
        resp = sess.get("https://claude.ai/api/organizations", timeout=30)
        if resp.status_code == 403:
            return False, "", "Claude blocked the request — re-import cookies from claude.ai."
        if resp.status_code != 200:
            return False, "", f"Claude session error ({resp.status_code}). Please re-import cookies."
        try:
            orgs = resp.json()
        except Exception:
            return False, "", "Claude returned unexpected data on org check."
        if not orgs or not isinstance(orgs, list):
            return False, "", "Claude session expired. Please re-import cookies from claude.ai."
        org_id = orgs[0]["uuid"]

        # Open a new conversation
        conv_resp = sess.post(
            f"https://claude.ai/api/organizations/{org_id}/chat_conversations",
            json={"uuid": str(uuid.uuid4()), "name": ""},
            timeout=30,
        )
        if conv_resp.status_code not in (200, 201):
            return False, "", f"Could not create Claude conversation ({conv_resp.status_code})"
        conv_id = conv_resp.json()["uuid"]

        def _claude_completion(mdl: str, cid: str):
            return sess.post(
                f"https://claude.ai/api/organizations/{org_id}/chat_conversations/{cid}/completion",
                json={
                    "prompt": prompt,
                    "model": mdl,
                    "timezone": "UTC",
                    "attachments": [],
                    "files": [],
                },
                headers={"Accept": "text/event-stream"},
                timeout=180,
            )

        resp = _claude_completion(model, conv_id)

        if resp.status_code in (400, 403):
            body = resp.text.lower()
            if any(k in body for k in ("subscri", "pro", "upgrade", "not available", "plan", "permission")):
                free_model = get_free_model("claude")
                if free_model and free_model != model:
                    logger.info("Claude: %s unavailable, retrying with %s", model, free_model)
                    conv2 = sess.post(
                        f"https://claude.ai/api/organizations/{org_id}/chat_conversations",
                        json={"uuid": str(uuid.uuid4()), "name": ""},
                        timeout=30,
                    )
                    if conv2.status_code in (200, 201):
                        resp = _claude_completion(free_model, conv2.json()["uuid"])
                        if resp.status_code == 200:
                            text = _parse_claude_sse(resp.text)
                            if text:
                                note = (
                                    f"\n\n_(Answered with **Claude 3.5 Haiku** — your account doesn't "
                                    f"have access to **{model}**. Upgrade to Claude Pro for premium models.)_"
                                )
                                return True, text + note, ""

        if resp.status_code != 200:
            return False, "", f"Claude error {resp.status_code}: {resp.text[:300]}"

        text = _parse_claude_sse(resp.text)
        if text:
            return True, text, ""
        return False, "", "Claude returned an empty response."

    except Exception as exc:
        logger.error("Claude send error: %s", exc, exc_info=True)
        return False, "", f"Claude error: {exc}"


# ─── Grok ─────────────────────────────────────────────────────────────────────

def _extract_nested(obj: dict, *paths) -> str:
    """Try multiple key paths on a dict and return the first non-empty string found."""
    for path in paths:
        val = obj
        for key in path:
            if not isinstance(val, dict):
                val = None
                break
            val = val.get(key)
        if isinstance(val, str) and val.strip():
            return val.strip()
    return ""


def _parse_grok_response(text: str) -> str:
    """
    Grok streams NDJSON — each line is a JSON object.
    Response shapes vary:
      • Streaming token:   {"result": {"response": {"token": "word "}}}
      • Final message:     {"result": {"response": {"message": "full text", "isSoftStop": true}}}
      • Alt final shape:   {"result": {"message": "full text"}}
      • Direct shapes:     {"message": "..."}, {"response": "..."}, {"answer": "..."}
    With returnFinalResponseOnly=true only the last line(s) carry the full text.
    """
    tokens: list[str] = []
    final = ""

    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        if line.startswith("data: "):
            line = line[6:].strip()
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue
        if not isinstance(obj, dict):
            continue

        # Streaming token — result.response.token OR token at top level
        token = _extract_nested(obj,
            ("result", "response", "token"),
            ("token",),
        )
        if token:
            tokens.append(token)
            continue

        # Final complete message — confirmed from mem0ai/grok3-api reverse-engineering:
        # The authoritative path is result.response.modelResponse.message
        msg = _extract_nested(obj,
            ("result", "response", "modelResponse", "message"),  # confirmed correct shape
            ("result", "response", "message"),                    # fallback
            ("result", "message"),                                # older shape
            ("result", "modelResponse", "message"),
            ("message",),
            ("response",),
            ("answer",),
        )
        if msg:
            final = msg

    # Prefer the final complete message; fall back to assembled tokens
    result = final or "".join(tokens)
    return result.strip()


def send_grok(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to Grok via grok.com (the domain moved from grok.x.ai in 2025).
    Falls back to x.com API if grok.com fails.
    """
    try:
        from curl_cffi import requests as cf  # noqa: PLC0415
    except ImportError:
        return False, "", "curl_cffi not installed"

    try:
        cookies = _load_cookies(session_path, "")
        if not cookies:
            return False, "", "Session file is empty. Please re-import your Grok cookies."

        sess = _impersonate_session(cookies)

        # ── Try grok.com first (primary domain as of 2025) ─────────────────────
        grok_headers = _chrome_headers(
            "https://grok.com",
            "https://grok.com/",
            {"Content-Type": "application/json"},
        )

        # Payload structure confirmed by mem0ai/grok3-api reverse-engineering
        payload_grok_com = {
            "temporary": False,
            "modelName": model,
            "message": prompt,
            "fileAttachments": [],
            "imageAttachments": [],
            "disableSearch": False,
            "enableImageGeneration": False,
            "returnImageBytes": False,
            "returnRawGrokInXaiRequest": False,
            "enableImageStreaming": False,
            "forceConcise": False,
            "toolOverrides": {},
            "enableSideBySide": False,
            "isPreset": False,
            "sendFinalMetadata": True,
            "customInstructions": "",
            "deepsearchPreset": "",
            "isReasoning": False,
        }

        # Only use the verified working API endpoint (the others return HTML)
        grok_api_url = "https://grok.com/rest/app-chat/conversations/new"

        try:
            resp = sess.post(grok_api_url, json=payload_grok_com, headers=grok_headers, timeout=120)
            logger.info("Grok %s → %s", grok_api_url, resp.status_code)
            if resp.status_code == 401:
                return False, "", "Grok session expired — please re-import cookies from grok.com while logged in."
            if resp.status_code == 403:
                body = resp.text.lower()
                if any(k in body for k in ("subscri", "premium", "upgrade", "plan")):
                    free_model = get_free_model("grok")
                    if free_model and free_model != model:
                        resp2 = sess.post(
                            grok_api_url,
                            json={**payload_grok_com, "modelName": free_model},
                            headers=grok_headers,
                            timeout=120,
                        )
                        if resp2.status_code == 200:
                            text = _parse_grok_response(resp2.text)
                            if text:
                                note = (
                                    f"\n\n_(Answered with **Grok 3 Mini** — your account doesn't "
                                    f"have access to **{model}**.)_"
                                )
                                return True, text + note, ""
                return False, "", f"Grok returned 403 — check your cookies or account plan."
            if resp.status_code >= 400:
                return False, "", f"Grok returned HTTP {resp.status_code} — please re-import cookies."
            logger.debug("Grok raw response (first 500): %s", resp.text[:500])
            text = _parse_grok_response(resp.text)
            if text:
                return True, text, ""
            return False, "", f"Grok returned an unrecognized response format. Raw: {resp.text[:200]}"
        except Exception as e:
            logger.error("Grok request failed: %s", e, exc_info=True)
            return False, "", f"Grok connection error: {e}"

    except Exception as exc:
        logger.error("Grok send error: %s", exc, exc_info=True)
        return False, "", f"Grok error: {exc}"


# ─── Official API key senders (bypass Cloudflare) ────────────────────────────

def _send_chatgpt_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via official OpenAI API (api.openai.com) using an API key."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.openai.com/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"].strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        if exc.code == 401:
            return False, "", "OpenAI API key is invalid or expired. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "OpenAI rate limit hit. Wait a moment and try again."
        return False, "", f"OpenAI API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("ChatGPT API key send error: %s", exc, exc_info=True)
        return False, "", f"ChatGPT (API key): {exc}"


def _send_claude_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via official Anthropic API (api.anthropic.com) using an API key."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "max_tokens": 4096,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=body,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        text = data["content"][0]["text"].strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        if exc.code == 401:
            return False, "", "Anthropic API key is invalid or expired. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "Anthropic rate limit hit. Wait a moment and try again."
        return False, "", f"Anthropic API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Claude API key send error: %s", exc, exc_info=True)
        return False, "", f"Claude (API key): {exc}"


def _send_groq_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via Groq's free API (OpenAI-compatible). Free tier: 1000 req/day, no credit card."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.groq.com/openai/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"].strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        if exc.code == 401:
            return False, "", "Groq API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "Groq rate limit hit (free tier: 1000 req/day). Try again later."
        return False, "", f"Groq API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Groq API send error: %s", exc, exc_info=True)
        return False, "", f"Groq error: {exc}"


def send_pollinations(model: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send via Pollinations.ai — completely free, no API key required.
    OpenAI-compatible endpoint: https://text.pollinations.ai/openai
    Models: openai (GPT-4o), openai-large (GPT-4.1), mistral, claude-sonnet-3-7, deepseek
    """
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "private": True,
        }).encode()
        req = urllib.request.Request(
            "https://text.pollinations.ai/openai",
            data=body,
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Accept": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"].strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        return False, "", f"Pollinations API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Pollinations send error: %s", exc, exc_info=True)
        return False, "", f"Pollinations error: {exc}"


_API_KEY_DISPATCH = {
    "chatgpt": _send_chatgpt_api,
    "claude":  _send_claude_api,
    "groq":    _send_groq_api,
}


def send_via_api_key(ai_id: str, api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send a prompt using the stored API key (bypasses Cloudflare web session issues)."""
    fn = _API_KEY_DISPATCH.get(ai_id)
    if fn is None:
        return False, "", f"No API key handler for '{ai_id}'"
    logger.info("Sending to %s via API key (model=%s)", ai_id, model)
    return fn(api_key, model, prompt)


# ─── Dispatcher ───────────────────────────────────────────────────────────────

_DISPATCH = {
    "chatgpt": send_chatgpt,
    "claude":  send_claude,
    "grok":    send_grok,
}


def send_prompt_via_session(
    ai_id: str, session_path: str, model: str, prompt: str
) -> Tuple[bool, str, str]:
    """Route to the correct AI handler."""
    fn = _DISPATCH.get(ai_id)
    if fn is None:
        return False, "", f"No web-session handler for '{ai_id}'"
    return fn(session_path, model, prompt)
