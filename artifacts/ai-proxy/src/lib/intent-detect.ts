import type { AgentType } from "@/contexts/agent-context";

export interface IntentResult {
  agentType: AgentType;
  label: string;
  confidence: number;
  chips: string[];
  color: string;
}

type IntentRule = {
  agentType: AgentType;
  label: string;
  pattern: RegExp;
  confidence: number;
  color: string;
  chips: string[];
};

const RULES: IntentRule[] = [
  {
    agentType: "code_surgeon",
    label: "Code Surgeon",
    pattern: /\b(fix|bug|error|crash|broken|doesn't work|not working|failing|exception|traceback|refactor|clean up|cleanup|optimi[sz]e|performance|slow|memory|type.?error|lint|code smell|technical debt|rewrite|simplify|dry|solid|dead code)\b/i,
    confidence: 0.88,
    color: "rose",
    chips: ["Fix this bug", "Refactor the code", "Add type annotations", "Optimize performance"],
  },
  {
    agentType: "scholar",
    label: "Research Scholar",
    pattern: /\b(explain|what is|what are|how does|how do|why does|why is|understand|overview|summarize|describe|compare|difference between|pros and cons|history of|deep.?dive|academic|research|paper|study|learn)\b/i,
    confidence: 0.85,
    color: "emerald",
    chips: ["Explain in depth", "Compare alternatives", "Write a summary", "Find research papers"],
  },
  {
    agentType: "search_master",
    label: "Search Master",
    pattern: /\b(search|find|look up|fetch|get me|show me|latest|recent|current|news|trending|best practices|github|npm|library|package|framework|tool|2024|2025|2026)\b/i,
    confidence: 0.82,
    color: "sky",
    chips: ["Search the web", "Find best practices", "Find GitHub repos", "Get latest news"],
  },
  {
    agentType: "docs_weaver",
    label: "Docs Weaver",
    pattern: /\b(document(?:ation|ed|ing)?|docs|readme|api.?doc|comment|docstring|jsdoc|tsdoc|write.{0,15}doc|add.{0,15}doc|guide|tutorial|onboard|wiki|changelog)\b/i,
    confidence: 0.86,
    color: "amber",
    chips: ["Write README", "Generate API docs", "Add code comments", "Create a tutorial"],
  },
  {
    agentType: "orchestrator",
    label: "Orchestrator",
    pattern: /\b(build|create|implement|develop|architect|design|scaffold|from scratch|full.?stack|full.?app|project|system|end.?to.?end|e2e|deploy|production|set up|setup|initialize|bootstrap)\b/i,
    confidence: 0.80,
    color: "violet",
    chips: ["Build from scratch", "Design architecture", "Create full project", "Plan the system"],
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
      };
    }
  }

  return null;
}

export const AGENT_PREFIXES: Record<AgentType, string> = {
  builder:       "",
  orchestrator:  "[Vesper Orchestrator — all-in-one expert AI]\n\n",
  scholar:       "[Vesper Research Scholar — academic rigour, citations, export-ready]\n\n",
  search_master: "[Vesper Search Master — deep research, source-verified]\n\n",
  docs_weaver:   "[Vesper Docs Weaver — technical documentation specialist]\n\n",
  code_surgeon:  "[Vesper Code Surgeon — surgical refactoring & optimisation]\n\n",
};
