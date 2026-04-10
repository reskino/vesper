import { useEffect } from "react";
import { useIDE } from "@/contexts/ide-context";
import { ActivityBar } from "./activity-bar";
import { TopBar } from "./top-bar";
import { FileExplorer } from "@/components/ide/file-explorer";
import { EditorPanel } from "@/components/ide/editor-panel";
import { ChatPanel } from "@/components/ide/chat-panel";
import { TerminalPanel } from "@/components/ide/terminal-panel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Sessions } from "@/pages/sessions";
import { History } from "@/pages/history";
import AgentPage from "@/pages/agent";
import HelpPage from "@/pages/help";
import { Files, Bot, TerminalSquare, MessageSquare } from "lucide-react";

// ── Mobile bottom nav ─────────────────────────────────────────────────────────
function MobileNav() {
  const { showChat, setShowChat, showTerminal, setShowTerminal, sidebarPanel, setSidebarPanel } = useIDE();

  const TABS = [
    { label: "Chat",     icon: MessageSquare, action: () => { setShowChat(true); setSidebarPanel(null); } },
    { label: "Files",    icon: Files,          action: () => { setSidebarPanel(sidebarPanel === "files" ? null : "files"); setShowChat(false); } },
    { label: "Agent",    icon: Bot,            action: () => { setSidebarPanel(sidebarPanel === "agent" ? null : "agent"); setShowChat(false); } },
    { label: "Terminal", icon: TerminalSquare, action: () => { setShowTerminal(!showTerminal); } },
  ];

  return (
    <nav
      className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-[#0a0a0c]/98 backdrop-blur-xl border-t border-[#1a1a24] grid grid-cols-4 shadow-[0_-4px_24px_rgba(0,0,0,0.4)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      {TABS.map(({ label, icon: Icon, action }) => (
        <button
          key={label}
          onClick={action}
          className="flex flex-col items-center justify-center gap-1 py-2.5 text-[#52526e] hover:text-foreground transition-colors"
        >
          <Icon className="h-5 w-5" />
          <span className="text-[9px] font-bold tracking-wide">{label}</span>
        </button>
      ))}
    </nav>
  );
}

// ── Secondary sidebar content ─────────────────────────────────────────────────
function SidebarContent({ activeFilePath }: { activeFilePath: string | null }) {
  const { sidebarPanel } = useIDE();
  switch (sidebarPanel) {
    case "files":    return <FileExplorer activePath={activeFilePath} />;
    case "agent":    return <div className="h-full overflow-y-auto bg-[#0a0a0c]"><AgentPage /></div>;
    case "sessions": return <div className="h-full overflow-y-auto bg-[#0a0a0c]"><Sessions /></div>;
    case "history":  return <div className="h-full overflow-y-auto bg-[#0a0a0c]"><History /></div>;
    case "help":     return <div className="h-full overflow-y-auto bg-[#0a0a0c]"><HelpPage /></div>;
    default:         return null;
  }
}

// ── IDE workspace (editor + chat + terminal) ───────────────────────────────────
function IDEWorkspace() {
  const { showChat, showTerminal, newChatKey } = useIDE();

  return (
    <ResizablePanelGroup direction="vertical" className="flex-1 min-w-0 h-full">
      {/* Main area: editor + chat */}
      <ResizablePanel defaultSize={showTerminal ? 70 : 100} minSize={30}>
        <ResizablePanelGroup direction="horizontal" className="h-full">
          {/* Editor */}
          <ResizablePanel defaultSize={showChat ? 55 : 100} minSize={30}>
            <EditorPanel />
          </ResizablePanel>

          {/* Chat panel */}
          {showChat && (
            <>
              <ResizableHandle className="w-px bg-[#1a1a24] hover:bg-primary/40 transition-colors cursor-col-resize" />
              <ResizablePanel defaultSize={45} minSize={25} maxSize={65}>
                <ChatPanel newChatKey={newChatKey} />
              </ResizablePanel>
            </>
          )}
        </ResizablePanelGroup>
      </ResizablePanel>

      {/* Terminal panel */}
      {showTerminal && (
        <>
          <ResizableHandle className="h-px bg-[#1a1a24] hover:bg-primary/40 transition-colors cursor-row-resize" />
          <ResizablePanel defaultSize={30} minSize={15} maxSize={60}>
            <TerminalPanel />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

// ── Main IDE layout ────────────────────────────────────────────────────────────
export function IDELayout({ children }: { children?: React.ReactNode }) {
  const { sidebarPanel, toggleTerminal, toggleChat, triggerNewChat } = useIDE();

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "`") { e.preventDefault(); toggleTerminal(); }
      if (ctrl && e.key === "j") { e.preventDefault(); toggleChat(); }
      if (ctrl && e.key === "n") { e.preventDefault(); triggerNewChat(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleTerminal, toggleChat, triggerNewChat]);

  return (
    <div className="flex flex-col h-dvh w-full bg-[#0d0d12] overflow-hidden font-sans">
      <TopBar />

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Activity bar — desktop only */}
        <ActivityBar />

        {/* Secondary sidebar — desktop only */}
        {sidebarPanel && (
          <aside className="hidden sm:flex shrink-0 w-64 flex-col border-r border-[#1a1a24] overflow-hidden bg-[#0a0a0c]">
            <SidebarContent activeFilePath={null} />
          </aside>
        )}

        {/* Main content area */}
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          {children ? children : <IDEWorkspace />}
        </div>
      </div>

      {/* Mobile nav */}
      <MobileNav />
      {/* Mobile spacer */}
      <div className="sm:hidden shrink-0" style={{ height: "calc(52px + env(safe-area-inset-bottom, 0px))" }} />
    </div>
  );
}
