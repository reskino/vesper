import { Files, MessageSquare, Bot, Key, History, HelpCircle } from "lucide-react";
import { useIDE, type SidebarPanel } from "@/contexts/ide-context";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const PANELS: { id: Exclude<SidebarPanel, null>; icon: React.ElementType; label: string }[] = [
  { id: "files",    icon: Files,        label: "Explorer" },
  { id: "agent",    icon: Bot,          label: "Agent" },
  { id: "sessions", icon: Key,          label: "Sessions" },
  { id: "history",  icon: History,      label: "History" },
  { id: "help",     icon: HelpCircle,   label: "Help" },
];

export function ActivityBar() {
  const { sidebarPanel, toggleSidebarPanel } = useIDE();

  return (
    <aside className="hidden sm:flex shrink-0 w-12 flex-col items-center bg-[#0a0a0c] border-r border-[#1a1a24] py-2 gap-1 z-10">
      {PANELS.map(({ id, icon: Icon, label }) => {
        const active = sidebarPanel === id;
        return (
          <Tooltip key={id} delayDuration={400}>
            <TooltipTrigger asChild>
              <button
                onClick={() => toggleSidebarPanel(id)}
                className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all group
                  ${active
                    ? "text-foreground bg-[#1e1e2e]"
                    : "text-[#52526e] hover:text-[#a0a0c0] hover:bg-[#141420]"
                  }`}
                aria-label={label}
              >
                {active && (
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-primary rounded-r-full" />
                )}
                <Icon className="h-4.5 w-4.5" style={{ width: 18, height: 18 }} />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" className="text-xs font-semibold">
              {label}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </aside>
  );
}
