import { Files, Bot, Key, History, HelpCircle, Settings, Users, Network, Keyboard } from "lucide-react";
import { useIDE, type SidebarPanel } from "@/contexts/ide-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";

const PANELS: { id: Exclude<SidebarPanel, null>; icon: React.ElementType; label: string }[] = [
  { id: "files",    icon: Files,      label: "Explorer" },
  { id: "agent",    icon: Bot,        label: "Agent" },
  { id: "agents",   icon: Users,      label: "Swarm" },
  { id: "graph",    icon: Network,    label: "Code Graph" },
  { id: "sessions", icon: Key,        label: "Sessions" },
  { id: "history",  icon: History,    label: "History" },
  { id: "help",     icon: HelpCircle, label: "Help" },
];

export function ActivityBar() {
  const { sidebarPanel, toggleSidebarPanel, openShortcutsModal } = useIDE();

  return (
    <aside className="hidden sm:flex shrink-0 w-11 flex-col items-center bg-[#080809] border-r border-[#131318] py-2 z-10">

      {/* ── Main panel icons ──────────────────────────────────────────── */}
      <div className="flex flex-col items-center gap-0.5 flex-1">
        {PANELS.map(({ id, icon: Icon, label }) => {
          const active = sidebarPanel === id;
          return (
            <Tooltip key={id} delayDuration={400}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => toggleSidebarPanel(id)}
                  className={`relative w-8 h-8 flex items-center justify-center rounded-lg transition-all duration-150
                    ${active
                      ? "text-foreground bg-[#1a1a28]"
                      : "text-[#7878a8] hover:text-[#a0a0c0] hover:bg-[#111118]"
                    }`}
                  aria-label={label}
                >
                  {/* Left active pill */}
                  {active && (
                    <span className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-5 bg-primary rounded-r-full" />
                  )}
                  <Icon className="shrink-0" style={{ width: 16, height: 16 }} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs font-semibold">
                {label}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      {/* ── Bottom separator + shortcuts + settings ───────────────────── */}
      <div className="flex flex-col items-center gap-0.5 pb-1">
        <div className="w-5 h-px bg-[#1a1a24] mb-1" />

        {/* Keyboard shortcuts reference */}
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              onClick={openShortcutsModal}
              className="w-8 h-8 flex items-center justify-center rounded-lg
                text-[#7878a8] hover:text-amber-400 hover:bg-[#111118] transition-all duration-150"
              aria-label="Keyboard shortcuts (?)"
            >
              <Keyboard style={{ width: 15, height: 15 }} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs font-semibold">
            Keyboard shortcuts <span className="ml-1 opacity-60">?</span>
          </TooltipContent>
        </Tooltip>

        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Link href="/sessions">
              <button
                className="w-8 h-8 flex items-center justify-center rounded-lg
                  text-[#7878a8] hover:text-[#a0a0c0] hover:bg-[#111118] transition-all duration-150"
                aria-label="Settings"
              >
                <Settings style={{ width: 15, height: 15 }} />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="right" className="text-xs font-semibold">Settings</TooltipContent>
        </Tooltip>
      </div>

    </aside>
  );
}
