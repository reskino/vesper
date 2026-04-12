/**
 * intent-detect.ts — client-side intent classifier for Vesper chat
 *
 * Two independent detectors:
 *
 *  detectInstallIntent(text)
 *    Catches "install requests", "uv add flask", "npm install axios" etc.
 *    Returns the extracted package name so the chat panel can trigger a
 *    workspace dependency install WITHOUT an AI roundtrip.
 *
 *  detectIntent(text)
 *    Maps natural language to the best Vesper agent persona with action chips.
 *    Also returns an `action` key that maps to the backend ACTION_PREFIXES.
 *
 * Design principles
 *  • Zero latency (pure regex, runs on every keystroke after 300 ms debounce)
 *  • Mobile-safe (no LLM call before send)
 *  • Easily extensible: add a rule object to RULES or a pattern to INSTALL_PATTERNS
 */

import type { AgentType } from "@/contexts/agent-context";

// ── Shared types ──────────────────────────────────────────────────────────────

export interface IntentResult {
  agentType:  AgentType;
  label:      string;
  confidence: number;
  chips:      string[];
  color:      string;
  /** Mapped action key forwarded to the backend ACTION_PREFIXES */
  action?:    string;
}

export interface InstallIntentResult {
  /** The extracted package name, e.g. "requests", "numpy", "axios@4" */
  packageName: string;
  /** Package manager hinted by the user, or null if unknown */
  manager: "uv" | "npm" | null;
  /** The full matched substring for display */
  raw: string;
}

// ── Install intent ─────────────────────────────────────────────────────────────

const INSTALL_PATTERNS: Array<{ re: RegExp; manager: "uv" | "npm" | null }> = [
  // Explicit tool commands
  { re: /\b(?:uv\s+add|pip\s+install|pip3\s+install)\s+([\w.\-\[\]@,+]+)/i,  manager: "uv"  },
  { re: /\b(?:npm\s+install|npm\s+i|yarn\s+add|pnpm\s+add)\s+([\w.\-@/]+)/i, manager: "npm" },

  // Natural language — "install X", "add X package", "add package X"
  { re: /\binstall\s+([\w.\-\[\]@,+/]+)\b/i, manager: null },
  { re: /\badd\s+([\w.\-\[\]@,+/]+)\s+(?:package|library|lib|module|dep(?:endency)?)\b/i, manager: null },
  { re: /\badd\s+(?:package|library|lib|module|dep(?:endency)?)\s+([\w.\-\[\]@,+/]+)\b/i, manager: null },

  // "I need X library" / "X is not installed"
  { re: /\b(?:i\s+need|we\s+need|let(?:'?s)?\s+use)\s+([\w.\-\[\]@,+/]+)\s+(?:package|library|lib|module)\b/i, manager: null },
  { re: /\b([\w.\-\[\]@,+/]+)\s+(?:is\s+)?(?:not\s+installed|missing|required)\b/i, manager: null },
];

/** Words that can appear in the package-name capture but are NOT package names */
const INSTALL_STOPWORDS = new Set([
  "a","an","the","it","this","that","my","our","your","its",
  "node","python","pip","npm","yarn","uv","pnpm",
  "package","packages","library","libraries","module","modules",
  "dependency","dependencies","something","anything","everything",
  "update","upgrade","remove","uninstall","delete","get",
  "yes","no","please","thanks","ok","okay","that","those",
]);

export function detectInstallIntent(text: string): InstallIntentResult | null {
  const trimmed = text.trim();
  if (trimmed.length < 4) return null;

  for (const { re, manager } of INSTALL_PATTERNS) {
    const m = re.exec(trimmed);
    if (!m) continue;

    const raw = m[1]?.trim() ?? "";
    const packageName = raw.replace(/^["'`]|["'`]$/g, "").trim();

    // Must be a plausible package name: starts with letter or @ and ≥ 2 chars
    if (!packageName || packageName.length < 2) continue;
    if (INSTALL_STOPWORDS.has(packageName.toLowerCase())) continue;
    if (!/^[@a-zA-Z][\w.\-\[\]@,+/]{1,}$/.test(packageName)) continue;

    return { packageName, manager, raw: m[0] };
  }

  return null;
}

// ── Agent intent ──────────────────────────────────────────────────────────────

type IntentRule = {
  agentType:  AgentType;
  label:      string;
  pattern:    RegExp;
  confidence: number;
  color:      string;
  chips:      string[];
  action?:    string;
};

/**
 * Rules are first-match-wins; put higher-confidence / more-specific rules first.
 */
const RULES: IntentRule[] = [
  // ── Code Surgeon: bug fixing ────────────────────────────────────────────────
  {
    agentType:  "code_surgeon",
    label:      "Code Surgeon",
    action:     "fix",
    pattern:    /\b(fix|bug|error|crash|broken|doesn'?t\s+work|not\s+working|failing|exception|traceback|stack\s*trace|segfault|null\s*pointer|undefined\s+is\s+not|type\s*error|syntax\s*error|import\s*error|module\s*not\s*found)\b/i,
    confidence: 0.92,
    color:      "rose",
    chips:      ["Fix this bug", "Show me the error", "Debug step by step", "Trace the crash"],
  },

  // ── Code Surgeon: refactor / optimise ──────────────────────────────────────
  {
    agentType:  "code_surgeon",
    label:      "Code Surgeon",
    action:     "refactor",
    pattern:    /\b(refactor|clean\s*up|cleanup|optimi[sz]e|performance|slow|memory\s*leak|rewrite|simplify|dry\s+it\s+up|solid|decouple|modular|readab|maintainab|lint|code\s+smell|technical\s+debt|dead\s+code|type\s+annotation|mypy|strict)\b/i,
    confidence: 0.88,
    color:      "rose",
    chips:      ["Refactor the code", "Optimize performance", "Add type annotations", "Simplify this"],
  },

  // ── Research Scholar: explain / learn ──────────────────────────────────────
  {
    agentType:  "scholar",
    label:      "Research Scholar",
    action:     "explain",
    pattern:    /\b(explain|what\s+is|what\s+are|how\s+does|how\s+do|why\s+does|why\s+is|understand|overview|summarize|describe|compare|difference\s+between|pros\s+and\s+cons|history\s+of|deep[\s-]?dive|academic|research|paper|study|learn|teach|walk[\s-]?me[\s-]?through|break[\s-]?down|in[\s-]?depth)\b/i,
    confidence: 0.87,
    color:      "emerald",
    chips:      ["Explain in depth", "Compare alternatives", "Summarise the key points", "Find related papers"],
  },

  // ── Search Master: find / look up ──────────────────────────────────────────
  {
    agentType:  "search_master",
    label:      "Search Master",
    pattern:    /\b(search|find|look\s*up|fetch|get\s+me|show\s+me|latest|recent|current|news|trending|best\s+practices|github|npm\s+package|pypi|crates\.io|library\s+for|framework\s+for|tool\s+for|2024|2025|2026|what'?s\s+new|where\s+is|locate|discover)\b/i,
    confidence: 0.84,
    color:      "sky",
    chips:      ["Search the web", "Find best practices", "Find GitHub repos", "Get latest news"],
  },

  // ── Docs Weaver: documentation ─────────────────────────────────────────────
  {
    agentType:  "docs_weaver",
    label:      "Docs Weaver",
    action:     "document",
    pattern:    /\b(document(?:ation|ed|ing)?|docs|readme|api[\s-]?doc|comment|docstring|jsdoc|tsdoc|write[\s\w]{0,12}doc|add[\s\w]{0,12}doc|guide|tutorial|onboard|wiki|changelog|annotate|openapi|swagger|spec)\b/i,
    confidence: 0.88,
    color:      "amber",
    chips:      ["Write README", "Generate API docs", "Add code comments", "Create a tutorial"],
  },

  // ── Orchestrator / Builder: build, create, architect ───────────────────────
  {
    agentType:  "orchestrator",
    label:      "Orchestrator",
    pattern:    /\b(build|create|implement|develop|architect|design|scaffold|from\s+scratch|full[\s-]?stack|full[\s-]?app|project|system|end[\s-]?to[\s-]?end|e2e|deploy|production|set\s+up|setup|initialize|bootstrap|generate|new\s+(?:app|project|service|api|backend|frontend))\b/i,
    confidence: 0.81,
    color:      "violet",
    chips:      ["Build from scratch", "Design architecture", "Create full project", "Plan the system"],
  },
];

const MIN_LENGTH = 4;

export function detectIntent(text: string): IntentResult | null {
  const trimmed = text.trim();
  if (trimmed.length < MIN_LENGTH) return null;

  for (const rule of RULES) {
    if (rule.pattern.test(trimmed)) {
      return {
        agentType:  rule.agentType,
        label:      rule.label,
        confidence: rule.confidence,
        chips:      rule.chips.slice(0, 4),
        color:      rule.color,
        action:     rule.action,
      };
    }
  }

  return null;
}

// ── Agent persona prefixes ────────────────────────────────────────────────────

/**
 * Short role banners prepended to the user message before sending to the AI.
 * They nudge the model to stay in the specialist persona.
 */
export const AGENT_PREFIXES: Record<AgentType, string> = {
  builder:       "",
  orchestrator:  "[Vesper Orchestrator — full-stack architect & multi-role coordinator]\n\n",
  scholar:       "[Vesper Research Scholar — academic rigour, citations, structured output]\n\n",
  search_master: "[Vesper Search Master — deep web research, source-verified, link-rich]\n\n",
  docs_weaver:   "[Vesper Docs Weaver — clear, beautiful technical documentation]\n\n",
  code_surgeon:  "[Vesper Code Surgeon — precise refactoring, bug-fixing & optimisation]\n\n",
};
