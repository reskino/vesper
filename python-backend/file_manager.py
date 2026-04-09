import os
import shutil
import logging
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

WORKSPACE_ROOT = os.environ.get("WORKSPACE_ROOT", "/home/runner/workspace")

IGNORE_PATTERNS = {
    ".git", "node_modules", "__pycache__", ".cache", "dist", ".pnpm",
    "pnpm-lock.yaml", ".replit-artifact", ".local", "logs",
    ".pyc", ".pyo"
}

MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB

BINARY_EXTENSIONS = {
    ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".webp", ".svg",
    ".pdf", ".zip", ".tar", ".gz", ".exe", ".bin", ".dll", ".so",
    ".mp4", ".mp3", ".wav", ".ogg", ".ttf", ".woff", ".woff2", ".eot"
}

LANGUAGE_MAP = {
    ".py": "python", ".js": "javascript", ".ts": "typescript",
    ".tsx": "tsx", ".jsx": "jsx", ".html": "html", ".css": "css",
    ".json": "json", ".yaml": "yaml", ".yml": "yaml", ".md": "markdown",
    ".sh": "bash", ".bash": "bash", ".sql": "sql", ".toml": "toml",
    ".rs": "rust", ".go": "go", ".java": "java", ".cpp": "cpp",
    ".c": "c", ".h": "c", ".rb": "ruby", ".php": "php",
    ".swift": "swift", ".kt": "kotlin", ".scala": "scala",
    ".txt": "text", ".env": "bash", ".gitignore": "text",
    ".mjs": "javascript", ".cjs": "javascript",
}


def resolve_path(rel_path: str) -> str:
    """Resolve relative path against workspace root safely (no traversal)."""
    base = Path(WORKSPACE_ROOT).resolve()
    target = (base / rel_path).resolve()
    if not str(target).startswith(str(base)):
        raise ValueError(f"Path traversal not allowed: {rel_path}")
    return str(target)


def should_ignore(name: str) -> bool:
    return name in IGNORE_PATTERNS or name.startswith(".")


def build_tree(abs_path: str, rel_path: str, depth: int, max_depth: int) -> Dict[str, Any]:
    p = Path(abs_path)
    name = p.name or "workspace"
    ext = p.suffix.lower() if p.suffix else None

    node: Dict[str, Any] = {
        "name": name,
        "path": rel_path,
        "type": "directory" if p.is_dir() else "file",
        "size": p.stat().st_size if p.is_file() else None,
        "extension": ext,
        "children": None,
    }

    if p.is_dir() and depth < max_depth:
        children = []
        try:
            entries = sorted(p.iterdir(), key=lambda e: (e.is_file(), e.name.lower()))
            for entry in entries:
                if should_ignore(entry.name):
                    continue
                child_rel = os.path.join(rel_path, entry.name) if rel_path != "." else entry.name
                children.append(build_tree(str(entry), child_rel, depth + 1, max_depth))
        except PermissionError:
            pass
        node["children"] = children

    return node


def get_file_tree(path: str = ".", depth: int = 3) -> Dict[str, Any]:
    abs_path = resolve_path(path)
    tree = build_tree(abs_path, path, 0, depth)
    return {"tree": tree, "rootPath": path}


def read_file(path: str) -> Dict[str, Any]:
    abs_path = resolve_path(path)
    p = Path(abs_path)

    if not p.exists():
        raise FileNotFoundError(f"File not found: {path}")

    if not p.is_file():
        raise ValueError(f"Path is not a file: {path}")

    ext = p.suffix.lower()
    is_binary = ext in BINARY_EXTENSIONS
    size = p.stat().st_size

    if is_binary:
        return {
            "path": path,
            "content": f"[Binary file: {p.name}]",
            "size": size,
            "extension": ext or None,
            "lineCount": 0,
            "isBinary": True,
        }

    if size > MAX_FILE_SIZE:
        return {
            "path": path,
            "content": f"[File too large to display: {size} bytes]",
            "size": size,
            "extension": ext or None,
            "lineCount": 0,
            "isBinary": False,
        }

    try:
        content = p.read_text(encoding="utf-8", errors="replace")
        return {
            "path": path,
            "content": content,
            "size": size,
            "extension": ext or None,
            "lineCount": content.count("\n") + 1,
            "isBinary": False,
        }
    except Exception as e:
        raise IOError(f"Failed to read file: {e}")


def write_file(path: str, content: str) -> Dict[str, Any]:
    abs_path = resolve_path(path)
    p = Path(abs_path)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding="utf-8")
    return {"success": True, "message": f"File written: {path}", "path": path}


def create_file(path: str, file_type: str = "file", content: Optional[str] = None) -> Dict[str, Any]:
    abs_path = resolve_path(path)
    p = Path(abs_path)

    if file_type == "directory":
        p.mkdir(parents=True, exist_ok=True)
        return {"success": True, "message": f"Directory created: {path}", "path": path}
    else:
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(content or "", encoding="utf-8")
        return {"success": True, "message": f"File created: {path}", "path": path}


def delete_path(path: str) -> Dict[str, Any]:
    abs_path = resolve_path(path)
    p = Path(abs_path)

    if not p.exists():
        return {"success": False, "message": f"Path not found: {path}", "path": path}

    if p.is_dir():
        shutil.rmtree(abs_path)
    else:
        p.unlink()

    return {"success": True, "message": f"Deleted: {path}", "path": path}


def rename_path(old_path: str, new_path: str) -> Dict[str, Any]:
    abs_old = resolve_path(old_path)
    abs_new = resolve_path(new_path)
    p_old = Path(abs_old)
    p_new = Path(abs_new)

    if not p_old.exists():
        raise FileNotFoundError(f"Source not found: {old_path}")

    p_new.parent.mkdir(parents=True, exist_ok=True)
    shutil.move(abs_old, abs_new)
    return {"success": True, "message": f"Renamed {old_path} to {new_path}", "path": new_path}


def get_language(path: str) -> str:
    ext = Path(path).suffix.lower()
    return LANGUAGE_MAP.get(ext, "text")
