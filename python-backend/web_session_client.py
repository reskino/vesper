"""
web_session_client.py

Sends prompts to ChatGPT / Claude / Grok using saved browser cookies.

ChatGPT  → Playwright (real Chromium, bypasses bot detection) with curl_cffi fallback
Claude   → curl_cffi Chrome-impersonation → claude.ai internal API
Grok     → Playwright (real Chromium + route interception) with curl_cffi fallback
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


def _impersonate_session(cookies: dict, impersonate: str = "chrome136"):
    """Return a curl_cffi Session with a modern Chrome TLS fingerprint + cookies."""
    from curl_cffi import requests as cf
    sess = cf.Session(impersonate=impersonate)
    sess.cookies.update(cookies)
    return sess


def _chrome_headers(origin: str, referer: str, extra: dict | None = None,
                    chrome_version: str = "136") -> dict:
    """Standard headers that make requests look like a modern Chrome browser."""
    h = {
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Origin": origin,
        "Referer": referer,
        "sec-ch-ua": f'"Chromium";v="{chrome_version}", "Google Chrome";v="{chrome_version}", "Not-A.Brand";v="24"',
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

# o-series reasoning models need reasoning_effort in the payload.
_CHATGPT_REASONING_EFFORT: dict[str, str] = {
    "o4-mini":      "medium",
    "o4-mini-high": "high",
    "o4":           "high",
    "o3":           "high",
    "o3-pro":       "xhigh",
    "o3-mini":      "medium",
    "o1":           "medium",
    "o1-pro":       "high",
}

_CHATGPT_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36"
)


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


def _chatgpt_playwright_fetch(session_path: str, model: str, prompt: str) -> Tuple[int, str]:
    """
    Send a ChatGPT request via a real Playwright/Chromium browser.

    WHY: curl_cffi triggers OpenAI's "Unusual activity" bot detector even with
    Chrome TLS-fingerprint impersonation.  A real Chromium binary passes the
    Cloudflare JS challenge on page.goto() and makes subsequent fetch() calls
    from a legitimate browser context — bypassing bot detection entirely.

    FLOW:
    1. Launch system Chromium with user cookies (storage_state).
    2. Navigate to chatgpt.com → Cloudflare challenge runs, __cf_bm refreshes.
    3. page.evaluate() → POST /backend-anon/sentinel/chat-requirements in-browser.
    4. Solve PoW in Python (SHA3-512, rarely required for logged-in users).
    5. page.evaluate() → POST /backend-anon/conversation in-browser with sentinel token.
    6. Return (status_code, raw_sse_body).
    """
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    model = {"__auto__": "gpt-4o"}.get(model, model)
    effort = _CHATGPT_REASONING_EFFORT.get(model)

    result: dict = {"status": 0, "body": ""}

    with sync_playwright() as p:
        from config import find_chromium  # noqa: PLC0415
        _chrome_exe = find_chromium()
        _launch_kw: dict = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-blink-features=AutomationControlled",
            ],
        }
        if _chrome_exe:
            _launch_kw["executable_path"] = _chrome_exe

        browser = p.chromium.launch(**_launch_kw)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=_CHATGPT_UA,
            storage_state=session_path,
        )
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = context.new_page()
        page.set_default_timeout(120_000)

        # ── Navigate to chatgpt.com (Cloudflare challenge runs here) ──────────
        try:
            page.goto("https://chatgpt.com/", wait_until="domcontentloaded", timeout=35_000)
            page.wait_for_timeout(2_000)
        except Exception as nav_err:
            logger.warning("ChatGPT Playwright: navigation issue: %s", nav_err)

        # ── Check for auth wall ───────────────────────────────────────────────
        page_url = page.url or ""
        page_title = (page.title() or "").lower()
        if any(k in page_url for k in ("/auth", "/login", "/signin")) or \
           any(k in page_title for k in ("sign in", "log in", "login")):
            browser.close()
            return 401, '{"error": "Not authenticated — cookies appear expired or invalid"}'

        # ── Step 1: sentinel token (from inside browser) ──────────────────────
        try:
            sentinel_result = page.evaluate("""
                async () => {
                    const deviceId = crypto.randomUUID();
                    const resp = await fetch('/backend-anon/sentinel/chat-requirements', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'oai-device-id': deviceId },
                        body: JSON.stringify({}),
                        credentials: 'include',
                    });
                    const data = await resp.json();
                    return { status: resp.status, data: data, deviceId: deviceId };
                }
            """)
        except Exception as sent_err:
            browser.close()
            logger.error("ChatGPT Playwright: sentinel evaluate error: %s", sent_err)
            return 0, f"Sentinel evaluate error: {sent_err}"

        logger.debug("ChatGPT Playwright: sentinel status=%s", sentinel_result.get("status"))

        if not isinstance(sentinel_result, dict) or sentinel_result.get("status") != 200:
            browser.close()
            return sentinel_result.get("status", 0) if isinstance(sentinel_result, dict) else 0, \
                   "ChatGPT sentinel failed in browser"

        sentinel_data = sentinel_result["data"]
        sentinel_token = sentinel_data.get("token", "")
        device_id = sentinel_result["deviceId"]

        # ── Step 2: solve PoW in Python (rarely required for logged-in users) ─
        proof_token = ""
        pow_spec = sentinel_data.get("proofofwork") or {}
        if pow_spec.get("required"):
            proof_token = _solve_chatgpt_pow(pow_spec)

        # ── Step 3: build conversation payload ────────────────────────────────
        payload: dict = {
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
        if effort:
            payload["reasoning_effort"] = effort

        # ── Step 4: conversation request from inside browser ──────────────────
        try:
            conv_result = page.evaluate(
                """
                async ({ deviceId, sentinelToken, proofToken, payload }) => {
                    const headers = {
                        'Content-Type': 'application/json',
                        'oai-device-id': deviceId,
                        'openai-sentinel-chat-requirements-token': sentinelToken,
                    };
                    if (proofToken) headers['openai-sentinel-proof-token'] = proofToken;
                    const resp = await fetch('/backend-anon/conversation', {
                        method: 'POST',
                        headers: headers,
                        body: JSON.stringify(payload),
                        credentials: 'include',
                    });
                    const text = await resp.text();
                    return { status: resp.status, body: text };
                }
                """,
                {
                    "deviceId": device_id,
                    "sentinelToken": sentinel_token,
                    "proofToken": proof_token,
                    "payload": payload,
                },
            )
        except Exception as conv_err:
            browser.close()
            logger.error("ChatGPT Playwright: conversation evaluate error: %s", conv_err)
            return 0, f"Conversation evaluate error: {conv_err}"

        browser.close()

        if not isinstance(conv_result, dict):
            return 0, "ChatGPT conversation: unexpected browser return value"

        status = conv_result.get("status", 0)
        body   = conv_result.get("body", "")
        logger.debug("ChatGPT Playwright: conversation status=%s body_len=%s", status, len(body))
        result["status"] = status
        result["body"]   = body

    return result["status"], result["body"]


def send_chatgpt(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to ChatGPT.

    PRIMARY  : Playwright with real Chromium — passes Cloudflare bot detection.
    FALLBACK : curl_cffi Chrome-impersonation — used if Playwright is unavailable.
    """
    # ── PRIMARY: Playwright ────────────────────────────────────────────────────
    try:
        status, body = _chatgpt_playwright_fetch(session_path, model, prompt)
        logger.info("ChatGPT Playwright: status=%s body_len=%s", status, len(body))

        if status == 200:
            text = _parse_chatgpt_sse(body)
            if text:
                return True, text, ""
            # Empty SSE — could be an unexpected response format; fall through
            logger.warning("ChatGPT Playwright 200 but no text parsed; body: %s", body[:300])

        if status == 401:
            return False, "", "ChatGPT: not authenticated — please re-import your cookies."

        if status == 403:
            body_snippet = body[:400]
            body_low = body_snippet.lower()
            if "unusual activity" in body_low or "cloudflare" in body_low:
                return False, "", (
                    "ChatGPT cookies don't work from cloud servers — OpenAI blocks data-center IPs on "
                    "the browser API. **Use an OpenAI API key instead**: go to platform.openai.com/api-keys, "
                    "create a key (starts with sk-), then import it in Sessions → ChatGPT → API Key tab."
                )
            if any(k in body_low for k in ("subscri", "plus", "upgrade", "plan", "not available")):
                return False, "", (
                    f"ChatGPT: your account doesn't have access to **{model}**. "
                    "Use an API key (platform.openai.com/api-keys) for full model access, "
                    "or switch to a lower-tier model."
                )
            return False, "", f"ChatGPT 403 access denied. Server: {body_snippet[:200]}"

        if status == 429:
            return False, "", "ChatGPT rate limit hit. Wait a minute and try again."

        if status >= 400:
            return False, "", f"ChatGPT error {status}: {body[:300]}"

        # status == 0 means Playwright itself failed; drop to curl_cffi fallback
        if status != 0:
            return False, "", f"ChatGPT unexpected status {status}: {body[:200]}"

    except Exception as pw_exc:
        logger.warning("ChatGPT Playwright failed (%s); falling back to curl_cffi", pw_exc)

    # ── FALLBACK: curl_cffi ────────────────────────────────────────────────────
    logger.info("ChatGPT: using curl_cffi fallback for model=%s", model)
    try:
        from curl_cffi import requests as cf  # noqa: PLC0415
    except ImportError:
        return False, "", "curl_cffi not installed and Playwright failed. Cannot send to ChatGPT."

    try:
        cookies = _load_cookies(session_path, "")
        if not cookies:
            return False, "", "Session file is empty. Please re-import your ChatGPT cookies."

        sess = _impersonate_session(cookies)
        device_id = str(uuid.uuid4())
        sess.headers.update(_chrome_headers(
            "https://chatgpt.com",
            "https://chatgpt.com/",
            {"oai-device-id": device_id, "Content-Type": "application/json"},
        ))

        req_resp = sess.post(
            "https://chatgpt.com/backend-anon/sentinel/chat-requirements",
            json={}, timeout=30,
        )
        if req_resp.status_code != 200:
            return False, "", f"ChatGPT sentinel failed ({req_resp.status_code}): {req_resp.text[:200]}"

        req_data    = req_resp.json()
        sentinel_token = req_data.get("token", "")
        proof_token = ""
        pow_spec = req_data.get("proofofwork") or {}
        if pow_spec.get("required"):
            proof_token = _solve_chatgpt_pow(pow_spec)

        real_model = {"__auto__": "gpt-4o"}.get(model, model)
        payload: dict = {
            "action": "next",
            "messages": [{
                "id": str(uuid.uuid4()),
                "author": {"role": "user"},
                "content": {"content_type": "text", "parts": [prompt]},
                "metadata": {},
            }],
            "parent_message_id": str(uuid.uuid4()),
            "model": real_model,
            "timezone_offset_min": 0,
            "history_and_training_disabled": False,
            "conversation_mode": {"kind": "primary_assistant"},
        }
        effort = _CHATGPT_REASONING_EFFORT.get(real_model)
        if effort:
            payload["reasoning_effort"] = effort

        extra = {"openai-sentinel-chat-requirements-token": sentinel_token}
        if proof_token:
            extra["openai-sentinel-proof-token"] = proof_token

        resp = sess.post(
            "https://chatgpt.com/backend-anon/conversation",
            json=payload, headers=extra, timeout=180,
        )
        logger.debug("ChatGPT curl_cffi: status=%s body=%s", resp.status_code, resp.text[:200])

        if resp.status_code == 200:
            text = _parse_chatgpt_sse(resp.text)
            if text:
                return True, text, ""
        if resp.status_code == 401:
            return False, "", "ChatGPT: not authenticated — please re-import your cookies."
        if resp.status_code == 429:
            return False, "", "ChatGPT rate limit hit. Wait a minute and try again."
        return False, "", f"ChatGPT curl_cffi error {resp.status_code}: {resp.text[:300]}"

    except Exception as exc:
        logger.error("ChatGPT curl_cffi fallback error: %s", exc, exc_info=True)
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


_GROK_PAYLOAD_TEMPLATE = {
    "temporary": False,
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

_GROK_API_URL = "https://grok.com/rest/app-chat/conversations/new"


def _build_grok_payload(model: str, prompt: str) -> dict:
    """
    Map a Vesper model ID to the correct Grok REST payload.

    SuperGrok models use Grok 4.20 but differ in reasoning / backend routing:
      grok-4         → Fast   (modelName="grok-4",       isReasoning=False)
      grok-4-expert  → Expert (modelName="grok-4",       isReasoning=True )
      grok-4-heavy   → Heavy  (modelName="grok-4-heavy", isReasoning=False)

    Free-tier models are passed through unchanged (grok-3, grok-3-mini, …).
    """
    base = dict(_GROK_PAYLOAD_TEMPLATE, message=prompt)
    if model == "grok-4-expert":
        base["modelName"] = "grok-4"
        base["isReasoning"] = True
    elif model == "grok-4-heavy":
        base["modelName"] = "grok-4-heavy"
        base["isReasoning"] = False
    elif model == "grok-4":
        base["modelName"] = "grok-4"
        base["isReasoning"] = False
    else:
        base["modelName"] = model
        base["isReasoning"] = False
    return base


_GROK_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/136.0.0.0 Safari/537.36"
)


def _grok_playwright_fetch(session_path: str, model: str, prompt: str) -> Tuple[int, str]:
    """
    Send a Grok request via a real Playwright browser using UI-trigger + route
    interception.

    WHY THE PREVIOUS page.evaluate(fetch()) APPROACH FAILED:
    Grok's React app wraps every API call through its own fetch interceptors
    (Axios/React-Query middleware or a custom fetch wrapper).  Those interceptors
    inject anti-bot request headers — things like sentry-trace, baggage, and
    per-request tokens — that Grok's backend validates.  A raw fetch() we write
    ourselves never passes through those interceptors, so those headers are absent
    and Grok's backend replies: "Request rejected by anti-bot rules." (code 7).

    THE SOLUTION — hijack a real UI-triggered request:
    1.  page.route() intercepts the actual request that Grok's own React code makes,
        complete with every header the interceptors added.
    2.  We call route.fetch(post_data=our_payload) — same headers, our body.
    3.  Grok's backend sees a legitimate request and responds normally.

    Playwright also hides navigator.webdriver and runs Cloudflare's JS challenge
    during the initial page.goto(), giving us a fresh __cf_bm cookie.

    Returns (http_status_code, response_body_text).
    """
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    actual_payload = _build_grok_payload(model, prompt)
    actual_payload_bytes = json.dumps(actual_payload).encode()

    result: dict = {"status": 0, "body": ""}

    with sync_playwright() as p:
        from config import find_chromium  # noqa: PLC0415
        _chrome_exe = find_chromium()
        _launch_kwargs: dict = {
            "headless": True,
            "args": [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-blink-features=AutomationControlled",
            ],
        }
        if _chrome_exe:
            _launch_kwargs["executable_path"] = _chrome_exe
        browser = p.chromium.launch(**_launch_kwargs)
        context = browser.new_context(
            viewport={"width": 1280, "height": 900},
            user_agent=_GROK_UA,
            storage_state=session_path,
        )
        # Mask automation signals before any page JS runs
        context.add_init_script(
            "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        )
        page = context.new_page()
        page.set_default_timeout(130_000)

        # ── Route interceptor ──────────────────────────────────────────────────
        # Catches the real /conversations/new request that Grok's React code sends.
        # Keeps ALL original headers (anti-bot headers included); replaces the body.
        def _handle_route(route):
            try:
                # route.request.headers = real headers Grok's JS interceptors added
                # route.fetch(...) sends the request via the browser's network stack
                response = route.fetch(post_data=actual_payload_bytes)
                result["status"] = response.status
                result["body"] = response.body().decode("utf-8", errors="replace")
                logger.info(
                    "Grok route interceptor → status=%s body_len=%s",
                    result["status"], len(result["body"]),
                )
                # Fulfil the page's copy of the request so the UI doesn't hang
                route.fulfill(
                    status=response.status,
                    headers=dict(response.headers),
                    body=response.body(),
                )
            except Exception as route_err:
                logger.error("Grok route handler error: %s", route_err)
                result["body"] = str(route_err)
                try:
                    route.continue_()
                except Exception:
                    pass

        page.route("**/rest/app-chat/conversations/new", _handle_route)

        # ── Navigate to grok.com ───────────────────────────────────────────────
        # Cloudflare's JS challenge runs here → fresh __cf_bm is set.
        # wait_until="load" gives React time to mount before we look for elements.
        try:
            page.goto("https://grok.com/", timeout=40_000, wait_until="load")
            page.wait_for_timeout(3_000)
        except Exception as nav_err:
            logger.warning("Grok: navigation issue (continuing): %s", nav_err)

        # ── Detect login / auth wall ───────────────────────────────────────────
        page_url = page.url or ""
        page_title = (page.title() or "").lower()
        login_keywords = ("sign in", "log in", "login", "signin", "auth")
        if any(k in page_title for k in login_keywords) or "/login" in page_url or "/signin" in page_url:
            browser.close()
            result["status"] = 401
            result["body"] = '{"error": "Not authenticated — cookies appear expired or invalid"}'
            return result["status"], result["body"]

        # ── Find the chat input ────────────────────────────────────────────────
        # Try multiple selectors in order of specificity
        input_el = None
        for sel in [
            "div.ProseMirror[contenteditable='true']",
            "div.ProseMirror",
            "[contenteditable='true']",
            "textarea[placeholder]",
            "textarea",
        ]:
            try:
                el = page.wait_for_selector(sel, timeout=8_000, state="visible")
                if el:
                    input_el = el
                    logger.info("Grok: found input with selector %r", sel)
                    break
            except Exception:
                pass

        if not input_el:
            logger.warning("Grok: chat input not found on %s — page title: %r", page.url, page.title())
            # Take a best-effort raw fetch() from within the page.
            # This may get code-7 but gives a meaningful error to the user.
            js_result = page.evaluate(
                """async (p) => {
                    try {
                        const r = await fetch('https://grok.com/rest/app-chat/conversations/new',
                            { method:'POST',
                              headers:{'Content-Type':'application/json','Accept':'application/json'},
                              body: JSON.stringify(p),
                              credentials: 'include' });
                        return { status: r.status, body: await r.text() };
                    } catch(e) { return { status: 0, body: String(e) }; }
                }""",
                actual_payload,
            )
            browser.close()
            s = js_result.get("status", 0) if isinstance(js_result, dict) else 0
            b = js_result.get("body",   "") if isinstance(js_result, dict) else str(js_result)
            return s, b

        # ── Type a minimal trigger message ────────────────────────────────────
        # The route interceptor will replace the body with our actual prompt.
        input_el.click()
        page.wait_for_timeout(300)
        page.keyboard.type("hi", delay=50)
        page.wait_for_timeout(500)

        # ── Submit ─────────────────────────────────────────────────────────────
        # Try button selectors first, then keyboard shortcuts
        submitted = False
        for btn_sel in [
            "button[aria-label='Send message']",
            "button[aria-label='Send']",
            "button[aria-label='send']",
            "[data-testid='send-button']",
            "button[type='submit']",
            "button[aria-label*='Send']",
            "button[aria-label*='Submit']",
            "form button:last-of-type",
        ]:
            try:
                btn = page.wait_for_selector(btn_sel, timeout=2_000, state="visible")
                if btn and btn.is_enabled():
                    btn.click()
                    submitted = True
                    logger.info("Grok: submitted via button %r", btn_sel)
                    break
            except Exception:
                pass

        if not submitted:
            # ProseMirror blocks plain Enter (inserts newline); use Mod+Enter or
            # just Enter depending on the Grok version
            page.keyboard.press("Enter")
            logger.info("Grok: submitted via Enter key fallback")

        # ── Wait for the route handler to fire (up to 120 s) ─────────────────
        waited_ms = 0
        while waited_ms < 120_000:
            if result["status"] != 0 or result["body"]:
                break
            page.wait_for_timeout(500)
            waited_ms += 500

        browser.close()

    logger.info(
        "Grok Playwright complete → status=%s body_len=%s",
        result["status"], len(result["body"]),
    )
    return result["status"], result["body"]


def _grok_curl_fetch(session_path: str, model: str, prompt: str) -> Tuple[int, str]:
    """
    Fallback: make the Grok API POST via curl_cffi (Chrome 136 TLS fingerprint).
    Less reliable than the Playwright path but faster and doesn't need a display.
    """
    from curl_cffi import requests as cf  # noqa: PLC0415

    cookies = _load_cookies(session_path, "")
    sess = cf.Session(impersonate="chrome136")
    sess.cookies.update(cookies)

    headers = {
        "Content-Type": "application/json",
        "User-Agent": _GROK_UA,
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br, zstd",
        "Origin": "https://grok.com",
        "Referer": "https://grok.com/",
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not-A.Brand";v="24"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"Windows"',
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "x-requested-with": "XMLHttpRequest",
    }
    payload = _build_grok_payload(model, prompt)
    resp = sess.post(_GROK_API_URL, json=payload, headers=headers, timeout=120)
    logger.info("Grok curl_cffi fetch → status=%s", resp.status_code)
    return resp.status_code, resp.text


def _grok_handle_status(
    status: int, body: str, model: str,
    fetch_fn,        # callable(model) -> (status, body) for retry
) -> Tuple[bool, str, str]:
    """Unified status → (success, text, error) for both Playwright and curl paths."""
    if status == 200:
        logger.debug("Grok raw (first 500): %s", body[:500])
        text = _parse_grok_response(body)
        if text:
            return True, text, ""
        return False, "", f"Grok returned an unrecognised response. Raw: {body[:200]}"

    if status == 401:
        return False, "", (
            "Grok session expired — please re-import your cookies from grok.com."
        )

    if status == 403:
        logger.warning("Grok 403 body: %s", body[:400])
        body_lc = body[:400].lower()

        # Plan gate — retry with the free/mini model
        if any(k in body_lc for k in ("subscri", "premium", "upgrade", "plan", "entitl")):
            free_model = get_free_model("grok")
            if free_model and free_model != model:
                logger.info("Grok plan-gate 403 — retrying with %s", free_model)
                s2, b2 = fetch_fn(free_model)
                if s2 == 200:
                    text2 = _parse_grok_response(b2)
                    if text2:
                        note = (
                            f"\n\n_(Answered with **{free_model}** — your account "
                            f"doesn't have access to **{model}**.)_"
                        )
                        return True, text2 + note, ""

        # Grok application-level anti-bot (code 7)
        if "anti-bot" in body_lc or '"code":7' in body or '"code": 7' in body:
            return False, "", (
                "Grok's anti-bot system rejected the request (code 7). "
                "This can happen when cookies are very old. "
                "Please re-export your cookies from a fresh grok.com session and re-import them."
            )

        # Cloudflare / bot block
        if any(k in body_lc for k in ("cloudflare", "cf-ray", "just a moment", "ddos", "checking")):
            return False, "", (
                "Grok is blocked by Cloudflare. Your cf_clearance cookie may have expired.\n"
                "Fix: open grok.com in your browser, log in, wait for the page to fully load, "
                "then re-export and re-import your cookies."
            )

        # Auth failure
        if any(k in body_lc for k in ("unauthenticated", "no-credentials", "no credentials")):
            return False, "", (
                "Grok rejected your credentials (403 unauthenticated). "
                "Please re-import fresh cookies from grok.com."
            )

        return False, "", (
            f"Grok returned 403.\n"
            f"• Cookies may be expired → re-export from grok.com and re-import\n"
            f"• Selected model may need a paid plan\n"
            f"Response: {body[:150]}"
        )

    return False, "", (
        f"Grok returned HTTP {status}. Please re-import cookies from grok.com.\n"
        f"Details: {body[:150]}"
    )


def send_grok(session_path: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """
    Send a prompt to Grok via grok.com.

    Strategy:
    1. PRIMARY — Playwright real browser:  solves Cloudflare JS challenge in-browser,
       then uses page.evaluate(fetch(...)) so every cookie (incl. __cf_bm) is sent
       automatically.  This is the only reliable way to bypass Bot Management.
    2. FALLBACK — curl_cffi Chrome 136:  fast but can't run Cloudflare's JS; will
       work if the user's cf_clearance cookie is still fresh (< 24 h).
    """
    cookies = _load_cookies(session_path, "")
    if not cookies:
        return False, "", (
            "Session file is empty — please re-import your Grok cookies from grok.com."
        )

    # ── 1. Playwright path ────────────────────────────────────────────────────
    try:
        status, body = _grok_playwright_fetch(session_path, model, prompt)

        def _pw_retry(mdl: str) -> Tuple[int, str]:
            return _grok_playwright_fetch(session_path, mdl, prompt)

        result = _grok_handle_status(status, body, model, _pw_retry)
        # If Playwright succeeded OR gave a meaningful auth/plan error, return it
        if result[0] or status in (401, 403):
            return result
        # status 0 or non-HTTP error → fall through to curl_cffi

    except Exception as pw_exc:
        logger.warning("Grok Playwright path failed (%s) — trying curl_cffi", pw_exc)

    # ── 2. curl_cffi fallback ─────────────────────────────────────────────────
    try:
        status, body = _grok_curl_fetch(session_path, model, prompt)

        def _curl_retry(mdl: str) -> Tuple[int, str]:
            return _grok_curl_fetch(session_path, mdl, prompt)

        return _grok_handle_status(status, body, model, _curl_retry)

    except Exception as curl_exc:
        logger.error("Grok curl_cffi path also failed: %s", curl_exc, exc_info=True)
        return False, "", f"Grok: both browser and fallback attempts failed. Last error: {curl_exc}"


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
        _AGENT_SYS_MARKER = "You are an expert autonomous coding agent"
        _SEP = "═" * 20
        system_text: str | None = None
        user_content = prompt
        if prompt.startswith(_AGENT_SYS_MARKER):
            sep_pos = prompt.find(_SEP)
            if sep_pos > 100:
                system_text = prompt[:sep_pos].strip()
                user_content = prompt[sep_pos:].strip()
        body_data: dict = {
            "model": model,
            "max_tokens": 16384,
            "messages": [{"role": "user", "content": user_content}],
        }
        if system_text:
            body_data["system"] = system_text
        body = json.dumps(body_data).encode()
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


def _send_gemini_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via Google Gemini API. Free tier: 1,500 req/day on Flash."""
    try:
        import urllib.request, urllib.error
        url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"

        _AGENT_SYS_MARKER = "You are an expert autonomous coding agent"
        _SEP = "═" * 20
        system_instruction_text: str | None = None
        user_content = prompt
        if prompt.startswith(_AGENT_SYS_MARKER):
            sep_pos = prompt.find(_SEP)
            if sep_pos > 100:
                system_instruction_text = prompt[:sep_pos].strip()
                user_content = prompt[sep_pos:].strip()

        body_data: dict = {
            "contents": [{"role": "user", "parts": [{"text": user_content}]}],
            "generationConfig": {"maxOutputTokens": 8192, "temperature": 0.7},
        }
        if system_instruction_text:
            body_data["system_instruction"] = {"parts": [{"text": system_instruction_text}]}

        body = json.dumps(body_data).encode()
        req = urllib.request.Request(url, data=body, headers={"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        text = data["candidates"][0]["content"]["parts"][0]["text"].strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        if exc.code == 404 or (exc.code == 400 and "not found" in body_text.lower()):
            return False, "", (
                f"Gemini model **{model}** was not found — the model ID may be stale.\n"
                "Go to **Sessions → Validate Models** to check which models are still live."
            )
        if exc.code in (400, 403):
            return False, "", f"Gemini API key invalid or quota exceeded: {body_text}"
        if exc.code == 429:
            return False, "", "Gemini rate limit hit. Wait a moment and try again."
        return False, "", f"Gemini API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Gemini send error: %s", exc, exc_info=True)
        return False, "", f"Gemini error: {exc}"


def _send_openrouter_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via OpenRouter. Many models are free with :free suffix."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://openrouter.ai/api/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://vesper.ai",
                "X-Title": "Vesper",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=180) as resp:
            data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"].strip()
        actual_model = data.get("model", model)
        if actual_model != model:
            logger.info("OpenRouter routed to: %s", actual_model)
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:400]
        if exc.code == 401:
            return False, "", "OpenRouter API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "OpenRouter rate limit hit — try again in a moment or switch to another model."
        if exc.code == 404 or "No endpoints found" in body_text:
            return False, "", f"OpenRouter: model '{model}' has no active providers right now. Try 'Auto — Best Free Available' instead."
        return False, "", f"OpenRouter API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("OpenRouter send error: %s", exc, exc_info=True)
        return False, "", f"OpenRouter error: {exc}"


def _send_mistral_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via Mistral AI API. Free tier available."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.mistral.ai/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        text = data["choices"][0]["message"]["content"].strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        if exc.code == 401:
            return False, "", "Mistral API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "Mistral rate limit hit. Try again later."
        return False, "", f"Mistral API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Mistral send error: %s", exc, exc_info=True)
        return False, "", f"Mistral error: {exc}"


def _send_cohere_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via Cohere API. Trial keys are free."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "message": prompt,
        }).encode()
        req = urllib.request.Request(
            "https://api.cohere.com/v1/chat",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read())
        text = data.get("text", "").strip()
        return True, text, ""
    except urllib.error.HTTPError as exc:
        body_text = exc.read().decode(errors="replace")[:300]
        if exc.code == 401:
            return False, "", "Cohere API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "Cohere rate limit hit. Try again later."
        return False, "", f"Cohere API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Cohere send error: %s", exc, exc_info=True)
        return False, "", f"Cohere error: {exc}"


def _send_together_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via Together AI API. $5 free credit on signup."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.together.xyz/v1/chat/completions",
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
            return False, "", "Together AI API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "Together AI rate limit hit. Try again later."
        return False, "", f"Together AI API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Together AI send error: %s", exc, exc_info=True)
        return False, "", f"Together AI error: {exc}"


def _send_cerebras_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via Cerebras API. Free tier. Fastest inference in the world."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.cerebras.ai/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
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
            return False, "", "Cerebras API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "Cerebras rate limit hit. Try again later."
        return False, "", f"Cerebras API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("Cerebras send error: %s", exc, exc_info=True)
        return False, "", f"Cerebras error: {exc}"


def _send_deepseek_api(api_key: str, model: str, prompt: str) -> Tuple[bool, str, str]:
    """Send via DeepSeek API. Very low cost (~$0.14/1M tokens)."""
    try:
        import urllib.request, urllib.error
        body = json.dumps({
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
        }).encode()
        req = urllib.request.Request(
            "https://api.deepseek.com/v1/chat/completions",
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
            return False, "", "DeepSeek API key is invalid. Update it on the Sessions page."
        if exc.code == 429:
            return False, "", "DeepSeek rate limit hit. Try again later."
        return False, "", f"DeepSeek API error {exc.code}: {body_text}"
    except Exception as exc:
        logger.error("DeepSeek send error: %s", exc, exc_info=True)
        return False, "", f"DeepSeek error: {exc}"


_API_KEY_DISPATCH = {
    "chatgpt":    _send_chatgpt_api,
    "claude":     _send_claude_api,
    "groq":       _send_groq_api,
    "gemini":     _send_gemini_api,
    "openrouter": _send_openrouter_api,
    "mistral":    _send_mistral_api,
    "cohere":     _send_cohere_api,
    "together":   _send_together_api,
    "cerebras":   _send_cerebras_api,
    "deepseek":   _send_deepseek_api,
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
