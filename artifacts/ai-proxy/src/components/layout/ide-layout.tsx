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
import { useEffect, useCallback, useState, lazy, Suspense, type ElementType } from "react";
import { useIDE, type MobileTab, type MobileSettingsTab } from "@/contexts/ide-context";
import { WelcomeModal } from "@/components/welcome-modal";
import { ActivityBar } from "./activity-bar";
import { TopBar } from "./top-bar";
import { FileExplorer } from "@/components/ide/file-explorer";
import { EditorPanel } from "@/components/ide/editor-panel";
import { CommandPalette } from "@/components/ide/command-palette";
import { ShortcutsModal, useShortcutsKey } from "@/components/ide/shortcuts-modal";
import { PanelErrorBoundary } from "@/components/ide/error-boundary";
import { ChatPanel } from "@/components/ide/chat-panel";
import { TerminalPanel } from "@/components/ide/terminal-panel";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

// Lazy-load heavy pages that are only shown on demand.
// Each gets its own async chunk so the main bundle stays small.
const Sessions   = lazy(() => import("@/pages/sessions").then(m => ({ default: m.Sessions })));
const History    = lazy(() => import("@/pages/history").then(m => ({ default: m.History })));
const AgentPage  = lazy(() => import("@/pages/agent"));
const AgentsPage = lazy(() => import("@/pages/agents"));
const GraphPage  = lazy(() => import("@/pages/graph"));
const HelpPage   = lazy(() => import("@/pages/help"));

// Minimal skeleton shown while a lazy panel is loading
function PanelSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center bg-[#0d0d12]">
      <div className="flex flex-col items-center gap-3 text-[#7878a8]">
        <div className="h-6 w-6 rounded-full border-2 border-[#2a2a3c] border-t-primary/60 animate-spin" />
        <p className="text-xs font-medium">Loading…</p>
      </div>
    </div>
  );
}
import { VesperLogo } from "@/components/vesper-logo";
import {
  MessageSquare, Code2, FolderOpen, TerminalSquare,
  MessageSquarePlus, X, Sparkles, Bot,
  ShieldCheck, Clock, BookOpen, Sun, Moon, Keyboard,
} from "lucide-react";
import { useTheme } from "@/contexts/theme-context";

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
          transition-opacity duration-300 motion-reduce:transition-none motion-reduce:duration-0
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
          bg-surface border-t border-border
          shadow-[0_-24px_80px_rgba(0,0,0,0.5)]
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          motion-reduce:transition-none motion-reduce:duration-0
          ${showMobileChatSheet ? "translate-y-0" : "translate-y-full"}`}
        style={{
          height: "82dvh",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 52px)",
        }}
      >
        {/* Drag handle */}
        <div
          className="shrink-0 flex flex-col items-center cursor-grab active:cursor-grabbing pt-3 pb-2"
          onTouchStart={handleTouchStart}
        >
          <div className="w-10 h-1 rounded-full bg-muted-foreground/20" />
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
              <p className="text-[10px] text-muted-foreground mt-0.5">Multi-model · Context-aware</p>
            </div>
          </div>
          <button
            onClick={() => setShowMobileChatSheet(false)}
            className="h-9 w-9 flex items-center justify-center rounded-full
              bg-muted border border-border text-muted-foreground
              active:scale-95 transition-all"
            aria-label="Close chat"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Thin separator */}
        <div className="h-px bg-border shrink-0 mx-4 mb-1" />

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
  const { isDark, toggleTheme } = useTheme();

  useEffect(() => {
    document.body.style.overflow = showMobileSettings ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [showMobileSettings]);

  return (
    <>
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/80 backdrop-blur-sm
          transition-opacity duration-300 motion-reduce:transition-none motion-reduce:duration-0
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
          bg-surface border-t border-border
          shadow-[0_-24px_80px_rgba(0,0,0,0.5)]
          transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]
          motion-reduce:transition-none motion-reduce:duration-0
          ${showMobileSettings ? "translate-y-0" : "translate-y-full"}`}
        style={{
          height: "92dvh",
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 52px)",
        }}
      >
        {/* Sheet header */}
        <div className="shrink-0 flex items-center justify-between px-4 pt-4 pb-3 border-b border-border/60">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-gradient-to-br from-primary/30 to-primary/10
              border border-primary/20 flex items-center justify-center">
              <VesperLogo size={14} />
            </div>
            <div>
              <p className="font-bold text-[13px] text-foreground leading-none">Vesper Settings</p>
              <p className="text-[10px] text-muted-foreground mt-0.5">Providers · History · Help</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="h-9 w-9 flex items-center justify-center rounded-full
                bg-muted border border-border text-muted-foreground
                active:scale-95 transition-all"
              aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              onClick={() => setShowMobileSettings(false)}
              className="h-9 w-9 flex items-center justify-center rounded-full
                bg-muted border border-border text-muted-foreground
                active:scale-95 transition-all"
              aria-label="Close settings"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Tab pills */}
        <div className="shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border/60">
          {SETTINGS_TABS.map(({ id, label, icon: Icon }) => {
            const active = mobileSettingsTab === id;
            return (
              <button
                key={id}
                onClick={() => setMobileSettingsTab(id)}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold transition-all
                  ${active
                    ? "bg-primary/15 text-primary border border-primary/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted border border-transparent"
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
          <Suspense fallback={<PanelSkeleton />}>
            {mobileSettingsTab === "sessions" && <Sessions />}
            {mobileSettingsTab === "history"  && <History />}
            {mobileSettingsTab === "help"     && <HelpPage />}
          </Suspense>
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
  const { mobileTab, setMobileTab, setShowMobileChatSheet, chatUnreadCount, clearChatUnread } = useIDE();

  const handleTab = (id: MobileTab) => {
    setMobileTab(id);
    if (id === "chat") clearChatUnread();
    if (id !== "editor") setShowMobileChatSheet(false);
  };

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 z-30
        bg-[#080809]/98 backdrop-blur-2xl border-t border-[#1a1a24]
        shadow-[0_-8px_40px_rgba(0,0,0,0.5)]"
      style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      aria-label="Main navigation"
    >
      <div className="grid grid-cols-5">
        {MOBILE_TABS.map(({ id, label, icon: Icon }) => {
          const active = mobileTab === id;
          const showBadge = id === "chat" && chatUnreadCount > 0 && !active;

          return (
            <button
              key={id}
              onClick={() => handleTab(id)}
              className={`relative flex flex-col items-center justify-center gap-0.5 py-2
                min-h-[52px] transition-all duration-150 select-none
                active:scale-[0.92] motion-reduce:transition-none motion-reduce:active:scale-100`}
              aria-label={`${label}${showBadge ? ` (${chatUnreadCount} new)` : ""}`}
              aria-current={active ? "page" : undefined}
            >
              {/* Top accent line */}
              <span
                className={`absolute top-0 left-1/2 -translate-x-1/2 h-[2px] rounded-b-full
                  transition-all duration-200 motion-reduce:transition-none
                  ${active ? "w-10 bg-primary" : "w-0 bg-transparent"}`}
              />

              {/* Icon pill with unread badge */}
              <div className="relative">
                <div className={`h-8 w-[44px] rounded-xl flex items-center justify-center
                  transition-all duration-200 motion-reduce:transition-none
                  ${active ? "bg-primary/18" : ""}`}>
                  <Icon className={`transition-all duration-150 motion-reduce:transition-none
                    ${active ? "h-[18px] w-[18px] text-primary" : "h-[18px] w-[18px] text-[#7878a8]"}`}
                  />
                </div>

                {/* Unread badge — shown on Chat tab when off-tab AI responds */}
                {showBadge && (
                  <span
                    className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1
                      flex items-center justify-center
                      rounded-full bg-primary text-primary-foreground
                      text-[9px] font-bold leading-none
                      shadow-[0_0_8px_rgba(99,102,241,0.6)]
                      animate-in zoom-in-50 duration-200 motion-reduce:animate-none"
                  >
                    {chatUnreadCount > 9 ? "9+" : chatUnreadCount}
                  </span>
                )}
              </div>

              {/* Label */}
              <span className={`text-[10px] font-semibold leading-none transition-colors
                ${active ? "text-primary" : "text-[#6868a8]"}`}>
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
        motion-reduce:transition-none motion-reduce:duration-0 motion-reduce:active:scale-100
        ${showMobileChatSheet ? "opacity-0 pointer-events-none scale-90" : "opacity-100 scale-100"}`}
      style={{ bottom: "calc(60px + env(safe-area-inset-bottom, 0px))" }}
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
    case "agent":    return <Suspense fallback={<PanelSkeleton />}><div className="h-full overflow-y-auto bg-surface"><AgentPage /></div></Suspense>;
    case "agents":   return <Suspense fallback={<PanelSkeleton />}><div className="h-full overflow-y-auto bg-surface"><AgentsPage /></div></Suspense>;
    case "graph":    return <Suspense fallback={<PanelSkeleton />}><div className="h-full flex flex-col bg-[#07070e]"><GraphPage /></div></Suspense>;
    case "sessions": return <Suspense fallback={<PanelSkeleton />}><div className="h-full overflow-y-auto bg-surface"><Sessions /></div></Suspense>;
    case "history":  return <Suspense fallback={<PanelSkeleton />}><div className="h-full overflow-y-auto bg-surface"><History /></div></Suspense>;
    case "help":     return <Suspense fallback={<PanelSkeleton />}><div className="h-full overflow-y-auto bg-surface"><HelpPage /></div></Suspense>;
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
        border-l border-border/60 bg-base transition-colors
        hover:bg-surface group"
    >
      {/* Pulsing bubble icon */}
      <div className="relative">
        <MessageSquarePlus className="h-4 w-4 text-muted-foreground/85 group-hover:text-primary transition-colors" />
        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary/60
          ring-2 ring-background animate-pulse group-hover:bg-primary" />
      </div>
      {/* Rotated label */}
      <span
        className="text-[9px] font-bold text-muted-foreground/70 uppercase tracking-[0.15em]
          group-hover:text-muted-foreground transition-colors select-none"
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
              <PanelErrorBoundary label="Editor">
                <EditorPanel />
              </PanelErrorBoundary>
            </ResizablePanel>

            {showChat && (
              <>
                <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
                <ResizablePanel defaultSize={45} minSize={25} maxSize={65}>
                  <PanelErrorBoundary label="Chat">
                    <ChatPanel newChatKey={newChatKey} />
                  </PanelErrorBoundary>
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
          <ResizableHandle className="h-px bg-border hover:bg-primary/40 transition-colors cursor-row-resize" />
          <ResizablePanel defaultSize={30} minSize={15} maxSize={60}>
            <PanelErrorBoundary label="Terminal">
              <TerminalPanel />
            </PanelErrorBoundary>
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mobile: single-panel view based on active tab
// ─────────────────────────────────────────────────────────────────────────────

/**
 * MobileWorkspace — renders only the panels that have been visited.
 *
 * Each panel is mounted lazily (on first visit) and then kept alive in the DOM
 * with `hidden` so its internal state (editor tabs, scroll position, etc.) is
 * preserved without re-mounting. This dramatically reduces initial CPU/memory
 * cost on low-end Android devices where mounting 5 complex panels at boot
 * caused noticeable jank and network requests.
 */
function MobileWorkspace() {
  const { mobileTab, newChatKey } = useIDE();

  // Track which tabs have been opened at least once.
  // "chat" is pre-visited because it's the default starting tab.
  const [mounted, setMounted] = useState<Set<MobileTab>>(new Set(["chat"]));

  useEffect(() => {
    setMounted(prev => {
      if (prev.has(mobileTab)) return prev;
      const next = new Set(prev);
      next.add(mobileTab);
      return next;
    });
  }, [mobileTab]);

  const show = (tab: MobileTab) => (mobileTab === tab ? "" : "hidden");

  return (
    <div className="flex-1 min-h-0 overflow-hidden">
      {/* Chat — always mounted (default tab) */}
      <div className={`h-full ${show("chat")}`}>
        <PanelErrorBoundary label="Chat">
          <ChatPanel newChatKey={newChatKey} mobile />
        </PanelErrorBoundary>
      </div>

      {/* Editor — mounted on first visit */}
      {mounted.has("editor") && (
        <div className={`h-full ${show("editor")}`}>
          <PanelErrorBoundary label="Editor">
            <EditorPanel mobile />
          </PanelErrorBoundary>
        </div>
      )}

      {/* Agent runner — mounted on first visit */}
      {mounted.has("agent") && (
        <div className={`h-full ${show("agent")}`}>
          <div className="h-full overflow-y-auto bg-surface">
            <Suspense fallback={<PanelSkeleton />}>
              <AgentPage mobile />
            </Suspense>
          </div>
        </div>
      )}

      {/* File explorer — mounted on first visit */}
      {mounted.has("files") && (
        <div className={`h-full ${show("files")}`}>
          <FileExplorer activePath={null} />
        </div>
      )}

      {/* Terminal — mounted on first visit */}
      {mounted.has("terminal") && (
        <div className={`h-full ${show("terminal")}`}>
          <TerminalPanel />
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Root layout
// ─────────────────────────────────────────────────────────────────────────────
export function IDELayout({ children }: { children?: React.ReactNode }) {
  const {
    sidebarPanel, toggleTerminal, toggleChat, triggerNewChat,
    showCommandPalette, paletteInitialQuery,
    openCommandPalette, openCommandMode, closeCommandPalette,
    showShortcutsModal, openShortcutsModal, closeShortcutsModal,
    showWelcomeModal, closeWelcomeModal,
  } = useIDE();

  // Wire the "?" key globally to open shortcuts modal
  useShortcutsKey();

  // Global keyboard shortcuts (desktop + mobile)
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key === "`") { e.preventDefault(); toggleTerminal(); }
      if (ctrl && e.key === "j") { e.preventDefault(); toggleChat(); }
      if (ctrl && e.key === "n") { e.preventDefault(); triggerNewChat(); }
      // Ctrl+P — file search palette
      if (ctrl && e.key === "p") { e.preventDefault(); openCommandPalette(); }
      // Ctrl+K — command mode palette (VSCode style)
      if (ctrl && e.key === "k") { e.preventDefault(); openCommandMode(); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleTerminal, toggleChat, triggerNewChat, openCommandPalette, openCommandMode]);

  return (
    <div className="flex flex-col h-dvh w-full bg-background overflow-hidden font-sans">
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
                <aside className="h-full flex flex-col border-r border-border overflow-hidden bg-surface">
                  <SidebarContent activeFilePath={null} />
                </aside>
              </ResizablePanel>
              <ResizableHandle className="w-px bg-border hover:bg-primary/40 transition-colors cursor-col-resize" />
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

      {/* ── Command Palette (Ctrl+P = files / Ctrl+K = commands, z-300) ── */}
      <CommandPalette
        open={showCommandPalette}
        onClose={closeCommandPalette}
        initialQuery={paletteInitialQuery}
      />

      {/* ── Keyboard Shortcut Reference (? key, z-310) ──────────────────── */}
      <ShortcutsModal open={showShortcutsModal} onClose={closeShortcutsModal} />

      {/* ── Welcome / onboarding modal (z-500, first launch) ──────────── */}
      <WelcomeModal open={showWelcomeModal} onClose={closeWelcomeModal} />

      {/* Spacer so content isn't hidden behind the fixed bottom nav (52px bar) */}
      <div
        className="md:hidden shrink-0"
        style={{ height: "calc(52px + env(safe-area-inset-bottom, 0px))" }}
      />
    </div>
  );
}
