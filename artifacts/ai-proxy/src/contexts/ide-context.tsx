import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from "react";

export type SidebarPanel = "files" | "sessions" | "history" | "agent" | "help" | null;

interface IDEContextValue {
  sidebarPanel: SidebarPanel;
  setSidebarPanel: (p: SidebarPanel) => void;
  toggleSidebarPanel: (p: Exclude<SidebarPanel, null>) => void;

  showChat: boolean;
  setShowChat: (v: boolean) => void;
  toggleChat: () => void;

  showTerminal: boolean;
  setShowTerminal: (v: boolean) => void;
  toggleTerminal: () => void;

  selectedAi: string;
  setSelectedAi: (id: string) => void;

  openFileInEditor: (path: string) => void;
  onOpenFileRef: React.MutableRefObject<((path: string) => void) | null>;

  newChatKey: number;
  triggerNewChat: () => void;
}

const IDEContext = createContext<IDEContextValue | null>(null);

export function IDEProvider({ children }: { children: ReactNode }) {
  const [sidebarPanel, setSidebarPanel] = useState<SidebarPanel>("files");
  const [showChat, setShowChat] = useState(true);
  const [showTerminal, setShowTerminal] = useState(false);
  const [selectedAi, setSelectedAi] = useState("__auto__");
  const [newChatKey, setNewChatKey] = useState(0);
  const onOpenFileRef = useRef<((path: string) => void) | null>(null);

  const toggleSidebarPanel = useCallback((p: Exclude<SidebarPanel, null>) => {
    setSidebarPanel(prev => (prev === p ? null : p));
  }, []);

  const toggleChat = useCallback(() => setShowChat(v => !v), []);
  const toggleTerminal = useCallback(() => setShowTerminal(v => !v), []);

  const openFileInEditor = useCallback((path: string) => {
    setSidebarPanel("files");
    onOpenFileRef.current?.(path);
  }, []);

  const triggerNewChat = useCallback(() => setNewChatKey(k => k + 1), []);

  return (
    <IDEContext.Provider value={{
      sidebarPanel, setSidebarPanel, toggleSidebarPanel,
      showChat, setShowChat, toggleChat,
      showTerminal, setShowTerminal, toggleTerminal,
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
