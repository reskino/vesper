/**
 * IDELayout — root shell that wraps the entire app.
 *
 * Desktop (≥ md / 768 px):
 *   ActivityBar | optional sidebar | ResizablePanels(editor + chat) | terminal
 *
 * Mobile (< 768 px):
 *   TopBar → full-screen single panel driven by mobileTab → MobileNav (bottom)
 *   Editor tab shows a floating "Ask AI" FAB that slides up a bottom-sheet chat.
 */
import { useEffect, useCallback, type ElementType } from "react";
import { useIDE, type MobileTab, type MobileSettingsTab } from "@/contexts/ide-context";
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
import { VesperLogo } from "@/components/vesper-logo";
import {
  MessageSquare, Code2, FolderOpen, TerminalSquare,
  MessageSquarePlus, X, Sparkles, Bot,
  ShieldCheck, Clock, BookOpen,
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

  // Swipe-down to close (simple touch handler)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const startY = e.touches[0].clientY;
    const onMove = (ev: TouchEvent) => {
      if (ev.touches[0].clientY - startY > 80) {
        setShowMobileChatSheet(false);
        document.removeEventListener("touchmove", onMove);
      }
    };
    document.addEventListener("touchmove", onMove, { passive: true });
    const onEnd = () => document.removeEventListener("touchmove", onMove);
    document.addEventListener("touchend", onEnd, { once: true });
  }, [setShowMobileChatSheet]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/70 backdrop-blur-sm
          transition-opacity duration-300
          ${showMobileChatSheet ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setShowMobileChatSheet(false)}
        aria-hidden="true"
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-label="Ask AI"
        aria-modal="true"
        className={`md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col
          rounded-t-[28px] overflow-hidden
          bg-[#0a0a0c] border-t border-[#1e1e2e]
          shadow-[0_-24px_80px_rgba(0,0,0,0.85)]
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${showMobileChatSheet ? "translate-y-0" : "translate-y-full"}`}
        style={{
          height: "82dvh",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)",
        }}
      >
        {/* Drag handle */}
        <div
          className="shrink-0 flex flex-col items-center cursor-grab active:cursor-grabbing pt-3 pb-2"
          onTouchStart={handleTouchStart}
        >
          <div className="w-10 h-1 rounded-full bg-[#2a2a3c]" />
        </div>

        {/* Sheet header */}
        <div className="shrink-0 flex items-center justify-between px-4 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10
              border border-primary/20 flex items-center justify-center
              shadow-[0_0_12px_rgba(99,102,241,0.2)]">
              <VesperLogo size={14} />
            </div>
            <div>
              <p className="font-bold text-[13px] text-foreground leading-none">Ask AI</p>
              <p className="text-[10px] text-[#52526e] mt-0.5">Multi-model · Context-aware</p>
            </div>
          </div>
          <button
            onClick={() => setShowMobileChatSheet(false)}
            className="h-9 w-9 flex items-center justify-center rounded-full
              bg-[#141420] border border-[#1e1e2e] text-[#52526e]
              active:scale-95 transition-all"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Thin separator */}
        <div className="h-px bg-[#141420] shrink-0 mx-4 mb-1" />

        {/* Chat content */}
        <div className="flex-1 min-h-0">
          <ChatPanel newChatKey={newChatKey} compact />
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile settings sheet — Sessions | History | Help accessible on mobile
// ─────────────────────────────────────────────────────────────────────────────

const SETTINGS_TABS: { id: MobileSettingsTab; label: string; icon: ElementType }[] = [
  { id: "sessions", label: "Providers", icon: ShieldCheck },
  { id: "history",  label: "History",   icon: Clock       },
  { id: "help",     label: "Help",      icon: BookOpen    },
];

function MobileSettingsSheet() {
  const { showMobileSettings, setShowMobileSettings, mobileSettingsTab, setMobileSettingsTab } = useIDE();

  useEffect(() => {
    document.body.style.overflow = showMobileSettings ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showMobileSettings]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm
          transition-opacity duration-300
          ${showMobileSettings ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        onClick={() => setShowMobileSettings(false)}
        aria-hidden="true"
      />

      {/* Full-height sheet */}
      <div
        role="dialog"
        aria-label="Settings"
        aria-modal="true"
        className={`md:hidden fixed inset-x-0 bottom-0 z-50 flex flex-col
          bg-[#0a0a0c] border-t border-[#1e1e2e]
          shadow-[0_-24px_80px_rgba(0,0,0,0.9)]
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          ${showMobileSettings ? "translate-y-0" : "translate-y-full"}`}
        style={{
          height: "92dvh",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 64px)",
        }}
      >
        {/* Sheet header */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b border-[#131318]">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10
              border border-primary/20 flex items-center justify-center">
              <VesperLogo size={14} />
            </div>
            <div>
              <p className="font-bold text-[13px] text-foreground leading-none">Vesper Settings</p>
              <p className="text-[10px] text-[#52526e] mt-0.5">Providers · History · Help</p>
            </div>
          </div>
          <button
            onClick={() => setShowMobileSettings(false)}
            className="h-9 w-9 flex items-center justify-center rounded-full
              bg-[#141420] border border-[#1e1e2e] text-[#52526e]
              active:scale-95 transition-all"
            aria-label="Close settings"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab pills */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-[#131318]">
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
            const active = mobileSettingsTab === id;
            return (
              <button
                key={id}
                onClick={() => setMobileSettingsTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all
                  ${active
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "text-[#52526e] hover:text-foreground hover:bg-[#141420] border border-transparent"
                  }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" />
                {label}
              </button>
            );
          })}
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mobileSettingsTab === "sessions" && <Sessions />}
          {mobileSettingsTab === "history"  && <History />}
          {mobileSettingsTab === "help"     && <HelpPage />}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile bottom navigation
// ─────────────────────────────────────────────────────────────────────────────
const MOBILE_TABS: { id: MobileTab; label: string; icon: ElementType }[] = [
  { id: "chat",     label: "Chat",     icon: MessageSquare  },
  { id: "editor",   label: "Editor",   icon: Code2          },
  { id: "agent",    label: "Agent",    icon: Bot            },
  { id: "files",    label: "Explorer", icon: FolderOpen     },
  { id: "terminal", label: "Terminal", icon: TerminalSquare },
];

function MobileNav() {
  const { mobileTab, setMobileTab, setShowMobileChatSheet } = useIDE();

  const handleTab = (id: MobileTab) => {
    setMobileTab(id);
    if (id !== "editor") setShowMobileChatSheet(false);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30
        bg-[#080809]/98 backdrop-blur-2xl border-t border-[#131318]
        shadow-[0_-8px_40px_rgba(0,0,0,0.7)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main navigation"
    >
      <div className="grid grid-cols-5 px-1">
        {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
          const active = mobileTab === id;
          return (
            <button
              key={id}
              onClick={() => handleTab(id)}
              className="relative flex flex-col items-center justify-center gap-1 py-2 min-h-[56px]
                active:opacity-70 transition-opacity"
              aria-label={label}
              aria-current={active ? "page" : undefined}
            >
              {/* Top pill indicator */}
              {active && (
                <span className="absolute top-0 left-1/2 -translate-x-1/2
                  w-10 h-[2px] rounded-b-full bg-primary" />
              )}
              {/* Icon in pill */}
              <div className={`h-8 w-11 rounded-2xl flex items-center justify-center transition-all
                ${active ? "bg-primary/15" : ""}`}>
                <Icon className={`transition-all duration-150
                  ${active ? "h-5 w-5 text-primary" : "h-5 w-5 text-[#3a3a5c]"}`} />
              </div>
              <span className={`text-[10px] font-bold tracking-wide transition-colors
                ${active ? "text-primary" : "text-[#2a2a44]"}`}>
                {label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Floating "Ask AI" button — visible when Editor tab is active
// ─────────────────────────────────────────────────────────────────────────────
function FloatingChatFAB() {
  const { mobileTab, setShowMobileChatSheet, showMobileChatSheet } = useIDE();
  if (mobileTab !== "editor") return null;

  return (
    <button
      onClick={() => setShowMobileChatSheet(true)}
      className={`md:hidden fixed right-4 z-30 flex items-center gap-2 h-12 px-5
        rounded-2xl bg-primary text-primary-foreground
        font-bold text-[13px] tracking-wide
        shadow-[0_4px_24px_rgba(99,102,241,0.45),0_0_0_1px_rgba(99,102,241,0.3)]
        transition-all duration-200 active:scale-[0.96]
        ${showMobileChatSheet ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"}`}
      style={{ bottom: "calc(64px + env(safe-area-inset-bottom, 0px))" }}
      aria-label="Ask AI about this code"
    >
      <Sparkles className="h-4 w-4" />
      Ask AI
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
// Collapsed chat rail — thin vertical bar shown when chat is hidden (desktop)
// ─────────────────────────────────────────────────────────────────────────────
function CollapsedChatRail() {
  const { toggleChat } = useIDE();
  return (
    <button
      onClick={toggleChat}
      title="Open chat panel (Ctrl+J)"
      aria-label="Open chat"
      className="hidden md:flex w-8 shrink-0 flex-col items-center justify-center gap-3
        border-l border-[#131318] bg-[#080809] transition-colors
        hover:bg-[#0e0e14] group"
    >
      {/* Pulsing bubble icon */}
      <div className="relative">
        <MessageSquarePlus className="h-4 w-4 text-[#3a3a5c] group-hover:text-primary transition-colors" />
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary/60
          ring-2 ring-[#080809] animate-pulse group-hover:bg-primary" />
      </div>
      {/* Rotated label */}
      <span
        className="text-[9px] font-bold text-[#2a2a44] uppercase tracking-[0.15em]
          group-hover:text-[#52526e] transition-colors select-none"
        style={{ writingMode: "vertical-rl", textOrientation: "mixed" }}
      >
        Chat
      </span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Desktop: IDE workspace (editor + chat split + terminal)
// ─────────────────────────────────────────────────────────────────────────────
function DesktopWorkspace() {
  const { showChat, showTerminal, newChatKey } = useIDE();

  return (
    <ResizablePanelGroup direction="vertical" className="flex-1 min-w-0 h-full">
      <ResizablePanel defaultSize={showTerminal ? 70 : 100} minSize={30}>
        {/* Horizontal flex: resizable panels on the left, collapsed rail (if needed) on the right */}
        <div className="flex h-full min-w-0">
          <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0">
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

          {/* Collapsed rail appears when chat is hidden */}
          {!showChat && <CollapsedChatRail />}
        </div>
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
      {/* Each panel is always mounted once the tab is active, to preserve state */}
      <div className={`h-full ${mobileTab === "chat"     ? "" : "hidden"}`}>
        <ChatPanel newChatKey={newChatKey} />
      </div>
      <div className={`h-full ${mobileTab === "editor"   ? "" : "hidden"}`}>
        <EditorPanel />
      </div>
      <div className={`h-full ${mobileTab === "agent"    ? "" : "hidden"}`}>
        <div className="h-full overflow-y-auto bg-[#0a0a0c]"><AgentPage mobile /></div>
      </div>
      <div className={`h-full ${mobileTab === "files"    ? "" : "hidden"}`}>
        <FileExplorer activePath={null} />
      </div>
      <div className={`h-full ${mobileTab === "terminal" ? "" : "hidden"}`}>
        <TerminalPanel />
      </div>
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

      {/* ── Desktop layout ──────────────────────────────────────────────────── */}
      <div className="hidden md:flex flex-1 min-h-0 overflow-hidden">
        <ActivityBar />
        <ResizablePanelGroup direction="horizontal" className="flex-1 min-h-0 min-w-0">
          {sidebarPanel && (
            <>
              <ResizablePanel
                defaultSize={sidebarPanel === "agent" ? 20 : 18}
                minSize={12}
                maxSize={40}
                className="min-w-0"
              >
                <aside className="h-full flex flex-col border-r border-[#1a1a24] overflow-hidden bg-[#0a0a0c]">
                  <SidebarContent activeFilePath={null} />
                </aside>
              </ResizablePanel>
              <ResizableHandle className="w-px bg-[#1a1a24] hover:bg-primary/40 transition-colors cursor-col-resize" />
            </>
          )}
          <ResizablePanel defaultSize={sidebarPanel ? 82 : 100} minSize={40} className="min-w-0">
            <div className="flex h-full min-w-0 min-h-0 overflow-hidden">
              {children ? children : <DesktopWorkspace />}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* ── Mobile layout ───────────────────────────────────────────────────── */}
      <div className="flex md:hidden flex-1 min-h-0 overflow-hidden">
        <MobileWorkspace />
      </div>

      {/* ── Mobile overlays (z-order: FAB < chat < settings < nav) ───────── */}
      <FloatingChatFAB />
      <MobileChatSheet />
      <MobileSettingsSheet />
      <MobileNav />

      {/* Spacer so content isn't hidden behind the fixed bottom nav */}
      <div
        className="md:hidden shrink-0"
        style={{ height: "calc(56px + env(safe-area-inset-bottom, 0px))" }}
      />
    </div>
  );
}
