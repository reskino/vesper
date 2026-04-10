"""
VesperRouter — intelligent AI routing engine.

Analyzes every prompt using signal detection and a weighted scoring matrix
to pick the best available AI provider. Zero latency — no extra API calls,
pure deterministic logic. Every decision is transparent and explainable.

Decision tree overview:
  1. DETECT signals from prompt text (keywords, length, code, file count)
  2. SCORE each connected provider against each signal × its strength
  3. SELECT highest-scoring provider, compute confidence gap
  4. EXPLAIN the decision in one human-readable sentence

Routing philosophy:
  Claude   → deep reasoning, complex code, refactoring, architecture
  ChatGPT  → general tasks, quick answers, documentation, testing
  Grok     → creative solutions, humor, fast prototyping, casual chat
  Gemini   → long context, data/ML tasks, multimodal reasoning
  Groq     → ultra-fast inference, short responses, real-time chat
  DeepSeek → code generation, reasoning chains, math-heavy tasks
  Others   → general fallback
"""

import re
from typing import Optional

# ─────────────────────────────────────────────────────────────────────────────
# Provider capability profiles
#
# Each provider is rated 0–3 per task dimension:
#   0.0 = poor fit   1.0 = acceptable   2.0 = good   3.0 = best-in-class
# ─────────────────────────────────────────────────────────────────────────────

PROVIDER_PROFILES: dict[str, dict[str, float]] = {
    "claude": {
        "deep_reasoning":   3.0,   # Extended thinking, step-by-step analysis
        "complex_code":     3.0,   # Multi-file, multi-concept coding tasks
        "refactoring":      3.0,   # Code cleanup, redesign, architecture
        "architecture":     3.0,   # System design, patterns, trade-offs
        "debugging":        2.5,   # Trace through bugs carefully
        "testing":          2.5,   # Thorough test coverage
        "documentation":    2.5,   # Clear, detailed docs
        "long_context":     2.5,   # Handles large codebases well
        "general":          1.5,   # Fine but not its specialty
        "quick_answer":     1.0,   # Tends to be verbose
        "creative":         1.5,   # Can do it but not its vibe
        "conversational":   1.5,
        "fast":             0.5,   # Not optimized for speed
        "math":             2.5,
        "data":             2.0,
    },
    "chatgpt": {
        "deep_reasoning":   2.0,
        "complex_code":     2.0,
        "refactoring":      2.0,
        "architecture":     2.0,
        "debugging":        2.5,
        "testing":          2.5,
        "documentation":    3.0,   # Very good at clear docs / explanations
        "long_context":     1.5,
        "general":          3.0,   # The generalist king
        "quick_answer":     3.0,   # Concise when asked
        "creative":         2.0,
        "conversational":   2.5,
        "fast":             2.0,
        "math":             2.0,
        "data":             2.0,
    },
    "grok": {
        "deep_reasoning":   1.5,
        "complex_code":     1.5,
        "refactoring":      1.5,
        "architecture":     1.5,
        "debugging":        2.0,
        "testing":          1.5,
        "documentation":    1.5,
        "long_context":     1.5,
        "general":          2.0,
        "quick_answer":     2.5,
        "creative":         3.0,   # Lateral thinking, novel solutions
        "conversational":   3.0,   # Wit, personality, casual banter
        "fast":             3.0,   # Grok 3 mini is very fast
        "math":             1.5,
        "data":             1.5,
    },
    "gemini": {
        "deep_reasoning":   2.5,
        "complex_code":     2.0,
        "refactoring":      2.0,
        "architecture":     2.5,
        "debugging":        2.0,
        "testing":          2.0,
        "documentation":    2.0,
        "long_context":     3.0,   # Gemini 1.5M context window king
        "general":          2.5,
        "quick_answer":     2.5,
        "creative":         2.0,
        "conversational":   2.0,
        "fast":             2.5,
        "math":             2.5,
        "data":             3.0,   # Strong on ML, data analysis
    },
    "groq": {
        "deep_reasoning":   1.5,
        "complex_code":     1.5,
        "refactoring":      1.5,
        "architecture":     1.0,
        "debugging":        1.5,
        "testing":          1.5,
        "documentation":    1.5,
        "long_context":     1.0,   # Limited context window
        "general":          2.5,
        "quick_answer":     3.0,   # Fastest inference on the planet
        "creative":         2.0,
        "conversational":   2.5,
        "fast":             3.0,   # Purpose-built for speed
        "math":             1.5,
        "data":             1.5,
    },
    "deepseek": {
        "deep_reasoning":   3.0,   # DeepSeek R1 rivals o1
        "complex_code":     2.5,
        "refactoring":      2.0,
        "architecture":     2.0,
        "debugging":        2.5,
        "testing":          2.0,
        "documentation":    1.5,
        "long_context":     2.0,
        "general":          2.0,
        "quick_answer":     1.5,
        "creative":         1.5,
        "conversational":   1.5,
        "fast":             1.5,
        "math":             3.0,   # Math olympiad-level reasoning
        "data":             2.5,
    },
    "mistral": {
        "deep_reasoning":   1.5,
        "complex_code":     2.0,
        "refactoring":      1.5,
        "architecture":     1.5,
        "debugging":        1.5,
        "testing":          1.5,
        "documentation":    1.5,
        "long_context":     2.0,
        "general":          2.0,
        "quick_answer":     2.5,
        "creative":         1.5,
        "conversational":   2.0,
        "fast":             2.5,   # Mistral Small is fast
        "math":             1.5,
        "data":             1.5,
    },
    "gemini": {
        "deep_reasoning":   2.5,
        "complex_code":     2.0,
        "refactoring":      2.0,
        "architecture":     2.5,
        "debugging":        2.0,
        "testing":          2.0,
        "documentation":    2.0,
        "long_context":     3.0,
        "general":          2.5,
        "quick_answer":     2.5,
        "creative":         2.0,
        "conversational":   2.0,
        "fast":             2.5,
        "math":             2.5,
        "data":             3.0,
    },
    "openrouter": {
        "deep_reasoning":   2.0,
        "complex_code":     2.0,
        "refactoring":      2.0,
        "architecture":     2.0,
        "debugging":        2.0,
        "testing":          2.0,
        "documentation":    2.0,
        "long_context":     2.0,
        "general":          2.5,
        "quick_answer":     2.5,
        "creative":         2.0,
        "conversational":   2.0,
        "fast":             2.0,
        "math":             2.0,
        "data":             2.0,
    },
    "together": {
        "deep_reasoning":   1.5,
        "complex_code":     1.5,
        "refactoring":      1.5,
        "architecture":     1.0,
        "debugging":        1.5,
        "testing":          1.5,
        "documentation":    1.5,
        "long_context":     1.5,
        "general":          2.5,
        "quick_answer":     2.5,
        "creative":         2.0,
        "conversational":   2.0,
        "fast":             2.5,
        "math":             1.5,
        "data":             1.5,
    },
    "cerebras": {
        "deep_reasoning":   1.5,
        "complex_code":     1.5,
        "refactoring":      1.0,
        "architecture":     1.0,
        "debugging":        1.5,
        "testing":          1.5,
        "documentation":    1.5,
        "long_context":     1.0,
        "general":          2.0,
        "quick_answer":     3.0,   # Ultra-fast custom chips
        "creative":         1.5,
        "conversational":   2.0,
        "fast":             3.0,
        "math":             1.5,
        "data":             1.5,
    },
    "cohere": {
        "deep_reasoning":   1.5,
        "complex_code":     1.5,
        "refactoring":      1.5,
        "architecture":     1.5,
        "debugging":        1.5,
        "testing":          1.5,
        "documentation":    2.0,
        "long_context":     2.0,
        "general":          2.0,
        "quick_answer":     2.0,
        "creative":         1.5,
        "conversational":   2.0,
        "fast":             2.0,
        "math":             1.5,
        "data":             2.0,
    },
    "pollinations": {
        "deep_reasoning":   1.5,
        "complex_code":     1.5,
        "refactoring":      1.5,
        "architecture":     1.0,
        "debugging":        1.5,
        "testing":          1.5,
        "documentation":    1.5,
        "long_context":     1.0,
        "general":          2.0,
        "quick_answer":     2.5,
        "creative":         1.5,
        "conversational":   2.0,
        "fast":             2.5,
        "math":             1.5,
        "data":             1.5,
    },
}

# Fallback profile for unknown providers
_DEFAULT_PROFILE: dict[str, float] = {dim: 1.5 for dim in [
    "deep_reasoning", "complex_code", "refactoring", "architecture",
    "debugging", "testing", "documentation", "long_context",
    "general", "quick_answer", "creative", "conversational", "fast",
    "math", "data",
]}


# ─────────────────────────────────────────────────────────────────────────────
# Signal detection rules
#
# Each rule maps one-or-more regex patterns to a task dimension + weight.
# Weight = how strongly this signal implies the dimension.
# The router detects ALL matching signals then scores providers against them.
# ─────────────────────────────────────────────────────────────────────────────

SIGNAL_RULES: list[dict] = [
    # ── Deep reasoning ────────────────────────────────────────────────────────
    {
        "patterns": [r"\brefactor\b", r"\bredesign\b", r"\bclean(?:[\s-]up)?\b", r"\bimprove(?:\s+the)?\s+code\b"],
        "dimension": "refactoring", "weight": 3.0,
        "label": "refactoring task",
    },
    {
        "patterns": [r"\barchitect\b", r"\bdesign\s+pattern\b", r"\bsystem\s+design\b", r"\bscalable\b", r"\bmicroservice\b", r"\bsoftware\s+design\b"],
        "dimension": "architecture", "weight": 3.0,
        "label": "architecture / system design",
    },
    {
        "patterns": [r"\bcomplex\b", r"\bin[\s-]depth\b", r"\bthorough\b", r"\bcomprehensive\b", r"\bdetailed\s+analysis\b", r"\bdeep\s+dive\b"],
        "dimension": "deep_reasoning", "weight": 2.5,
        "label": "deep analysis requested",
    },
    {
        "patterns": [r"\bstep[\s-]by[\s-]step\b", r"\bwalk\s+me\s+through\b", r"\btrace\s+through\b", r"\bexplain.*in\s+detail\b", r"\bhow\s+does\s+.{0,40}\s+work\b"],
        "dimension": "deep_reasoning", "weight": 2.0,
        "label": "detailed walkthrough requested",
    },
    {
        "patterns": [r"\breason(?:ing)?\b", r"\bchain[\s-]of[\s-]thought\b", r"\bthink.*through\b", r"\banalyze\b", r"\bbreak.*down\b"],
        "dimension": "deep_reasoning", "weight": 2.0,
        "label": "reasoning task",
    },

    # ── Code quality ──────────────────────────────────────────────────────────
    {
        "patterns": [r"\bunit[\s-]test\b", r"\btest[\s-]case\b", r"\bwrite.*tests?\b", r"\btdd\b", r"\bjest\b", r"\bpytest\b", r"\bvitest\b", r"\bmocha\b"],
        "dimension": "testing", "weight": 2.5,
        "label": "testing task",
    },
    {
        "patterns": [r"\bdocument\b", r"\bdocstring\b", r"\bjsdoc\b", r"\bjavadoc\b", r"\breadme\b", r"\bcomments?\b", r"\badd\s+docs\b"],
        "dimension": "documentation", "weight": 2.0,
        "label": "documentation task",
    },
    {
        "patterns": [r"\boptimiz\b", r"\bperformance\b", r"\bspeed\s+up\b", r"\befficienc\b", r"\bbottleneck\b", r"\bprofile\b", r"\bcache\b"],
        "dimension": "complex_code", "weight": 2.0,
        "label": "performance optimization",
    },
    {
        "patterns": [r"\bapi\b", r"\brest\b", r"\bgraphql\b", r"\bendpoint\b", r"\bwebhook\b", r"\bmiddleware\b"],
        "dimension": "complex_code", "weight": 1.5,
        "label": "API / backend task",
    },
    {
        "patterns": [r"\bdatabase\b", r"\bsql\b", r"\bquery\b", r"\borm\b", r"\bschema\b", r"\bmigration\b", r"\bpostgres\b", r"\bmysql\b"],
        "dimension": "complex_code", "weight": 1.5,
        "label": "database task",
    },

    # ── Debugging ─────────────────────────────────────────────────────────────
    {
        "patterns": [r"\bdebug\b", r"\bfix(?:ing)?\b", r"\bbug\b", r"\berror\b", r"\bexception\b", r"\btraceback\b", r"\bcrash\b", r"\bbroken\b", r"\bfailing\b", r"\bnot\s+working\b"],
        "dimension": "debugging", "weight": 2.5,
        "label": "debugging task",
    },
    {
        "patterns": [r"\bwhy\s+does\b", r"\bwhat\s+is\s+wrong\b", r"\bcan't\s+figure\s+out\b", r"\bdoesn't\s+work\b", r"\bhelp.*fix\b"],
        "dimension": "debugging", "weight": 2.0,
        "label": "troubleshooting request",
    },

    # ── Creative ──────────────────────────────────────────────────────────────
    {
        "patterns": [r"\bcreative\b", r"\bbrainstorm\b", r"\bcome\s+up\s+with\b", r"\bnovel\b", r"\bunique\b", r"\boriginal\b", r"\binspir\b"],
        "dimension": "creative", "weight": 2.5,
        "label": "creative brainstorming",
    },
    {
        "patterns": [r"\bfunny\b", r"\bjoke\b", r"\bhumor\b", r"\bwitty\b", r"\bplayful\b", r"\bsarcast\b", r"\bmeme\b", r"\blaugh\b"],
        "dimension": "creative", "weight": 3.0,
        "label": "humor / creative tone",
    },
    {
        "patterns": [r"\balternative\b", r"\bdifferent\s+approach\b", r"\bother\s+way\b", r"\bprototype\b", r"\bquick\s+draft\b", r"\bhack\b"],
        "dimension": "creative", "weight": 2.0,
        "label": "alternative approach",
    },

    # ── Speed / conciseness ───────────────────────────────────────────────────
    {
        "patterns": [r"\bquick\b", r"\bfast\b", r"\bbriefly\b", r"\bshort\b", r"\bsimple\b", r"\btl;?dr\b", r"\bsummary\b", r"\bjust\s+give\b", r"\bone[\s-]liner\b"],
        "dimension": "quick_answer", "weight": 2.5,
        "label": "quick answer requested",
    },
    {
        "patterns": [r"\bsnippet\b", r"\bexample\b", r"\bshow\s+me\b", r"\bdemonstrate\b"],
        "dimension": "quick_answer", "weight": 1.5,
        "label": "code snippet / example",
    },

    # ── General / conversational ──────────────────────────────────────────────
    {
        "patterns": [r"^(hi|hello|hey|sup|yo)\b", r"\bhow are you\b", r"\bwhat.*you\s+think\b", r"\bthanks\b", r"\bthank\s+you\b"],
        "dimension": "conversational", "weight": 3.0,
        "label": "conversational message",
    },
    {
        "patterns": [r"\bwhat\s+is\b", r"\bwhat's\b", r"\bhow\s+do\s+I\b", r"\bcan\s+you\b", r"\bplease\b"],
        "dimension": "general", "weight": 1.5,
        "label": "general question",
    },

    # ── Long context ──────────────────────────────────────────────────────────
    {
        "patterns": [r"\bwhole\s+file\b", r"\ball\s+files\b", r"\bfull\s+codebase\b", r"\bentire\s+project\b", r"\bevery\s+file\b"],
        "dimension": "long_context", "weight": 2.5,
        "label": "full codebase context",
    },

    # ── Math / data ───────────────────────────────────────────────────────────
    {
        "patterns": [r"\bmath\b", r"\bequation\b", r"\balgorithm\b", r"\bproof\b", r"\bcalculate\b", r"\bcompute\b", r"\bnumerical\b"],
        "dimension": "math", "weight": 2.5,
        "label": "math / algorithm task",
    },
    {
        "patterns": [r"\bdata\s+analys\b", r"\bpandas\b", r"\bnumpy\b", r"\bml\b", r"\bmachine\s+learning\b", r"\bneural\b", r"\bpytorch\b", r"\btensorflow\b"],
        "dimension": "data", "weight": 2.5,
        "label": "data / ML task",
    },
]

# Patterns that indicate code is present in the prompt
_CODE_PATTERNS = [
    r"```[\w\s]*\n",            # fenced code block
    r"\bdef \w+\s*\(",          # Python function
    r"\bfunction\s+\w+\s*\(",   # JS function
    r"\bconst\s+\w+\s*=",       # JS const
    r"\bclass\s+\w+[\s:{<]",    # class definition
    r"import\s+\w+",            # import statement
    r"if\s+__name__",           # Python main guard
    r"\bpublic\s+class\b",      # Java
    r"\bfunc\s+\w+\(",          # Go
    r"\bfn\s+\w+\(",            # Rust
    r"\b:=\s",                  # Go short assignment
    r"\breturn\s+{",            # object return
    r"(?m)^\s{4,}\S",           # 4+ space indented block
    r"(?m)^//\s",               # line comment
    r"(?m)^#\s",                # Python comment
]


# ─────────────────────────────────────────────────────────────────────────────
# Signal detection
# ─────────────────────────────────────────────────────────────────────────────

def _detect_signals(prompt: str, num_files: int) -> list[dict]:
    """Extract all routing signals from the prompt and context."""
    lower = prompt.lower()
    signals: list[dict] = []
    seen: set[str] = set()

    for rule in SIGNAL_RULES:
        if rule["dimension"] in seen:
            continue
        for pattern in rule["patterns"]:
            if re.search(pattern, lower):
                signals.append({
                    "dimension": rule["dimension"],
                    "weight":    rule["weight"],
                    "label":     rule["label"],
                })
                seen.add(rule["dimension"])
                break

    # Length-based signals
    word_count = len(prompt.split())
    if word_count > 300:
        if "deep_reasoning" not in seen:
            signals.append({"dimension": "deep_reasoning", "weight": 2.0, "label": "long detailed prompt"})
        if "long_context" not in seen:
            signals.append({"dimension": "long_context", "weight": 1.5, "label": "long prompt"})
    elif word_count < 12:
        if "quick_answer" not in seen:
            signals.append({"dimension": "quick_answer", "weight": 2.0, "label": "very short prompt"})
        if "conversational" not in seen:
            signals.append({"dimension": "conversational", "weight": 1.5, "label": "brief query"})

    # Code presence
    has_code = any(re.search(p, prompt, re.MULTILINE | re.IGNORECASE) for p in _CODE_PATTERNS)
    if has_code and "complex_code" not in seen:
        signals.append({"dimension": "complex_code", "weight": 2.0, "label": "code in prompt"})

    # File attachment signals
    if num_files >= 3 and "long_context" not in seen:
        signals.append({"dimension": "long_context", "weight": 2.5, "label": f"{num_files} files attached"})
        if "complex_code" not in seen:
            signals.append({"dimension": "complex_code", "weight": 2.0, "label": "multi-file context"})
    elif num_files == 1 and "debugging" not in seen:
        signals.append({"dimension": "debugging", "weight": 1.0, "label": "file attached"})

    return signals


# ─────────────────────────────────────────────────────────────────────────────
# Scoring
# ─────────────────────────────────────────────────────────────────────────────

def _score_providers(signals: list[dict], available: list[str]) -> dict[str, float]:
    """Score each available provider against the detected signals."""
    scores: dict[str, float] = {}
    for pid in available:
        profile = PROVIDER_PROFILES.get(pid, _DEFAULT_PROFILE)
        score = 0.0
        for sig in signals:
            strength = profile.get(sig["dimension"], 1.0)
            score += sig["weight"] * strength
        scores[pid] = round(score, 2)
    return scores


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

PROVIDER_NICE_NAMES = {
    "claude": "Claude",
    "chatgpt": "ChatGPT",
    "grok": "Grok",
    "gemini": "Gemini",
    "groq": "Groq",
    "deepseek": "DeepSeek",
    "pollinations": "Pollinations AI",
    "openrouter": "OpenRouter",
    "together": "Together AI",
    "mistral": "Mistral",
    "cerebras": "Cerebras",
    "cohere": "Cohere",
}


def route(
    prompt: str,
    available_ai_ids: list[str],
    num_files: int = 0,
) -> dict:
    """
    Route a prompt to the best available AI provider.

    Args:
        prompt: The user's message text.
        available_ai_ids: IDs of providers that have active sessions.
        num_files: Number of file attachments (affects context-length scoring).

    Returns:
        {
            "aiId":       str,         # chosen provider ID
            "reason":     str,         # human-readable one-liner
            "signals":    list[str],   # detected task labels
            "scores":     dict,        # {provider_id: score}
            "confidence": float,       # 0.0–1.0 (gap between 1st and 2nd)
        }
    """
    if not available_ai_ids:
        return {
            "aiId":       "pollinations",
            "reason":     "No connected AIs — using Pollinations AI (always free, no key needed)",
            "signals":    [],
            "scores":     {},
            "confidence": 0.0,
        }

    signals = _detect_signals(prompt, num_files)

    # If completely empty prompt, default to conversational
    if not signals:
        signals = [{"dimension": "general", "weight": 1.0, "label": "general task"}]

    scores = _score_providers(signals, available_ai_ids)

    # Winner
    best = max(scores, key=lambda k: scores[k])

    # Confidence = normalised gap between top two scores
    sorted_vals = sorted(scores.values(), reverse=True)
    if len(sorted_vals) >= 2 and sorted_vals[0] > 0:
        gap = sorted_vals[0] - sorted_vals[1]
        confidence = min(gap / sorted_vals[0], 1.0)
    else:
        confidence = 1.0

    labels = [s["label"] for s in signals]
    name = PROVIDER_NICE_NAMES.get(best, best.title())

    # Primary reason label
    top_label = labels[0] if labels else "general task"
    reason = f"Routed to {name} — detected {top_label}"
    if len(labels) > 1:
        reason += f" + {labels[1]}"
    if len(labels) > 2:
        reason += f" (+{len(labels) - 2} more signals)"

    return {
        "aiId":       best,
        "reason":     reason,
        "signals":    labels,
        "scores":     scores,
        "confidence": round(confidence, 2),
    }


def explain(decision: dict) -> str:
    """Return a compact one-line explanation suitable for display in the UI."""
    scores = decision.get("scores", {})
    signals = decision.get("signals", [])
    if not scores:
        return decision.get("reason", "")

    sorted_providers = sorted(scores.items(), key=lambda x: x[1], reverse=True)
    ranking = " > ".join(
        f"{PROVIDER_NICE_NAMES.get(pid, pid)} ({score:.0f})"
        for pid, score in sorted_providers[:3]
    )

    signal_str = ", ".join(signals[:2]) if signals else "general"
    return f"Signals: {signal_str} | Scores: {ranking}"
