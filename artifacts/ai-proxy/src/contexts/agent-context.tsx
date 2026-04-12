import { createContext, useCallback, useContext, useState } from "react";

export type AgentType =
  | "builder"
  | "orchestrator"
  | "scholar"
  | "search_master"
  | "docs_weaver"
  | "code_surgeon";

const STORAGE_KEY = "vesper_agent_type";

function readStored(): AgentType {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as AgentType | null;
    if (v && VALID_AGENT_TYPES.includes(v)) return v;
  } catch {}
  return "builder";
}

export const VALID_AGENT_TYPES: AgentType[] = [
  "builder",
  "orchestrator",
  "scholar",
  "search_master",
  "docs_weaver",
  "code_surgeon",
];

export interface AgentOption {
  id: AgentType;
  name: string;
  shortName: string;
  /** One-line role hint shown inside the trigger button (e.g. "8 specialist roles") */
  roleHint: string;
  description: string;
  capabilities: string[];
  /** Tailwind classes for text + border + bg */
  color: string;
  /** Tailwind class for the solid dot */
  dotColor: string;
}

export const AGENT_OPTIONS: AgentOption[] = [
  {
    id: "builder",
    name: "Builder",
    shortName: "Builder",
    roleHint: "Full-stack autonomous",
    description: "Plans, codes, tests and ships complete projects autonomously",
    capabilities: ["Code generation", "Testing", "Debugging", "Deployment"],
    color: "text-primary border-primary/30 bg-primary/10",
    dotColor: "bg-primary",
  },
  {
    id: "orchestrator",
    name: "Orchestrator",
    shortName: "Orchestrator",
    roleHint: "8 specialist roles",
    description: "8 specialist roles combined — the most powerful all-in-one agent",
    capabilities: ["Multi-role", "Architecture", "Code review", "Research"],
    color: "text-violet-400 border-violet-500/30 bg-violet-500/10",
    dotColor: "bg-violet-400",
  },
  {
    id: "scholar",
    name: "Research Scholar",
    shortName: "Scholar",
    roleHint: "Academic research",
    description: "Academic and technical research with publication-quality output",
    capabilities: ["Papers", "Literature review", "Citations", "DOCX / PDF"],
    color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
    dotColor: "bg-emerald-400",
  },
  {
    id: "search_master",
    name: "Search Master",
    shortName: "Search",
    roleHint: "Deep web research",
    description: "Deep web research and multi-source information synthesis",
    capabilities: ["Web search", "Verification", "Source links", "Reports"],
    color: "text-sky-400 border-sky-500/30 bg-sky-500/10",
    dotColor: "bg-sky-400",
  },
  {
    id: "docs_weaver",
    name: "Docs Weaver",
    shortName: "Docs",
    roleHint: "Technical writing",
    description: "Creates beautiful, structured technical documentation",
    capabilities: ["README", "API docs", "Tutorials", "Mermaid diagrams"],
    color: "text-amber-400 border-amber-500/30 bg-amber-500/10",
    dotColor: "bg-amber-400",
  },
  {
    id: "code_surgeon",
    name: "Code Surgeon",
    shortName: "Surgeon",
    roleHint: "Refactor & optimize",
    description: "Surgical refactoring, optimization and code quality improvements",
    capabilities: ["Refactoring", "Performance", "Type safety", "Code review"],
    color: "text-rose-400 border-rose-500/30 bg-rose-500/10",
    dotColor: "bg-rose-400",
  },
];

interface AgentContextValue {
  agentType: AgentType;
  setAgentType: (type: AgentType) => void;
  currentAgent: AgentOption;
}

const AgentContext = createContext<AgentContextValue>({
  agentType: "builder",
  setAgentType: () => {},
  currentAgent: AGENT_OPTIONS[0],
});

export function AgentProvider({ children }: { children: React.ReactNode }) {
  const [agentType, setAgentTypeState] = useState<AgentType>(readStored);

  const setAgentType = useCallback((type: AgentType) => {
    setAgentTypeState(type);
    try { localStorage.setItem(STORAGE_KEY, type); } catch {}
  }, []);

  const currentAgent = AGENT_OPTIONS.find(a => a.id === agentType) ?? AGENT_OPTIONS[0];

  return (
    <AgentContext.Provider value={{ agentType, setAgentType, currentAgent }}>
      {children}
    </AgentContext.Provider>
  );
}

export function useAgentMode() {
  return useContext(AgentContext);
}
