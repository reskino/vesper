/**
 * IDEContext — global state for the VS Code-like IDE shell.
 *
 * Desktop: sidebarPanel, showChat, showTerminal control which panels are visible.
 * Mobile:  mobileTab drives the bottom-nav; showMobileChatSheet pops chat
 *          over the editor as a bottom-sheet overlay.
 */
import {
  createContext, useContext, useState, useCallback, useRef, type ReactNode,
} from "react";

export type SidebarPanel = "files" | "sessions" | "history" | "agent" | "help" | null;
export type MobileTab     = "chat" | "editor" | "files" | "history";

interface IDEContextValue {
  // ── Desktop sidebar / panel toggles ───────────────────────────────────────
  sidebarPanel: SidebarPanel;
  setSidebarPanel: (p: SidebarPanel) => void;
  toggleSidebarPanel: (p: Exclude<SidebarPanel, null>) => void;

  showChat: boolean;
  setShowChat: (v: boolean) => void;
  toggleChat: () => void;

  showTerminal: boolean;
  setShowTerminal: (v: boolean) => void;
  toggleTerminal: () => void;

  // ── Mobile navigation ──────────────────────────────────────────────────────
  /** Active tab on mobile bottom nav */
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  /** Whether the chat bottom-sheet is open over the editor (mobile only) */
  showMobileChatSheet: boolean;
  setShowMobileChatSheet: (v: boolean) => void;

  // ── AI model selection ─────────────────────────────────────────────────────
  selectedAi: string;
  setSelectedAi: (id: string) => void;

  // ── File opening (cross-panel event via ref) ───────────────────────────────
  openFileInEditor: (path: string) => void;
  onOpenFileRef: React.MutableRefObject<((path: string) => void) | null>;

  // ── New chat trigger ───────────────────────────────────────────────────────
  newChatKey: number;
  triggerNewChat: () => void;
}

const IDEContext = createContext<IDEContextValue | null>(null);

export function IDEProvider({ children }: { children: ReactNode }) {
  // Desktop panel state
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("files");
  const [showChat, setShowChat]         = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);

  // Mobile nav state (default to Chat on mobile)
  const [mobileTab, setMobileTab]                   = useState<MobileTab>("chat");
  const [showMobileChatSheet, setShowMobileChatSheet] = useState(false);

  // AI selection
  const [selectedAi, setSelectedAi] = useState("__auto__");

  // New chat key
  const [newChatKey, setNewChatKey] = useState(0);

  // File opener ref (set by EditorPanel on mount)
  const onOpenFileRef = useRef<((path: string) => void) | null>(null);

  const toggleSidebarPanel = useCallback((p: Exclude<SidebarPanel, null>) => {
    setSidebarPanel(prev => (prev === p ? null : p));
  }, []);

  const toggleChat     = useCallback(() => setShowChat(v => !v), []);
  const toggleTerminal = useCallback(() => setShowTerminal(v => !v), []);

  const openFileInEditor = useCallback((path: string) => {
    // Desktop: open sidebar + trigger editor
    setSidebarPanel("files");
    onOpenFileRef.current?.(path);
    // Mobile: switch to editor tab
    setMobileTab("editor");
    setShowMobileChatSheet(false);
  }, []);

  const triggerNewChat = useCallback(() => setNewChatKey(k => k + 1), []);

  return (
    <IDEContext.Provider value={{
      sidebarPanel, setSidebarPanel, toggleSidebarPanel,
      showChat, setShowChat, toggleChat,
      showTerminal, setShowTerminal, toggleTerminal,
      mobileTab, setMobileTab,
      showMobileChatSheet, setShowMobileChatSheet,
      selectedAi, setSelectedAi,
      openFileInEditor, onOpenFileRef,
      newChatKey, triggerNewChat,
    }}>
      {children}
    </IDEContext.Provider>
  );
}

export function useIDE() {
  const ctx = useContext(IDEContext);
  if (!ctx) throw new Error("useIDE must be used within IDEProvider");
  return ctx;
}
