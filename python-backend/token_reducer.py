"""
RTK-inspired token reduction for LLM context.

Compresses command output before it reaches the AI — saves 60-90% of tokens.
Implements the same four strategies as RTK (github.com/rtk-ai/rtk):

  1. Smart Filtering  — Strip ANSI codes, blank lines, boilerplate noise
  2. Grouping         — Aggregate similar items (files by dir, errors by type)
  3. Truncation       — Keep relevant context, cut redundancy with clear markers
  4. Deduplication    — Collapse repeated log lines with occurrence counts
"""

import re
from collections import Counter

# ── ANSI escape code stripper ─────────────────────────────────────────────────
_ANSI_RE = re.compile(r"\x1b\[[0-9;]*[mGKHFABCDJK]|\x1b\][^\x07]*\x07|\r")


def _strip_ansi(text: str) -> str:
    return _ANSI_RE.sub("", text)


# ── Deduplication ─────────────────────────────────────────────────────────────

def _dedup_lines(lines: list[str], threshold: int = 3) -> list[str]:
    """Collapse consecutive duplicate lines with a count."""
    if not lines:
        return lines
    out: list[str] = []
    i = 0
    while i < len(lines):
        line = lines[i]
        count = 1
        while i + count < len(lines) and lines[i + count] == line:
            count += 1
        if count >= threshold:
            out.append(f"{line}  [×{count}]")
        else:
            out.extend([line] * count)
        i += count
    return out


# ── Noise filter patterns ─────────────────────────────────────────────────────
_NOISE_PATTERNS = [
    re.compile(p) for p in [
        r"^\s*$",                                   # blank lines
        r"^\s*#.*$",                                # standalone comment lines
        r"^hint:.*$",                               # git hints
        r"^warning: LF will be replaced",          # git line-ending warnings
        r"^Your branch is up to date",
        r"^nothing to commit",
        r"^no changes added to commit",
    ]
]


def _is_noise(line: str) -> bool:
    return any(p.match(line) for p in _NOISE_PATTERNS)


# ── Skip-list for directory trees ─────────────────────────────────────────────
_SKIP_DIRS = {
    "node_modules", ".git", "__pycache__", ".venv", "venv", ".cache",
    "dist", "build", ".next", ".nuxt", ".turbo", "coverage", ".nyc_output",
    "target", "vendor", ".tox", "eggs", ".eggs", "htmlcov",
}


def _filter_tree(text: str) -> str:
    """Remove noisy directories from ls/tree/find output."""
    lines = text.splitlines()
    out: list[str] = []
    skip_prefix: str | None = None

    for line in lines:
        # Detect a skippable directory entry and set skip_prefix
        for sd in _SKIP_DIRS:
            if re.search(rf"\b{re.escape(sd)}\b", line):
                # Only skip if it looks like a directory line
                if "/" in line or line.strip().endswith(("/", sd)):
                    skip_prefix = sd
                    out.append(f"  [{sd}/ — skipped]")
                    break
        else:
            # If we're inside a skipped dir block, drop sub-entries
            if skip_prefix and (f"  {skip_prefix}" in line or line.strip() == ""):
                continue
            skip_prefix = None
            out.append(line)

    return "\n".join(out)


# ── Git compression ───────────────────────────────────────────────────────────

def _reduce_git(subcommand: str, stdout: str, stderr: str) -> tuple[str, str]:
    sub = subcommand.strip().split()[0] if subcommand.strip() else ""

    if sub in ("add",):
        # git add is silent on success — just confirm
        if stdout.strip() == "" and stderr.strip() == "":
            return "ok", ""
        return stdout, stderr

    if sub in ("commit",):
        lines = stdout.splitlines()
        summary = next((l for l in lines if re.match(r"\[.*\]", l.strip())), None)
        return (summary or stdout[:120]), stderr

    if sub in ("push", "pull", "fetch"):
        lines = stdout.splitlines() + stderr.splitlines()
        keep = [l for l in lines if any(
            kw in l for kw in ("->", "→", "...", "up-to-date", "up to date",
                               "Already", "Fast-forward", "Updating", "error", "rejected")
        )]
        if not keep:
            keep = lines[:3]
        return "\n".join(keep[:8]), ""

    if sub == "status":
        lines = stdout.splitlines()
        out: list[str] = []
        for line in lines:
            if _is_noise(line):
                continue
            if "On branch" in line or "HEAD" in line:
                out.append(line)
                continue
            if line.strip().startswith(("M ", "A ", "D ", "R ", "C ", "??")):
                out.append(line)
                continue
            if "Changes" in line or "Untracked" in line or "modified:" in line:
                out.append(line)
        return "\n".join(out) if out else "ok (clean working tree)", ""

    if sub == "diff":
        if len(stdout) > 6000:
            stdout = stdout[:6000] + "\n[diff truncated — too large to show in full]"
        return stdout, stderr

    if sub == "log":
        lines = stdout.splitlines()
        if len(lines) > 20:
            lines = lines[:20]
            lines.append(f"[...{len(stdout.splitlines()) - 20} more commits]")
        return "\n".join(lines), stderr

    return stdout, stderr


# ── Package manager compression ───────────────────────────────────────────────
_PKG_PROGRESS_RE = re.compile(
    r"(\|[█ ]*\||\[\s*\d+%\]|Downloading|Preparing|Unpacking|Processing|"
    r"Collecting|Resolving|Progress:|Already satisfied|Requirement already|"
    r"━+|⠋|⠙|⠹|⠸|⠼|⠴|⠦|⠧|⠇|⠏|[▏▎▍▌▋▊▉█]+)"
)

_PKG_KEEP_RE = re.compile(
    r"(Successfully installed|Added|Packages:|installed|Done in|"
    r"ERR!|error|Error|WARNING|warning|WARN|deprecated|"
    r"npm warn|pnpm warn|vulnerability|--\s*$)",
    re.IGNORECASE,
)


def _reduce_pkg_install(stdout: str, stderr: str) -> tuple[str, str]:
    out_lines: list[str] = []
    for line in stdout.splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        if _PKG_PROGRESS_RE.search(stripped) and not _PKG_KEEP_RE.search(stripped):
            continue
        out_lines.append(line)

    err_lines = [l for l in stderr.splitlines() if l.strip() and not _PKG_PROGRESS_RE.search(l)]

    return "\n".join(out_lines), "\n".join(err_lines)


# ── Test runner compression ───────────────────────────────────────────────────

def _reduce_test_output(stdout: str, stderr: str) -> tuple[str, str]:
    """Keep failures and the final summary; drop per-test PASS lines."""
    lines = stdout.splitlines()
    out: list[str] = []
    in_failure = False

    for line in lines:
        low = line.lower()
        # Always keep summary / failure lines
        if any(kw in low for kw in (
            "failed", "error", "errors", "passed", "skipped",
            "fail", "assert", "exception", "traceback", "warning",
            "======", "------", "FAILED", "ERROR", "passed in"
        )):
            out.append(line)
            in_failure = "fail" in low or "error" in low or "traceback" in low
            continue
        # Keep lines inside a failure block
        if in_failure:
            out.append(line)
            if line.strip() == "":
                in_failure = False
            continue
        # Drop individual PASS/OK lines
        if re.match(r"^\s*(PASSED|PASS|ok|\.)\s*$", line, re.IGNORECASE):
            continue
        if re.match(r"^test_\w+\s+PASS", line):
            continue
        out.append(line)

    # Truncate stderr to just errors
    err_lines = [l for l in stderr.splitlines() if l.strip()]
    if len(err_lines) > 30:
        err_lines = err_lines[:30] + [f"[...{len(err_lines) - 30} more stderr lines]"]

    return "\n".join(out), "\n".join(err_lines)


# ── General output compression ────────────────────────────────────────────────

def _general_reduce(stdout: str, stderr: str, max_chars: int = 16_000) -> tuple[str, str]:
    """General-purpose compression: dedup, remove blanks, truncate."""
    # Strip ANSI from both
    stdout = _strip_ansi(stdout)
    stderr = _strip_ansi(stderr)

    # Deduplicate stdout
    lines = stdout.splitlines()
    lines = _dedup_lines(lines)
    # Remove pure blank lines (keep at most one consecutive blank)
    cleaned: list[str] = []
    prev_blank = False
    for line in lines:
        is_blank = line.strip() == ""
        if is_blank and prev_blank:
            continue
        cleaned.append(line)
        prev_blank = is_blank
    stdout = "\n".join(cleaned)

    # Truncate if still too long — keep head + tail (errors tend to be at end)
    if len(stdout) > max_chars:
        half = max_chars // 2
        stdout = (
            stdout[:half]
            + f"\n\n[...{len(stdout) - max_chars} chars trimmed for context efficiency...]\n\n"
            + stdout[-half:]
        )

    if len(stderr) > 4000:
        stderr = stderr[:4000] + "\n[stderr truncated]"

    return stdout, stderr


# ── Command classifier ─────────────────────────────────────────────────────────

def _classify(command: str) -> str:
    """Return a reducer category for the command string."""
    cmd = command.strip().lstrip("./")
    first = cmd.split()[0] if cmd.split() else ""
    first_lower = first.lower()

    if first_lower == "git":
        return "git"
    if first_lower in ("ls", "tree", "find", "fd", "eza", "exa"):
        return "tree"
    if first_lower in ("pip", "pip3", "uv", "pipenv", "poetry"):
        return "pkg"
    if first_lower in ("npm", "pnpm", "yarn", "bun"):
        # Only compress install/add/remove commands
        rest = cmd[len(first):].strip().split()[0] if len(cmd) > len(first) else ""
        if rest in ("install", "add", "remove", "uninstall", "ci", "i"):
            return "pkg"
    if first_lower in ("pytest", "py.test"):
        return "test"
    if re.match(r"npm\s+(test|run\s+test)", cmd):
        return "test"
    if re.match(r"(cargo\s+test|go\s+test)", cmd):
        return "test"
    return "general"


# ── Public entry point ────────────────────────────────────────────────────────

def reduce(command: str, stdout: str, stderr: str, exit_code: int) -> tuple[str, str]:
    """
    Reduce command output tokens before sending to the LLM.

    Returns (reduced_stdout, reduced_stderr).
    Adds a tiny header showing original vs reduced size when savings > 20%.
    """
    if not stdout and not stderr:
        return stdout, stderr

    original_len = len(stdout) + len(stderr)

    # Always strip ANSI first
    stdout = _strip_ansi(stdout)
    stderr = _strip_ansi(stderr)

    category = _classify(command)

    if category == "git":
        parts = command.strip().split()
        subcommand = " ".join(parts[1:]) if len(parts) > 1 else ""
        stdout, stderr = _reduce_git(subcommand, stdout, stderr)

    elif category == "tree":
        stdout = _filter_tree(stdout)
        stdout, stderr = _general_reduce(stdout, stderr, max_chars=8000)

    elif category == "pkg":
        stdout, stderr = _reduce_pkg_install(stdout, stderr)
        stdout, stderr = _general_reduce(stdout, stderr, max_chars=4000)

    elif category == "test":
        stdout, stderr = _reduce_test_output(stdout, stderr)
        stdout, stderr = _general_reduce(stdout, stderr, max_chars=12000)

    else:
        stdout, stderr = _general_reduce(stdout, stderr, max_chars=16000)

    reduced_len = len(stdout) + len(stderr)
    if original_len > 0 and reduced_len < original_len * 0.8 and original_len > 500:
        savings_pct = int((1 - reduced_len / original_len) * 100)
        header = f"[RTK: {original_len:,}→{reduced_len:,} chars, -{savings_pct}% tokens]\n"
        stdout = header + stdout if stdout else header.strip()

    return stdout, stderr


def get_stats(command: str, stdout: str, stderr: str) -> dict:
    """Return stats about potential savings without modifying output."""
    original_len = len(stdout) + len(stderr)
    r_out, r_err = reduce(command, stdout, stderr, 0)
    reduced_len = len(r_out) + len(r_err)
    return {
        "original_chars": original_len,
        "reduced_chars": reduced_len,
        "savings_pct": int((1 - reduced_len / original_len) * 100) if original_len else 0,
        "category": _classify(command),
    }
