/**
 * IDEContext — global state for the VS Code-like IDE shell.
 *
 * Desktop: sidebarPanel, showChat, showTerminal control which panels are visible.
 * Mobile:  mobileTab drives the bottom-nav; showMobileChatSheet pops chat
 *          over the editor as a bottom-sheet overlay.
 * Folder:  importedProject holds a virtual file tree imported from the user's
 *          local filesystem (read entirely in-browser, never uploaded).
 */
import {
  createContext, useContext, useState, useCallback, useRef, type ReactNode,
} from "react";
import type { ImportedFileNode } from "@/lib/folder-import";

export type SidebarPanel = "files" | "sessions" | "history" | "agent" | "agents" | "graph" | "help" | null;
export type MobileTab     = "chat" | "editor" | "files" | "terminal" | "agent";
export type MobileSettingsTab = "sessions" | "history" | "help";

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
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
  showMobileChatSheet: boolean;
  setShowMobileChatSheet: (v: boolean) => void;

  // ── Chat unread counter (mobile bottom-nav badge) ─────────────────────────
  /** Number of new AI messages received while the user is not on the Chat tab */
  chatUnreadCount: number;
  incrementChatUnread: () => void;
  clearChatUnread: () => void;

  // ── Mobile settings sheet ──────────────────────────────────────────────────
  showMobileSettings: boolean;
  setShowMobileSettings: (v: boolean) => void;
  mobileSettingsTab: MobileSettingsTab;
  setMobileSettingsTab: (t: MobileSettingsTab) => void;

  // ── AI model selection ─────────────────────────────────────────────────────
  selectedAi: string;
  setSelectedAi: (id: string) => void;

  // ── File opening (cross-panel event via refs) ──────────────────────────────
  openFileInEditor: (path: string) => void;
  /** Desktop EditorPanel registers here */
  onOpenFileRef: React.MutableRefObject<((path: string) => void) | null>;
  /** Mobile EditorPanel registers here */
  onOpenMobileFileRef: React.MutableRefObject<((path: string) => void) | null>;

  // ── Active file path (for terminal "Run" button) ───────────────────────────
  activeFilePath: string | null;
  setActiveFilePath: (path: string | null) => void;

  // ── New chat trigger ───────────────────────────────────────────────────────
  newChatKey: number;
  triggerNewChat: () => void;

  // ── Imported local project ─────────────────────────────────────────────────
  /** Virtual file tree imported from the user's local filesystem */
  importedProject: ImportedFileNode | null;
  setImportedProject: (node: ImportedFileNode | null) => void;

  // ── Command Palette (Ctrl+P = files, Ctrl+K = commands) ───────────────────
  showCommandPalette: boolean;
  /** Text pre-filled in the palette input — "" for file mode, ">" for command mode */
  paletteInitialQuery: string;
  openCommandPalette:  () => void;
  /** Open with ">" pre-filled to jump straight into command mode */
  openCommandMode:     () => void;
  closeCommandPalette: () => void;

  // ── Keyboard shortcut help modal (?? key) ─────────────────────────────────
  showShortcutsModal: boolean;
  openShortcutsModal:  () => void;
  closeShortcutsModal: () => void;

  // ── Welcome / onboarding modal ────────────────────────────────────────────
  showWelcomeModal: boolean;
  openWelcomeModal:  () => void;
  closeWelcomeModal: () => void;
}

const IDEContext = createContext<IDEContextValue | null>(null);

export function IDEProvider({ children }: { children: ReactNode }) {
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("files");
  const [showChat, setShowChat]         = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);

  // ── Mobile tab — persisted so the user lands back where they left off ────────
  const [mobileTab, _setMobileTab] = useState<MobileTab>(() => {
    try {
      const v = localStorage.getItem("vesper.mobileTab");
      if (v && ["chat","editor","files","terminal","agent"].includes(v)) return v as MobileTab;
    } catch { /* SSR / private-mode guard */ }
    return "chat";
  });
  const setMobileTab = useCallback((tab: MobileTab) => {
    _setMobileTab(tab);
    try { localStorage.setItem("vesper.mobileTab", tab); } catch { /* ignore */ }
  }, []);

  const [showMobileChatSheet, setShowMobileChatSheet] = useState(false);
  const [showMobileSettings, setShowMobileSettings]   = useState(false);
  const [mobileSettingsTab, setMobileSettingsTab]     = useState<MobileSettingsTab>("sessions");
  const [chatUnreadCount, setChatUnreadCount]         = useState(0);

  const incrementChatUnread = useCallback(() => setChatUnreadCount(n => n + 1), []);
  const clearChatUnread     = useCallback(() => setChatUnreadCount(0), []);

  // ── Selected AI model — persisted across reloads ──────────────────────────
  const [selectedAi, _setSelectedAi] = useState<string>(() => {
    try { return localStorage.getItem("vesper.selectedAi") || "__auto__"; } catch { return "__auto__"; }
  });
  const setSelectedAi = useCallback((id: string) => {
    _setSelectedAi(id);
    try { localStorage.setItem("vesper.selectedAi", id); } catch { /* ignore */ }
  }, []);
  const [newChatKey, setNewChatKey]   = useState(0);
  const [importedProject, setImportedProject] = useState<ImportedFileNode | null>(null);
  const [activeFilePath, setActiveFilePath]   = useState<string | null>(null);
  const [showCommandPalette, setShowCommandPalette]   = useState(false);
  const [paletteInitialQuery, setPaletteInitialQuery] = useState("");
  const [showShortcutsModal, setShowShortcutsModal]   = useState(false);

  const openCommandPalette  = useCallback(() => { setPaletteInitialQuery(""); setShowCommandPalette(true);  }, []);
  const openCommandMode     = useCallback(() => { setPaletteInitialQuery(">"); setShowCommandPalette(true);  }, []);
  const closeCommandPalette = useCallback(() => setShowCommandPalette(false), []);

  const openShortcutsModal  = useCallback(() => setShowShortcutsModal(true),  []);
  const closeShortcutsModal = useCallback(() => setShowShortcutsModal(false), []);

  // ── Welcome modal ─────────────────────────────────────────────────────────
  const [showWelcomeModal, setShowWelcomeModal] = useState<boolean>(() => {
    try { return !localStorage.getItem("vesper.welcomed"); } catch { return false; }
  });
  const openWelcomeModal  = useCallback(() => setShowWelcomeModal(true),  []);
  const closeWelcomeModal = useCallback(() => {
    try { localStorage.setItem("vesper.welcomed", "1"); } catch { /* ignore */ }
    setShowWelcomeModal(false);
  }, []);

  const onOpenFileRef       = useRef<((path: string) => void) | null>(null);
  const onOpenMobileFileRef = useRef<((path: string) => void) | null>(null);

  const toggleSidebarPanel = useCallback((p: Exclude<SidebarPanel, null>) => {
    setSidebarPanel(prev => (prev === p ? null : p));
  }, []);

  const toggleChat     = useCallback(() => setShowChat(v => !v), []);
  const toggleTerminal = useCallback(() => setShowTerminal(v => !v), []);

  const openFileInEditor = useCallback((path: string) => {
    // Call BOTH refs — desktop editor always handles it on desktop,
    // mobile editor always handles it on mobile. Having both open the
    // file is harmless (only one is visible at a time).
    onOpenFileRef.current?.(path);
    onOpenMobileFileRef.current?.(path);
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
      chatUnreadCount, incrementChatUnread, clearChatUnread,
      showMobileSettings, setShowMobileSettings,
      mobileSettingsTab, setMobileSettingsTab,
      selectedAi, setSelectedAi,
      openFileInEditor, onOpenFileRef, onOpenMobileFileRef,
      activeFilePath, setActiveFilePath,
      newChatKey, triggerNewChat,
      importedProject, setImportedProject,
      showCommandPalette, paletteInitialQuery,
      openCommandPalette, openCommandMode, closeCommandPalette,
      showShortcutsModal, openShortcutsModal, closeShortcutsModal,
      showWelcomeModal, openWelcomeModal, closeWelcomeModal,
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
