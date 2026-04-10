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
  mobileTab: MobileTab;
  setMobileTab: (tab: MobileTab) => void;
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

  // ── Imported local project ─────────────────────────────────────────────────
  /** Virtual file tree imported from the user's local filesystem */
  importedProject: ImportedFileNode | null;
  setImportedProject: (node: ImportedFileNode | null) => void;
}

const IDEContext = createContext<IDEContextValue | null>(null);

export function IDEProvider({ children }: { children: ReactNode }) {
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("files");
  const [showChat, setShowChat]         = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);

  const [mobileTab, setMobileTab]                   = useState<MobileTab>("chat");
  const [showMobileChatSheet, setShowMobileChatSheet] = useState(false);

  const [selectedAi, setSelectedAi]   = useState("__auto__");
  const [newChatKey, setNewChatKey]   = useState(0);
  const [importedProject, setImportedProject] = useState<ImportedFileNode | null>(null);

  const onOpenFileRef = useRef<((path: string) => void) | null>(null);

  const toggleSidebarPanel = useCallback((p: Exclude<SidebarPanel, null>) => {
    setSidebarPanel(prev => (prev === p ? null : p));
  }, []);

  const toggleChat     = useCallback(() => setShowChat(v => !v), []);
  const toggleTerminal = useCallback(() => setShowTerminal(v => !v), []);

  const openFileInEditor = useCallback((path: string) => {
    setSidebarPanel("files");
    onOpenFileRef.current?.(path);
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
      importedProject, setImportedProject,
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
