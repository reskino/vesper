/**
 * IDELayout — root shell that wraps the entire app.
 *
 * Desktop (≥ md / 768 px):
 *   ActivityBar | optional sidebar | ResizablePanels(editor + chat) | terminal
 *
 * Mobile (< 768 px):
 *   Full-screen single-panel routed by mobileTab + bottom nav bar.
 *   When mobileTab === "editor" a floating chat FAB appears; tapping it
 *   slides up a bottom-sheet overlay with ChatPanel.
 */
import { useEffect } from "react";
import { useIDE, type MobileTab } from "@/contexts/ide-context";
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
import {
  MessageSquare, Code2, FolderOpen, History as HistoryIcon,
  MessageSquarePlus, X,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────────────────────
// Mobile chat bottom-sheet overlay
// ─────────────────────────────────────────────────────────────────────────────
function MobileChatSheet() {
  const { showMobileChatSheet, setShowMobileChatSheet, newChatKey } = useIDE();

  // Lock body scroll while sheet is open
  useEffect(() => {
    document.body.style.overflow = showMobileChatSheet ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showMobileChatSheet]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          showMobileChatSheet ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setShowMobileChatSheet(false)}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Chat"
        aria-modal="true"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl overflow-hidden
          bg-[#0a0a0c] border-t border-[#1a1a24] shadow-[0_-8px_40px_rgba(0,0,0,0.6)]
          transition-transform duration-300 ease-out
          ${showMobileChatSheet ? "translate-y-0" : "translate-y-full"}`}
        style={{ height: "78dvh", paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        {/* Drag handle + header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1a1a24]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-1 rounded-full bg-[#2a2a40] absolute left-1/2 -translate-x-1/2 top-2" />
            <MessageSquare className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm text-foreground">Chat</span>
          </div>
          <button
            onClick={() => setShowMobileChatSheet(false)}
            className="h-8 w-8 flex items-center justify-center rounded-full bg-[#1a1a24] text-[#52526e] hover:text-foreground transition-colors"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 min-h-0">
          <ChatPanel newChatKey={newChatKey} compact />
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile bottom navigation
// ─────────────────────────────────────────────────────────────────────────────
const MOBILE_TABS: { id: MobileTab; label: string; icon: React.ElementType }[] = [
  { id: "chat",    label: "Chat",    icon: MessageSquare },
  { id: "editor",  label: "Editor",  icon: Code2 },
  { id: "files",   label: "Files",   icon: FolderOpen },
  { id: "history", label: "History", icon: HistoryIcon },
];

function MobileNav() {
  const { mobileTab, setMobileTab, setShowMobileChatSheet } = useIDE();

  const handleTab = (id: MobileTab) => {
    setMobileTab(id);
    // Close chat sheet if we navigate away from editor
    if (id !== "editor") setShowMobileChatSheet(false);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-[#0a0a0c]/96 backdrop-blur-xl
        border-t border-[#1a1a24] grid grid-cols-4 shadow-[0_-4px_32px_rgba(0,0,0,0.5)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main navigation"
    >
      {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
        const active = mobileTab === id;
        return (
          <button
            key={id}
            onClick={() => handleTab(id)}
            className={`flex flex-col items-center justify-center gap-1 min-h-[52px] py-2 transition-all
              ${active ? "text-primary" : "text-[#52526e] hover:text-[#a0a0c0]"}`}
            aria-label={label}
            aria-current={active ? "page" : undefined}
          >
            <div className={`relative flex items-center justify-center w-10 h-6 rounded-full transition-colors
              ${active ? "bg-primary/15" : ""}`}>
              <Icon className={`h-5 w-5 transition-all ${active ? "scale-110" : ""}`} />
              {active && (
                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-primary" />
              )}
            </div>
            <span className={`text-[10px] font-bold tracking-wide transition-colors
              ${active ? "text-primary" : "text-[#52526e]"}`}>
              {label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating chat button (visible when mobileTab === "editor")
// ─────────────────────────────────────────────────────────────────────────────
function FloatingChatFAB() {
  const { mobileTab, setShowMobileChatSheet, showMobileChatSheet } = useIDE();
  if (mobileTab !== "editor") return null;

  return (
    <button
      onClick={() => setShowMobileChatSheet(true)}
      className={`md:hidden fixed bottom-[72px] right-4 z-30 h-12 w-12 rounded-full bg-primary text-primary-foreground
        shadow-[0_4px_20px_rgba(99,102,241,0.5)] flex items-center justify-center
        transition-all duration-200 active:scale-95
        ${showMobileChatSheet ? "opacity-0 pointer-events-none" : "opacity-100"}`}
      aria-label="Open chat"
      style={{ marginBottom: "env(safe-area-inset-bottom, 0px)" }}
    >
      <MessageSquarePlus className="h-5 w-5" />
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop secondary sidebar content
// ─────────────────────────────────────────────────────────────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
// Desktop: IDE workspace (editor + chat split + terminal)
// ─────────────────────────────────────────────────────────────────────────────
function DesktopWorkspace() {
  const { showChat, showTerminal, newChatKey } = useIDE();

  return (
    <ResizablePanelGroup direction="vertical" className="flex-1 min-w-0 h-full">
      <ResizablePanel defaultSize={showTerminal ? 70 : 100} minSize={30}>
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={showChat ? 55 : 100} minSize={30}>
            <EditorPanel />
          </ResizablePanel>

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

// ─────────────────────────────────────────────────────────────────────────────
// Mobile: single-panel view based on active tab
// ─────────────────────────────────────────────────────────────────────────────
function MobileWorkspace() {
  const { mobileTab, newChatKey } = useIDE();

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      {mobileTab === "chat"    && <ChatPanel newChatKey={newChatKey} />}
      {mobileTab === "editor"  && <EditorPanel />}
      {mobileTab === "files"   && <FileExplorer activePath={null} />}
      {mobileTab === "history" && <div className="h-full overflow-y-auto bg-[#0a0a0c]"><History /></div>}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────────────────────────────────────
export function IDELayout({ children }: { children?: React.ReactNode }) {
  const { sidebarPanel, toggleTerminal, toggleChat, triggerNewChat } = useIDE();

  // Global keyboard shortcuts (desktop only)
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

      {/* ── Desktop layout ────────────────────────────────────────────────── */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
        <ActivityBar />
        {sidebarPanel && (
          <aside className="shrink-0 w-64 flex flex-col border-r border-[#1a1a24] overflow-hidden bg-[#0a0a0c]">
            <SidebarContent activeFilePath={null} />
          </aside>
        )}
        <div className="flex flex-1 min-w-0 min-h-0 overflow-hidden">
          {children ? children : <DesktopWorkspace />}
        </div>
      </div>

      {/* ── Mobile layout ─────────────────────────────────────────────────── */}
      <div className="flex md:hidden flex-1 min-h-0 overflow-hidden">
        <MobileWorkspace />
      </div>

      {/* Mobile overlays (always rendered, visibility via CSS) */}
      <FloatingChatFAB />
      <MobileChatSheet />
      <MobileNav />

      {/* Safe-area spacer for mobile nav */}
      <div
        className="md:hidden shrink-0"
        style={{ height: "calc(52px + env(safe-area-inset-bottom, 0px))" }}
      />
    </div>
  );
}
