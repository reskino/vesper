import { useEffect, useRef, useState } from "react";
import {
  BookOpen, ChevronDown, FileText, Globe, Scissors, Sparkles, Zap,
} from "lucide-react";
import { AGENT_OPTIONS, AgentType, useAgentMode } from "@/contexts/agent-context";

const AGENT_ICONS: Record<AgentType, typeof Zap> = {
  builder:      Zap,
  orchestrator: Sparkles,
  scholar:      BookOpen,
  search_master: Globe,
  docs_weaver:  FileText,
  code_surgeon: Scissors,
};

export function AgentSelector() {
  const { agentType, setAgentType, currentAgent } = useAgentMode();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const CurrentIcon = AGENT_ICONS[agentType];

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-1 h-5 px-1.5 rounded text-[10px] font-semibold border transition-all duration-150
          ${currentAgent.color} hover:opacity-90`}
        title={`Agent: ${currentAgent.name} — click to switch`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <CurrentIcon className="h-2.5 w-2.5 shrink-0" />
        <span>{currentAgent.shortName}</span>
        <ChevronDown className={`h-2 w-2 shrink-0 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1.5 z-50 w-[280px] rounded-xl border border-[#1a1a24]
            bg-[#0c0c10] shadow-2xl shadow-black/60 overflow-hidden"
          role="listbox"
          aria-label="Select agent type"
        >
          <div className="px-3 pt-3 pb-1.5">
            <p className="text-[9px] text-[#7878a8] uppercase tracking-widest font-bold">Agent Mode</p>
          </div>

          <div className="px-1.5 pb-2 space-y-0.5 max-h-[340px] overflow-y-auto">
            {AGENT_OPTIONS.map(agent => {
              const Icon = AGENT_ICONS[agent.id];
              const isActive = agentType === agent.id;
              return (
                <button
                  key={agent.id}
                  role="option"
                  aria-selected={isActive}
                  onClick={() => { setAgentType(agent.id); setOpen(false); }}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-all duration-100 group
                    ${isActive
                      ? `${agent.color} ring-1 ring-inset ring-current/20`
                      : "hover:bg-[#111118] text-[#9898b8]"
                    }`}
                >
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border
                      ${isActive ? agent.color : "border-[#1a1a24] bg-[#0a0a0d] text-[#7878a8] group-hover:text-[#9898b8]"}`}
                    >
                      <Icon className="h-2.5 w-2.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className={`text-[11px] font-semibold ${isActive ? "" : "text-foreground/80"}`}>
                          {agent.name}
                        </span>
                        {isActive && (
                          <span className="text-[8px] font-bold uppercase tracking-wide opacity-60">active</span>
                        )}
                      </div>
                      <p className="text-[10px] opacity-70 mt-0.5 leading-snug line-clamp-2">
                        {agent.description}
                      </p>
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {agent.capabilities.map(cap => (
                          <span
                            key={cap}
                            className="text-[9px] bg-white/5 border border-white/8 rounded px-1 py-0.5 opacity-70"
                          >
                            {cap}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
