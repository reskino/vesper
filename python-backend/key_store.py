"""
key_store.py
Persistent storage for API keys and session states.

Primary backend : Replit KV database (persists across restarts AND deployments).
Fallback backend: local files in python-backend/sessions/ (dev-only convenience).

Key naming scheme in KV:
  vesper_key_{ai_id}      → API key string
  vesper_session_{ai_id}  → session-state JSON blob (cookies etc.)
"""
import os
import json
import logging
import urllib.request
import urllib.parse
import urllib.error

logger = logging.getLogger(__name__)

_KV_URL = os.environ.get("REPLIT_DB_URL", "").rstrip("/")
_SESSIONS_DIR = os.path.join(os.path.dirname(__file__), "sessions")

os.makedirs(_SESSIONS_DIR, exist_ok=True)


# ─── Low-level KV helpers ────────────────────────────────────────────────────

def _kv_set(key: str, value: str) -> bool:
    if not _KV_URL:
        return False
    try:
        body = urllib.parse.urlencode({key: value}).encode()
        req = urllib.request.Request(
            _KV_URL, data=body, method="POST",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status == 200
    except Exception as exc:
        logger.warning("KV set error for %s: %s", key, exc)
        return False


def _kv_get(key: str) -> str | None:
    if not _KV_URL:
        return None
    try:
        url = f"{_KV_URL}/{urllib.parse.quote(key, safe='')}"
        with urllib.request.urlopen(url, timeout=5) as r:
            return r.read().decode()
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            return None
        logger.warning("KV get error for %s: %s", key, exc)
        return None
    except Exception as exc:
        logger.warning("KV get error for %s: %s", key, exc)
        return None


def _kv_delete(key: str) -> bool:
    if not _KV_URL:
        return False
    try:
        url = f"{_KV_URL}/{urllib.parse.quote(key, safe='')}"
        req = urllib.request.Request(url, method="DELETE")
        with urllib.request.urlopen(req, timeout=5) as r:
            return r.status in (200, 204)
    except Exception as exc:
        logger.warning("KV delete error for %s: %s", key, exc)
        return False


def _kv_list(prefix: str) -> list[str]:
    if not _KV_URL:
        return []
    try:
        url = f"{_KV_URL}?prefix={urllib.parse.quote(prefix, safe='')}"
        with urllib.request.urlopen(url, timeout=5) as r:
            raw = r.read().decode()
            return [k for k in raw.split("\n") if k] if raw else []
    except Exception as exc:
        logger.warning("KV list error for prefix %s: %s", prefix, exc)
        return []


# ─── API key storage ─────────────────────────────────────────────────────────

def _key_kv_name(ai_id: str) -> str:
    return f"vesper_key_{ai_id}"


def save_api_key(ai_id: str, api_key: str) -> bool:
    """Persist an API key for ai_id.  Returns True on success."""
    api_key = api_key.strip()
    kv_ok = _kv_set(_key_kv_name(ai_id), api_key)
    # always write the fallback file too
    try:
        path = os.path.join(_SESSIONS_DIR, f"{ai_id}_api_key.txt")
        with open(path, "w") as f:
            f.write(api_key)
        file_ok = True
    except Exception as exc:
        logger.warning("File save error for %s key: %s", ai_id, exc)
        file_ok = False
    if kv_ok:
        logger.info("API key for %s saved to KV database", ai_id)
    elif file_ok:
        logger.info("API key for %s saved to file (KV unavailable)", ai_id)
    return kv_ok or file_ok


def load_api_key(ai_id: str) -> str:
    """Return the stored API key for ai_id, or '' if none."""
    # 1. Replit KV (primary, persists in production)
    val = _kv_get(_key_kv_name(ai_id))
    if val:
        return val.strip()
    # 2. Local file fallback (dev / migration path)
    path = os.path.join(_SESSIONS_DIR, f"{ai_id}_api_key.txt")
    try:
        with open(path) as f:
            val = f.read().strip()
        if val:
            # migrate to KV
            _kv_set(_key_kv_name(ai_id), val)
            logger.info("Migrated %s API key from file to KV", ai_id)
        return val
    except FileNotFoundError:
        return ""


def delete_api_key(ai_id: str) -> bool:
    _kv_delete(_key_kv_name(ai_id))
    try:
        path = os.path.join(_SESSIONS_DIR, f"{ai_id}_api_key.txt")
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
    return True


def api_key_exists(ai_id: str) -> bool:
    return bool(load_api_key(ai_id))


# ─── Session-state storage (cookies / JSON blobs) ────────────────────────────

def _session_kv_name(ai_id: str) -> str:
    return f"vesper_session_{ai_id}"


def save_session_state(ai_id: str, state: dict) -> bool:
    """Persist a JSON session state for ai_id."""
    blob = json.dumps(state)
    kv_ok = _kv_set(_session_kv_name(ai_id), blob)
    try:
        path = os.path.join(_SESSIONS_DIR, f"{ai_id}_state.json")
        with open(path, "w") as f:
            f.write(blob)
        file_ok = True
    except Exception:
        file_ok = False
    return kv_ok or file_ok


def load_session_state(ai_id: str) -> dict | None:
    """Return the stored session state dict, or None if missing."""
    # 1. KV
    val = _kv_get(_session_kv_name(ai_id))
    if val:
        try:
            return json.loads(val)
        except Exception:
            pass
    # 2. File fallback / migration
    path = os.path.join(_SESSIONS_DIR, f"{ai_id}_state.json")
    try:
        with open(path) as f:
            state = json.load(f)
        if state:
            _kv_set(_session_kv_name(ai_id), json.dumps(state))
            logger.info("Migrated %s session state from file to KV", ai_id)
        return state
    except (FileNotFoundError, json.JSONDecodeError):
        return None


def delete_session_state(ai_id: str) -> bool:
    _kv_delete(_session_kv_name(ai_id))
    try:
        path = os.path.join(_SESSIONS_DIR, f"{ai_id}_state.json")
        if os.path.exists(path):
            os.remove(path)
    except Exception:
        pass
    return True


def session_state_exists(ai_id: str) -> bool:
    return load_session_state(ai_id) is not None


# ─── Convenience: check if ANY credential exists for an AI ──────────────────

def any_credential_exists(ai_id: str) -> bool:
    return api_key_exists(ai_id) or session_state_exists(ai_id)


# ─── On-startup: push legacy files → KV, then restore KV → files ─────────────

def migrate_legacy_files():
    """Run once at startup to move any file-based credentials into KV."""
    if not _KV_URL:
        return
    try:
        entries = os.listdir(_SESSIONS_DIR)
    except Exception:
        return
    for name in entries:
        if name.endswith("_api_key.txt"):
            ai_id = name[: -len("_api_key.txt")]
            kv_key = _key_kv_name(ai_id)
            if not _kv_get(kv_key):
                try:
                    with open(os.path.join(_SESSIONS_DIR, name)) as f:
                        val = f.read().strip()
                    if val:
                        _kv_set(kv_key, val)
                        logger.info("Migrated %s API key to KV", ai_id)
                except Exception:
                    pass
        elif name.endswith("_state.json"):
            ai_id = name[: -len("_state.json")]
            kv_key = _session_kv_name(ai_id)
            if not _kv_get(kv_key):
                try:
                    with open(os.path.join(_SESSIONS_DIR, name)) as f:
                        blob = f.read()
                    if blob and blob != "{}":
                        _kv_set(kv_key, blob)
                        logger.info("Migrated %s session state to KV", ai_id)
                except Exception:
                    pass


def restore_from_kv():
    """
    Restore all credentials from KV → local files.
    Call at startup so web_session_client can read session files
    even after a filesystem reset.
    """
    if not _KV_URL:
        return

    # ── API keys ──────────────────────────────────────────────────────────────
    for kv_key in _kv_list("vesper_key_"):
        ai_id = kv_key[len("vesper_key_"):]
        val = _kv_get(kv_key)
        if not val:
            continue
        path = os.path.join(_SESSIONS_DIR, f"{ai_id}_api_key.txt")
        try:
            with open(path, "w") as f:
                f.write(val.strip())
            logger.info("Restored %s API key from KV to file", ai_id)
        except Exception as exc:
            logger.warning("Could not restore %s API key file: %s", ai_id, exc)

    # ── Cookie / session states ───────────────────────────────────────────────
    for kv_key in _kv_list("vesper_session_"):
        ai_id = kv_key[len("vesper_session_"):]
        blob = _kv_get(kv_key)
        if not blob or blob in ("{}", "null"):
            continue
        path = os.path.join(_SESSIONS_DIR, f"{ai_id}_state.json")
        try:
            # Validate JSON before writing
            json.loads(blob)
            with open(path, "w") as f:
                f.write(blob)
            logger.info("Restored %s session state from KV to file", ai_id)
        except Exception as exc:
            logger.warning("Could not restore %s session file: %s", ai_id, exc)
