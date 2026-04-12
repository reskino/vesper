"""
workspace_manager.py — Per-project workspace + isolated dependency management.

Each workspace lives at:  {WORKSPACE_ROOT}/workspaces/{slug}/
Metadata lives at:        {WORKSPACE_ROOT}/workspaces/{slug}/.vesper/workspace.json
Python venv lives at:     {WORKSPACE_ROOT}/workspaces/{slug}/.venv/
JS packages live at:      {WORKSPACE_ROOT}/workspaces/{slug}/node_modules/
"""

import json
import logging
import os
import re
import shutil
import subprocess
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", "/home/runner/workspace")
WORKSPACES_DIR = os.path.join(WORKSPACE_ROOT, "workspaces")
META_DIR = ".vesper"
META_FILE = "workspace.json"

# Only allow safe chars in workspace IDs
_SLUG_RE = re.compile(r"[^a-zA-Z0-9\-]")
# Only allow safe package name chars (covers PyPI + npm conventions)
_PKG_RE = re.compile(r"^[a-zA-Z0-9_\-\.\[\]@/]+$")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _ensure_workspaces_dir() -> None:
    Path(WORKSPACES_DIR).mkdir(parents=True, exist_ok=True)


def _slugify(name: str) -> str:
    return _SLUG_RE.sub("-", name.strip().lower()).strip("-") or "workspace"


def _ws_path(slug: str) -> str:
    """Absolute path to a workspace directory. Slug is already sanitised."""
    return os.path.join(WORKSPACES_DIR, slug)


def _rel_path(slug: str) -> str:
    """Relative path (from WORKSPACE_ROOT) — used by the file-tree API."""
    return f"workspaces/{slug}"


def _read_meta(ws_abs: str) -> Dict[str, Any]:
    meta_file = Path(ws_abs) / META_DIR / META_FILE
    try:
        with open(meta_file) as f:
            return json.load(f)
    except Exception:
        return {}


def _write_meta(ws_abs: str, meta: Dict[str, Any]) -> None:
    meta_dir = Path(ws_abs) / META_DIR
    meta_dir.mkdir(parents=True, exist_ok=True)
    with open(meta_dir / META_FILE, "w") as f:
        json.dump(meta, f, indent=2)


def _detect_language(ws_abs: str) -> str:
    p = Path(ws_abs)
    if (p / "package.json").exists():
        return "js"
    if (p / "pyproject.toml").exists() or (p / "requirements.txt").exists() or (p / "uv.lock").exists():
        return "python"
    if list(p.glob("*.py")):
        return "python"
    return "unknown"


def _lockfile_status(ws_abs: str, lang: str) -> Optional[str]:
    """Return lockfile name if it exists, else None."""
    if lang == "python" and (Path(ws_abs) / "uv.lock").exists():
        return "uv.lock"
    if lang == "js" and (Path(ws_abs) / "package-lock.json").exists():
        return "package-lock.json"
    return None


def _find_uv() -> Optional[str]:
    uv = shutil.which("uv")
    if uv:
        return uv
    # Fallback: Replit's local bin
    candidate = os.path.join(WORKSPACE_ROOT, ".pythonlibs", "bin", "uv")
    return candidate if Path(candidate).exists() else None


# ── Public API ────────────────────────────────────────────────────────────────

def list_workspaces() -> List[Dict[str, Any]]:
    """Return sorted list of workspace metadata dicts.

    Language is detected live from the workspace directory so the badge
    reflects the current state of files (not just the last install).
    """
    _ensure_workspaces_dir()
    result: List[Dict[str, Any]] = []
    for entry in sorted(Path(WORKSPACES_DIR).iterdir()):
        if not entry.is_dir():
            continue
        meta = _read_meta(str(entry))
        live_lang = _detect_language(str(entry))
        # Persist detected language back if it changed (lazy update)
        if live_lang != meta.get("language", "unknown"):
            try:
                meta["language"] = live_lang
                _write_meta(str(entry), meta)
            except Exception:
                pass
        result.append({
            "id":       entry.name,
            "name":     meta.get("name", entry.name),
            "language": live_lang,
            "created":  meta.get("created", ""),
            "relPath":  _rel_path(entry.name),
        })
    return result


def create_workspace(name: str) -> Dict[str, Any]:
    """Create a new workspace subdirectory and write its metadata."""
    _ensure_workspaces_dir()
    slug = _slugify(name)

    # Deduplicate slug if directory already exists
    base_slug = slug
    counter = 1
    while Path(_ws_path(slug)).exists():
        slug = f"{base_slug}-{counter}"
        counter += 1

    ws_abs = _ws_path(slug)
    Path(ws_abs).mkdir(parents=True, exist_ok=True)

    meta: Dict[str, Any] = {
        "id":       slug,
        "name":     name.strip() or slug,
        "language": "unknown",
        "created":  datetime.utcnow().isoformat() + "Z",
    }
    _write_meta(ws_abs, meta)

    return {
        "success":   True,
        "workspace": {**meta, "relPath": _rel_path(slug)},
    }


def get_workspace_deps(workspace_id: str) -> Tuple[Dict[str, Any], int]:
    """List installed packages for a workspace. Returns (body, http_status)."""
    slug = _slugify(workspace_id)
    ws_abs = _ws_path(slug)
    if not Path(ws_abs).exists():
        return {"error": f"Workspace '{slug}' not found"}, 404

    lang = _detect_language(ws_abs)
    deps: List[Dict[str, str]] = []
    lockfile = _lockfile_status(ws_abs, lang)

    if lang == "python":
        uv = _find_uv()
        venv_python = Path(ws_abs) / ".venv" / "bin" / "python"

        # Prefer uv pip list (reads from the workspace venv)
        if uv and (Path(ws_abs) / "pyproject.toml").exists():
            try:
                r = subprocess.run(
                    [uv, "pip", "list", "--format=json"],
                    capture_output=True, text=True, timeout=15, cwd=ws_abs,
                )
                if r.returncode == 0:
                    raw = json.loads(r.stdout)
                    deps = [{"name": p["name"], "version": p["version"]} for p in raw]
            except Exception as exc:
                logger.warning("uv pip list failed for %s: %s", slug, exc)

        # Fallback: query the venv's Python interpreter
        elif venv_python.exists():
            try:
                r = subprocess.run(
                    [str(venv_python), "-m", "pip", "list", "--format=json"],
                    capture_output=True, text=True, timeout=15, cwd=ws_abs,
                )
                if r.returncode == 0:
                    raw = json.loads(r.stdout)
                    deps = [{"name": p["name"], "version": p["version"]} for p in raw]
            except Exception as exc:
                logger.warning("pip list failed for %s: %s", slug, exc)

    elif lang == "js":
        pkg_file = Path(ws_abs) / "package.json"
        if pkg_file.exists():
            try:
                pkg = json.loads(pkg_file.read_text())
                for key, ver in {
                    **pkg.get("dependencies", {}),
                    **pkg.get("devDependencies", {}),
                }.items():
                    deps.append({"name": key, "version": ver})
            except Exception:
                pass

    return {"success": True, "language": lang, "deps": deps, "lockfile": lockfile}, 200


def install_dependency(workspace_id: str, package: str, version: Optional[str] = None) -> Tuple[Dict[str, Any], int]:
    """
    Install a single package into the workspace's isolated environment.
    Python  → creates .venv if needed, uses uv/pip.
    JS      → creates package.json if needed, uses npm.
    """
    slug = _slugify(workspace_id)
    ws_abs = _ws_path(slug)
    if not Path(ws_abs).exists():
        return {"error": f"Workspace '{slug}' not found"}, 404

    # Validate package name
    if not _PKG_RE.match(package):
        return {"error": "Invalid package name — only letters, digits, - _ . [ ] @ / allowed"}, 400

    pkg_spec = f"{package}=={version}" if version else package
    lang = _detect_language(ws_abs)

    # Default to Python if language is unknown (most common first project)
    if lang in ("python", "unknown"):
        body = _install_python(ws_abs, pkg_spec)
    elif lang == "js":
        body = _install_js(ws_abs, pkg_spec)
    else:
        return {"error": "Unknown project language. Add a .py file or package.json first."}, 400

    # Refresh language tag in metadata
    meta = _read_meta(ws_abs)
    meta["language"] = _detect_language(ws_abs)
    _write_meta(ws_abs, meta)

    if "error" in body:
        return body, 500
    return body, 200


# ── Private installers ────────────────────────────────────────────────────────

def _install_python(ws_abs: str, pkg_spec: str) -> Dict[str, Any]:
    """
    Install a Python package using uv (preferred) or pip fallback.

    uv workflow (fast, lockfile-aware):
      1. uv init --no-readme   (creates pyproject.toml + .venv + uv.lock)
      2. uv add <pkg>          (adds to pyproject.toml, updates uv.lock, installs)

    pip fallback (when uv is not available):
      1. python3 -m venv .venv
      2. .venv/bin/pip install <pkg>
    """
    uv = _find_uv()

    if uv:
        return _install_python_uv(ws_abs, pkg_spec, uv)
    else:
        return _install_python_pip(ws_abs, pkg_spec)


def _install_python_uv(ws_abs: str, pkg_spec: str, uv: str) -> Dict[str, Any]:
    """Install via uv init + uv add (creates uv.lock, isolated .venv)."""
    pyproject = Path(ws_abs) / "pyproject.toml"

    # Step 1: init project if no pyproject.toml yet
    if not pyproject.exists():
        logger.info("Running uv init in %s", ws_abs)
        r = subprocess.run(
            [uv, "init", "--no-readme"],
            capture_output=True, text=True, timeout=60, cwd=ws_abs,
        )
        if r.returncode != 0:
            # uv init may fail if the dir already has conflicting files; fallback
            logger.warning("uv init failed (%s), falling back to uv pip", r.stderr[:200])
            return _install_python_uv_pip(ws_abs, pkg_spec, uv)

    # Step 2: uv add — installs, updates pyproject.toml + uv.lock
    logger.info("Running uv add %s in %s", pkg_spec, ws_abs)
    r = subprocess.run(
        [uv, "add", pkg_spec],
        capture_output=True, text=True, timeout=180, cwd=ws_abs,
    )
    if r.returncode != 0:
        return {"error": f"uv add failed:\n{(r.stdout + r.stderr)[:800]}"}

    lockfile = "uv.lock" if (Path(ws_abs) / "uv.lock").exists() else None
    return {
        "success":  True,
        "package":  pkg_spec,
        "language": "python",
        "output":   (r.stdout + r.stderr)[-600:].strip(),
        "lockfile": lockfile,
        "tool":     "uv add",
    }


def _install_python_uv_pip(ws_abs: str, pkg_spec: str, uv: str) -> Dict[str, Any]:
    """Fallback: uv venv + uv pip install (no pyproject.toml required)."""
    venv = Path(ws_abs) / ".venv"
    if not venv.exists():
        r = subprocess.run(
            [uv, "venv", str(venv)],
            capture_output=True, text=True, timeout=60, cwd=ws_abs,
        )
        if r.returncode != 0:
            return {"error": f"Could not create venv:\n{r.stderr[:600]}"}

    python_bin = str(venv / "bin" / "python")
    r = subprocess.run(
        [uv, "pip", "install", pkg_spec, "--python", python_bin],
        capture_output=True, text=True, timeout=120, cwd=ws_abs,
    )
    if r.returncode != 0:
        return {"error": f"uv pip install failed:\n{r.stderr[:800]}"}

    return {
        "success":  True,
        "package":  pkg_spec,
        "language": "python",
        "output":   (r.stdout + r.stderr)[-600:].strip(),
        "lockfile": None,
        "tool":     "uv pip",
    }


def _install_python_pip(ws_abs: str, pkg_spec: str) -> Dict[str, Any]:
    """Last-resort fallback: python3 -m venv + pip install."""
    venv = Path(ws_abs) / ".venv"
    if not venv.exists():
        r = subprocess.run(
            ["python3", "-m", "venv", str(venv)],
            capture_output=True, text=True, timeout=120, cwd=ws_abs,
        )
        if r.returncode != 0:
            return {"error": f"Could not create venv:\n{r.stderr[:600]}"}

    r = subprocess.run(
        [str(venv / "bin" / "pip"), "install", pkg_spec],
        capture_output=True, text=True, timeout=180, cwd=ws_abs,
    )
    if r.returncode != 0:
        return {"error": f"pip install failed:\n{r.stderr[:800]}"}

    return {
        "success":  True,
        "package":  pkg_spec,
        "language": "python",
        "output":   (r.stdout + r.stderr)[-600:].strip(),
        "lockfile": None,
        "tool":     "pip",
    }


def _install_js(ws_abs: str, pkg_spec: str) -> Dict[str, Any]:
    pkg_file = Path(ws_abs) / "package.json"

    # Bootstrap package.json if absent
    if not pkg_file.exists():
        pkg_data = {
            "name":    Path(ws_abs).name,
            "version": "0.1.0",
            "private": True,
            "dependencies": {},
        }
        pkg_file.write_text(json.dumps(pkg_data, indent=2))

    npm = shutil.which("npm") or "npm"
    logger.info("Installing JS package: %s in %s", pkg_spec, ws_abs)
    r = subprocess.run(
        [npm, "install", pkg_spec, "--save"],
        capture_output=True, text=True, timeout=180, cwd=ws_abs,
        env={**os.environ, "NODE_ENV": "development"},
    )
    if r.returncode != 0:
        return {"error": f"npm install failed:\n{r.stderr[:800]}"}

    lockfile = "package-lock.json" if (Path(ws_abs) / "package-lock.json").exists() else None
    return {
        "success":  True,
        "package":  pkg_spec,
        "language": "js",
        "output":   (r.stdout + r.stderr)[-600:].strip(),
        "lockfile": lockfile,
        "tool":     "npm install",
    }
