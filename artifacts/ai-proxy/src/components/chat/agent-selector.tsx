/**
 * AgentSelector — prominent chat-header dropdown for switching agent modes.
 *
 * Features
 * ─────────
 * • Full keyboard navigation: ↑↓ arrows, Enter/Space, Escape, Home, End
 * • ARIA-compliant: role="combobox" + role="listbox" + aria-activedescendant
 * • Focus management: auto-focuses active item on open; returns to trigger on close
 * • Status dot: pulses when AI is responding, steady when idle
 * • Larger tap target (h-7 trigger) — comfortable on mobile / low-end devices
 * • localStorage persistence via AgentContext (no Zustand needed)
 */

import { useEffect, useId, useRef, useState } from "react";
import {
  BookOpen, ChevronDown, FileText, Globe, Scissors, Sparkles, Zap,
} from "lucide-react";
import { AGENT_OPTIONS, AgentType, useAgentMode } from "@/contexts/agent-context";

// ── Icon map ──────────────────────────────────────────────────────────────────
const AGENT_ICONS: Record<AgentType, React.ElementType> = {
  builder:      Zap,
  orchestrator: Sparkles,
  scholar:      BookOpen,
  search_master: Globe,
  docs_weaver:  FileText,
  code_surgeon: Scissors,
};

interface AgentSelectorProps {
  /** Pass chat-panel's isPending so the status dot pulses during inference */
  isPending?: boolean;
  /**
   * Set to true when Autonomous Agent Mode is enabled so the trigger
   * shows "Active" even when no single inference is in flight.
   */
  isAutonomousActive?: boolean;
}

export function AgentSelector({ isPending = false, isAutonomousActive = false }: AgentSelectorProps) {
  const { agentType, setAgentType, currentAgent } = useAgentMode();
  const [open, setOpen] = useState(false);

  // Refs for focus management
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wrapperRef  = useRef<HTMLDivElement>(null);
  const itemRefs    = useRef<(HTMLButtonElement | null)[]>([]);

  // Stable IDs for ARIA
  const listboxId     = useId();
  const optionIdBase  = useId();
  const getOptionId   = (idx: number) => `${optionIdBase}-opt-${idx}`;

  // Track keyboard-focused row inside the dropdown
  const [activeIndex, setActiveIndex] = useState(-1);

  // ── Open/close side-effects ─────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      // Focus the currently-selected item when the list opens
      const idx = AGENT_OPTIONS.findIndex(a => a.id === agentType);
      const target = idx >= 0 ? idx : 0;
      setActiveIndex(target);
      // rAF gives the DOM time to render the list before we focus
      requestAnimationFrame(() => itemRefs.current[target]?.focus());
    } else {
      setActiveIndex(-1);
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  // Click-outside closes
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ── Keyboard handlers ───────────────────────────────────────────────────────
  function handleTriggerKeyDown(e: React.KeyboardEvent<HTMLButtonElement>) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen(true);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  function handleItemKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, idx: number) {
    const last = AGENT_OPTIONS.length - 1;
    switch (e.key) {
      case "ArrowDown": {
        e.preventDefault();
        const next = (idx + 1) % AGENT_OPTIONS.length;
        setActiveIndex(next);
        itemRefs.current[next]?.focus();
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const prev = (idx - 1 + AGENT_OPTIONS.length) % AGENT_OPTIONS.length;
        setActiveIndex(prev);
        itemRefs.current[prev]?.focus();
        break;
      }
      case "Home": {
        e.preventDefault();
        setActiveIndex(0);
        itemRefs.current[0]?.focus();
        break;
      }
      case "End": {
        e.preventDefault();
        setActiveIndex(last);
        itemRefs.current[last]?.focus();
        break;
      }
      case "Enter":
      case " ": {
        e.preventDefault();
        setAgentType(AGENT_OPTIONS[idx].id);
        setOpen(false);
        triggerRef.current?.focus();
        break;
      }
      case "Escape":
      case "Tab": {
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
        break;
      }
    }
  }

  // ── Derived values ──────────────────────────────────────────────────────────
  const CurrentIcon   = AGENT_ICONS[agentType];
  const activeOptId   = activeIndex >= 0 ? getOptionId(activeIndex) : undefined;
  // isActive = running an inference OR autonomous session is live
  const isActive = isPending || isAutonomousActive;
  // Dot: amber + pulse when actively inferring, violet pulse when autonomous-only, subtle otherwise
  const dotClass = isPending
    ? "bg-amber-400 animate-pulse"
    : isAutonomousActive
      ? "bg-violet-400 animate-pulse"
      : `${currentAgent.dotColor} opacity-80`;

  return (
    <div ref={wrapperRef} className="relative">

      {/* ── Trigger button ─────────────────────────────────────────────────── */}
      <button
        ref={triggerRef}
        id={`${listboxId}-trigger`}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-activedescendant={open ? activeOptId : undefined}
        onClick={() => setOpen(o => !o)}
        onKeyDown={handleTriggerKeyDown}
        className={`
          flex items-center gap-1.5 h-7 px-2.5 rounded-lg border
          text-[11px] font-semibold transition-all duration-150 select-none
          focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60
          ${currentAgent.color}
          hover:brightness-110 active:scale-[0.97]
        `}
        title={`Agent: ${currentAgent.name} — ${currentAgent.roleHint}`}
      >
        {/* Status dot */}
        <span
          aria-hidden="true"
          className={`h-1.5 w-1.5 rounded-full shrink-0 transition-colors duration-300 ${dotClass}`}
        />

        {/* Icon */}
        <CurrentIcon className="h-3 w-3 shrink-0" aria-hidden="true" />

        {/* Name + role hint */}
        <span className="flex items-center gap-1">
          <span>{currentAgent.shortName}</span>
          <span className="hidden sm:inline opacity-50 text-[10px] font-normal">
            · {currentAgent.roleHint}
          </span>
        </span>

        {/* Status label — "Active" when inferring or autonomous is on */}
        <span className={`
          hidden lg:inline text-[9px] font-bold uppercase tracking-wide
          ml-0.5 px-1 py-0.5 rounded border transition-all duration-300
          ${isPending
            ? "text-amber-400 border-amber-500/30 bg-amber-500/10"
            : isAutonomousActive
              ? "text-violet-400 border-violet-500/30 bg-violet-500/10"
              : "opacity-40 border-current/20"}
        `}>
          {isActive ? "Active" : "Idle"}
        </span>

        <ChevronDown
          className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
          aria-hidden="true"
        />
      </button>

      {/* ── Dropdown listbox ───────────────────────────────────────────────── */}
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Select agent mode"
          aria-labelledby={`${listboxId}-trigger`}
          className="
            absolute top-full left-0 mt-1.5 z-50
            w-[300px] rounded-xl border border-[#1a1a24]
            bg-[#0b0b0e] shadow-2xl shadow-black/70 overflow-hidden
            animate-in fade-in slide-in-from-top-1 duration-150
          "
        >
          {/* Header */}
          <div className="px-3 pt-3 pb-1.5 flex items-center justify-between">
            <p className="text-[9px] text-[#7878a8] uppercase tracking-widest font-bold">
              Agent Mode
            </p>
            <p className="text-[9px] text-[#555568]">
              ↑↓ navigate · Enter select · Esc close
            </p>
          </div>

          {/* Agent options */}
          <div className="px-1.5 pb-2 space-y-0.5 max-h-[380px] overflow-y-auto">
            {AGENT_OPTIONS.map((agent, idx) => {
              const Icon     = AGENT_ICONS[agent.id];
              const isActive = agentType === agent.id;
              return (
                <button
                  key={agent.id}
                  ref={el => { itemRefs.current[idx] = el; }}
                  id={getOptionId(idx)}
                  role="option"
                  aria-selected={isActive}
                  tabIndex={-1}
                  onClick={() => {
                    setAgentType(agent.id);
                    setOpen(false);
                    triggerRef.current?.focus();
                  }}
                  onKeyDown={e => handleItemKeyDown(e, idx)}
                  className={`
                    w-full text-left px-2.5 py-2.5 rounded-lg
                    transition-all duration-100 group outline-none
                    focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-current/40
                    ${isActive
                      ? `${agent.color} ring-1 ring-inset ring-current/15`
                      : "hover:bg-[#111118] focus-visible:bg-[#111118] text-[#9898b8]"
                    }
                  `}
                >
                  <div className="flex items-start gap-2.5">
                    {/* Icon container */}
                    <div className={`
                      mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg border
                      ${isActive
                        ? agent.color
                        : "border-[#1e1e28] bg-[#0a0a0d] text-[#6868a0] group-hover:text-[#9898b8]"
                      }
                    `}>
                      <Icon className="h-3 w-3" aria-hidden="true" />
                    </div>

                    {/* Text content */}
                    <div className="flex-1 min-w-0">
                      {/* Name row */}
                      <div className="flex items-center gap-2">
                        <span className={`text-[11px] font-semibold leading-none ${isActive ? "" : "text-foreground/85"}`}>
                          {agent.name}
                        </span>
                        {/* Role hint chip */}
                        <span className={`
                          text-[8px] font-bold uppercase tracking-wide
                          px-1 py-0.5 rounded border leading-none
                          ${isActive
                            ? "opacity-70 border-current/20"
                            : "opacity-40 border-[#2a2a38]"
                          }
                        `}>
                          {agent.roleHint}
                        </span>
                        {isActive && (
                          <span className="ml-auto text-[8px] font-bold uppercase tracking-wide opacity-50">
                            active
                          </span>
                        )}
                      </div>

                      {/* Description */}
                      <p className="text-[10px] opacity-60 mt-1 leading-snug line-clamp-2">
                        {agent.description}
                      </p>

                      {/* Capability tags */}
                      <div className="flex flex-wrap gap-1 mt-1.5">
                        {agent.capabilities.map(cap => (
                          <span
                            key={cap}
                            className="text-[9px] bg-white/[0.04] border border-white/[0.07]
                              rounded px-1.5 py-0.5 opacity-70 leading-none"
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

          {/* Footer hint */}
          <div className="px-3 py-2 border-t border-[#111118]">
            <p className="text-[9px] text-[#555568] leading-relaxed">
              Agent persists across sessions · Intent detection auto-routes when typing
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
