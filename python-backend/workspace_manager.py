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
    if list(p.glob("*.py")) or (p / "requirements.txt").exists() or (p / "pyproject.toml").exists():
        return "python"
    return "unknown"


def _find_uv() -> Optional[str]:
    uv = shutil.which("uv")
    if uv:
        return uv
    # Fallback: Replit's local bin
    candidate = os.path.join(WORKSPACE_ROOT, ".pythonlibs", "bin", "uv")
    return candidate if Path(candidate).exists() else None


# ── Public API ────────────────────────────────────────────────────────────────

def list_workspaces() -> List[Dict[str, Any]]:
    """Return sorted list of workspace metadata dicts."""
    _ensure_workspaces_dir()
    result: List[Dict[str, Any]] = []
    for entry in sorted(Path(WORKSPACES_DIR).iterdir()):
        if not entry.is_dir():
            continue
        meta = _read_meta(str(entry))
        result.append({
            "id":       entry.name,
            "name":     meta.get("name", entry.name),
            "language": meta.get("language", "unknown"),
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

    if lang == "python":
        venv_python = Path(ws_abs) / ".venv" / "bin" / "python"
        if venv_python.exists():
            try:
                r = subprocess.run(
                    [str(venv_python), "-m", "pip", "list", "--format=json"],
                    capture_output=True, text=True, timeout=15, cwd=ws_abs,
                )
                if r.returncode == 0:
                    raw = json.loads(r.stdout)
                    deps = [{"name": p["name"], "version": p["version"]} for p in raw]
            except Exception as exc:
                logger.warning("Failed to list Python deps for %s: %s", slug, exc)

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

    return {"success": True, "language": lang, "deps": deps}, 200


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
    venv = Path(ws_abs) / ".venv"
    uv = _find_uv()

    # Create venv if missing
    if not venv.exists():
        logger.info("Creating venv at %s", venv)
        if uv:
            r = subprocess.run(
                [uv, "venv", str(venv)],
                capture_output=True, text=True, timeout=60, cwd=ws_abs,
            )
        else:
            r = subprocess.run(
                ["python3", "-m", "venv", str(venv)],
                capture_output=True, text=True, timeout=120, cwd=ws_abs,
            )
        if r.returncode != 0:
            return {"error": f"Could not create virtual environment:\n{r.stderr[:600]}"}

    # Install package
    if uv:
        python_bin = str(venv / "bin" / "python")
        cmd = [uv, "pip", "install", pkg_spec, "--python", python_bin]
    else:
        cmd = [str(venv / "bin" / "pip"), "install", pkg_spec]

    logger.info("Installing Python package: %s", pkg_spec)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=120, cwd=ws_abs)
    if r.returncode != 0:
        return {"error": f"Install failed:\n{r.stderr[:800]}"}

    return {
        "success":  True,
        "package":  pkg_spec,
        "language": "python",
        "output":   (r.stdout + r.stderr)[-600:].strip(),
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
    logger.info("Installing JS package: %s", pkg_spec)
    r = subprocess.run(
        [npm, "install", pkg_spec, "--save", "--prefer-offline"],
        capture_output=True, text=True, timeout=120, cwd=ws_abs,
        env={**os.environ, "NODE_ENV": "development"},
    )
    if r.returncode != 0:
        return {"error": f"npm install failed:\n{r.stderr[:800]}"}

    return {
        "success":  True,
        "package":  pkg_spec,
        "language": "js",
        "output":   (r.stdout + r.stderr)[-600:].strip(),
    }
