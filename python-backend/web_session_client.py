"""
web_session_client.py

Replaces Playwright UI automation for sending prompts.
Uses saved session cookies + curl_cffi (Chrome TLS fingerprint impersonation)
to call each AI's internal web API directly — bypasses Cloudflare and
eliminates fragile UI selector issues entirely.

Login / cookie-saving is still done by Playwright (session_browser_worker).
This module only handles the "send a prompt and get a response" step.
"""
import json
import uuid
import logging
import re
from typing import Tuple

logger = logging.getLogger(__name__)

# ─── Cookie helpers ───────────────────────────────────────────────────────────

def _load_cookies(session_path: str, domain_hint: str = "") -> dict:
    """
    Convert a Playwright storage_state JSON file into a simple {name: value}
    cookie dict, filtered to cookies whose domain contains domain_hint.
    """
    try:
        with open(session_path) as f:
            state = json.load(f)
    except (FileNotFoundError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"Cannot read session file: {exc}") from exc

    result = {}
    for cookie in state.get("cookies", []):
        name = cookie.get("name", "")
        value = cookie.get("value", "")
        domain = cookie.get("domain", "")
        if not name or not value:
            continue
        if not domain_hint or domain_hint in domain:
            result[name] = value
    return result


def _impersonate_session(cookies: dict):
    """Return a curl_cffi session with Chrome124 fingerprint and cookies loaded."""
    from curl_cffi import requests as cf  # noqa: PLC0415 (lazy import)
    sess = cf.Session(impersonate="chrome124")
    sess.cookies.update(cookies)
    return sess


# ─── ChatGPT ─────────────────────────────────────────────────────────────────

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
                status = msg.get("status", "")
                parts = msg.get("content", {}).get("parts", [])
                if parts and isinstance(parts[0], str) and status != "in_progress":
                    final = parts[0]
                elif parts and isinstance(parts[0], str):
                    final = parts[0]
        except (json.JSONDecodeError, TypeError, KeyError):
            pass
    return final.strip()


def send_chatgpt(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    try:
        from curl_cffi import requests as cf  # noqa: PLC0415
    except ImportError:
        return False, "", "curl_cffi not installed — run: pip install curl_cffi"

    try:
        # Load ALL cookies (no domain filter) — ChatGPT auth tokens live on
        # .openai.com and chatgpt.com; filtering by domain alone misses them.
        cookies = _load_cookies(session_path, "")
        if not cookies:
            return False, "", "Session file is empty. Please re-import cookies on the Sessions page."

        sess = _impersonate_session(cookies)
        sess.headers.update({
            "Origin": "https://chatgpt.com",
            "Referer": "https://chatgpt.com/",
        })

        # Exchange session cookie → short-lived access token
        resp = sess.get("https://chatgpt.com/api/auth/session", timeout=30)
        data = resp.json()
        token = data.get("accessToken", "")
        if not token:
            return False, "", "ChatGPT session expired. Please re-login on the Sessions page."

        payload = {
            "action": "next",
            "messages": [{
                "id": str(uuid.uuid4()),
                "author": {"role": "user"},
                "content": {"content_type": "text", "parts": [prompt]},
                "metadata": {},
            }],
            "parent_message_id": str(uuid.uuid4()),
            "model": model,
            "timezone_offset_min": 0,
            "history_and_training_disabled": False,
            "conversation_mode": {"kind": "primary_assistant"},
        }

        resp = sess.post(
            "https://chatgpt.com/backend-api/conversation",
            json=payload,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "text/event-stream",
                "Content-Type": "application/json",
            },
            timeout=180,
        )

        if resp.status_code == 401:
            return False, "", "ChatGPT auth failed — please re-login."
        if resp.status_code == 403:
            return False, "", "ChatGPT access denied (403). Session may be blocked."
        if resp.status_code == 429:
            return False, "", "ChatGPT rate limit hit. Wait a few minutes and try again."
        if resp.status_code >= 400:
            return False, "", f"ChatGPT error {resp.status_code}: {resp.text[:300]}"

        text = _parse_chatgpt_sse(resp.text)
        if text:
            return True, text, ""
        return False, "", "ChatGPT returned an empty response."

    except Exception as exc:
        logger.error("ChatGPT send error: %s", exc, exc_info=True)
        return False, "", f"ChatGPT: {exc}"


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
        cookies = _load_cookies(session_path, "")  # all cookies — no domain filter
        if not cookies:
            return False, "", "Session file is empty. Please re-import cookies on the Sessions page."

        sess = _impersonate_session(cookies)
        sess.headers.update({
            "Content-Type": "application/json",
            "Origin": "https://claude.ai",
            "Referer": "https://claude.ai/",
        })

        # Discover the org UUID
        resp = sess.get("https://claude.ai/api/organizations", timeout=30)
        if resp.status_code != 200:
            return False, "", f"Claude session error ({resp.status_code}). Please re-login."
        orgs = resp.json()
        if not orgs or not isinstance(orgs, list):
            return False, "", "Claude session expired. Please re-login on the Sessions page."
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

        # Send message — SSE stream
        resp = sess.post(
            f"https://claude.ai/api/organizations/{org_id}/chat_conversations/{conv_id}/completion",
            json={"prompt": prompt, "timezone": "UTC", "attachments": [], "files": []},
            headers={"Accept": "text/event-stream"},
            timeout=180,
        )

        if resp.status_code != 200:
            return False, "", f"Claude error {resp.status_code}: {resp.text[:300]}"

        text = _parse_claude_sse(resp.text)
        if text:
            return True, text, ""
        return False, "", "Claude returned an empty response."

    except Exception as exc:
        logger.error("Claude send error: %s", exc, exc_info=True)
        return False, "", f"Claude: {exc}"


# ─── Grok ────────────────────────────────────────────────────────────────────

def _parse_grok_response(text: str) -> str:
    """
    Grok streams NDJSON (one JSON object per line).
    Each line may carry a token or the final complete message.
    """
    tokens: list[str] = []
    final = ""
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        if line.startswith("data: "):
            line = line[6:]
        try:
            obj = json.loads(line)
        except (json.JSONDecodeError, ValueError):
            continue

        # Streaming token format
        token = obj.get("token", "")
        if token:
            tokens.append(token)
            continue

        # Final message in various possible shapes
        for path in (
            ("result", "message"),
            ("message",),
            ("response",),
            ("answer",),
        ):
            val = obj
            for key in path:
                val = val.get(key, {}) if isinstance(val, dict) else None
            if isinstance(val, str) and val:
                final = val
                break

    if tokens:
        return "".join(tokens).strip()
    return final.strip()


def send_grok(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    try:
        from curl_cffi import requests as cf  # noqa: PLC0415
    except ImportError:
        return False, "", "curl_cffi not installed"

    try:
        cookies = _load_cookies(session_path, "")  # all cookies — no domain filter
        if not cookies:
            return False, "", "Session file is empty. Please re-import cookies on the Sessions page."

        sess = _impersonate_session(cookies)
        sess.headers.update({
            "Content-Type": "application/json",
            "Origin": "https://grok.x.ai",
            "Referer": "https://grok.x.ai/",
        })

        payload = {
            "temporary": True,
            "modelName": model,
            "message": prompt,
            "fileAttachments": [],
            "imageAttachments": [],
            "disableSearch": False,
            "enableImageGeneration": False,
            "returnFinalResponseOnly": True,
            "sendFinalMetadata": True,
        }

        # Try the primary endpoint first, then fallbacks
        endpoints = [
            "https://grok.x.ai/api/conversations/new",
            "https://grok.x.ai/api/ask",
            "https://grok.x.ai/api/rpc",
        ]

        for url in endpoints:
            try:
                resp = sess.post(url, json=payload, timeout=180)
                if resp.status_code == 404:
                    continue
                if resp.status_code == 401:
                    return False, "", "Grok session expired. Please re-login on the Sessions page."
                if resp.status_code >= 400:
                    continue
                text = _parse_grok_response(resp.text)
                if text:
                    return True, text, ""
            except Exception:
                continue

        return False, "", (
            "Could not reach Grok's API. The endpoint may have changed. "
            "Please re-login on the Sessions page to refresh your session."
        )

    except Exception as exc:
        logger.error("Grok send error: %s", exc, exc_info=True)
        return False, "", f"Grok: {exc}"


# ─── Dispatcher ──────────────────────────────────────────────────────────────

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
