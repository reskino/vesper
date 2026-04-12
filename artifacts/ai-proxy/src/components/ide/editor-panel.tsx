/**
 * EditorPanel — Monaco-powered multi-tab code editor with:
 *  - Full syntax highlighting + IntelliSense for 30+ languages
 *  - Auto-save (1.5 s debounce after last keystroke)
 *  - Ctrl+S manual save, Ctrl+W close tab
 *  - Word-wrap toggle, font-size zoom, cursor position status bar
 *  - Inline AI assistant side-panel (quick actions + multi-turn chat)
 *  - ANSI-colour-free "Apply to editor" from AI responses
 */
import {
  useState, useEffect, useRef, useCallback, useMemo,
} from "react";
import MonacoEditor, { OnMount, OnChange } from "@monaco-editor/react";
import type * as MonacoNS from "monaco-editor";
import {
  useReadFile, getReadFileQueryKey,
  useWriteFile,
  useListAis, getListAisQueryKey,
  useAskAiWithContext,
  useTerminalExec,
} from "@workspace/api-client-react";
import {
  FileIcon, FileCode, FileText, FileJson,
  Save, Loader2, MessageSquare, X, WrapText,
  ZoomIn, ZoomOut, FilePlus, Zap, Copy, XCircle, FolderX, Search, Play,
} from "lucide-react";
import { toast } from "sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { useIDE } from "@/contexts/ide-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

// ── Small localStorage helpers ────────────────────────────────────────────────
function lsGet<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v !== null ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function lsSet(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota / private mode */ }
}

// ── Language mapping ──────────────────────────────────────────────────────────

/** Maps file extension → Monaco language ID */
function getMonacoLanguage(filename: string): string {
  if (!filename) return "plaintext";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "javascript", jsx: "javascript",
    ts: "typescript", tsx: "typescript",
    mjs: "javascript", cjs: "javascript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp",
    cs: "csharp",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin", kts: "kotlin",
    r: "r",
    sh: "shell", bash: "shell", zsh: "shell",
    ps1: "powershell",
    html: "html", htm: "html",
    css: "css",
    scss: "scss", sass: "scss",
    less: "less",
    json: "json", jsonc: "json",
    yaml: "yaml", yml: "yaml",
    toml: "toml",
    xml: "xml", svg: "xml",
    md: "markdown", mdx: "markdown",
    sql: "sql",
    graphql: "graphql", gql: "graphql",
    dockerfile: "dockerfile",
    tf: "hcl",
  };
  // Also match files whose basename is the key (e.g. "Dockerfile")
  const base = filename.split("/").pop()?.toLowerCase() ?? "";
  return map[ext] ?? map[base] ?? "plaintext";
}

/** Human-readable label shown in the status bar */
function getLangLabel(filename: string): string {
  const lang = getMonacoLanguage(filename);
  const labels: Record<string, string> = {
    javascript: "JavaScript", typescript: "TypeScript",
    python: "Python", rust: "Rust", go: "Go", java: "Java",
    c: "C", cpp: "C++", csharp: "C#", ruby: "Ruby", php: "PHP",
    swift: "Swift", kotlin: "Kotlin", r: "R", shell: "Shell",
    powershell: "PowerShell", html: "HTML", css: "CSS", scss: "SCSS",
    less: "Less", json: "JSON", yaml: "YAML", toml: "TOML",
    xml: "XML", markdown: "Markdown", sql: "SQL",
    graphql: "GraphQL", dockerfile: "Dockerfile", hcl: "HCL",
    plaintext: "Plain Text",
  };
  return labels[lang] ?? lang;
}

/** Small coloured icon for the tab strip */
function TabIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return <FileCode className="h-3 w-3 text-blue-400 shrink-0" />;
  if (ext === "json") return <FileJson className="h-3 w-3 text-yellow-400 shrink-0" />;
  if (["md", "mdx"].includes(ext)) return <FileText className="h-3 w-3 text-slate-400 shrink-0" />;
  if (ext === "py") return <FileCode className="h-3 w-3 text-green-400 shrink-0" />;
  if (ext === "css" || ext === "scss") return <FileCode className="h-3 w-3 text-pink-400 shrink-0" />;
  if (["html", "htm"].includes(ext)) return <FileCode className="h-3 w-3 text-orange-400 shrink-0" />;
  if (ext === "rs") return <FileCode className="h-3 w-3 text-orange-600 shrink-0" />;
  if (ext === "sql") return <FileCode className="h-3 w-3 text-sky-400 shrink-0" />;
  return <FileIcon className="h-3 w-3 text-[#9898b8] shrink-0" />;
}

// ── Per-tab state ─────────────────────────────────────────────────────────────
interface TabState {
  content: string;      // current (possibly unsaved) content
  savedContent: string; // what's persisted on disk
  loaded: boolean;      // has initial file data been fetched?
}

// ── AI assistant messages ────────────────────────────────────────────────────
interface AiMsg {
  role: "user" | "assistant";
  content: string;
  error?: boolean;
}

// ── AI side-panel ─────────────────────────────────────────────────────────────
function AiSidePanel({
  activeTab,
  tabContent,
  onApply,
  onClose,
}: {
  activeTab: string | null;
  tabContent: string;
  onApply: (code: string) => void;
  onClose: () => void;
}) {
  const { selectedAi } = useIDE();
  const { data: aisData } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [prompt, setPrompt] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const askAi = useAskAiWithContext();

  // Auto-scroll to the latest message
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const resolveAi = () => {
    if (selectedAi === "__auto__") return aisData?.ais?.find((a: any) => a.hasSession)?.id ?? "pollinations";
    return selectedAi;
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || askAi.isPending) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setPrompt("");
    const files = activeTab && tabContent ? [{ path: activeTab, content: tabContent }] : [];
    try {
      const res = await askAi.mutateAsync({ data: { aiId: resolveAi(), prompt: text, files } });
      setMessages(prev => [...prev, res.success
        ? { role: "assistant", content: res.response }
        : { role: "assistant", content: res.error ?? "Request failed", error: true },
      ]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Network error.", error: true }]);
    }
  };

  /** Extract the first code block from an AI message and apply it */
  const applyCode = (content: string) => {
    const match = content.match(/```[\w]*\n([\s\S]*?)```/);
    if (match?.[1]) onApply(match[1].trim());
  };

  const QUICK_ACTIONS = [
    { label: "Explain",    prompt: "Explain what this code does in detail." },
    { label: "Fix bugs",   prompt: "Find and fix any bugs in this code." },
    { label: "Refactor",   prompt: "Refactor this code for better readability and performance." },
    { label: "Tests",      prompt: "Write comprehensive unit tests for this code." },
    { label: "Docs",       prompt: "Add JSDoc / docstring comments to this code." },
    { label: "Optimise",   prompt: "Optimise this code for speed and memory efficiency." },
  ];

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] border-l border-[#1a1a24]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a24] shrink-0">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-[#a0a0c0]">AI Assistant</span>
        </div>
        <button
          onClick={onClose}
          className="h-5 w-5 flex items-center justify-center rounded text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Quick-action chips */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#1a1a24] shrink-0 flex-wrap">
        {QUICK_ACTIONS.map(a => (
          <button
            key={a.label}
            onClick={() => sendMessage(a.prompt)}
            disabled={!activeTab || askAi.isPending}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#141420] hover:bg-[#1e1e2e] border border-[#1a1a24] text-[#a0a0c0] hover:text-foreground disabled:opacity-40 transition-all"
          >
            {a.label}
          </button>
        ))}
      </div>

      {/* Message list */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="text-center py-6 text-[#9898b8] text-xs">
            {activeTab ? "Ask about your code or use a quick action above." : "Open a file to enable the AI assistant."}
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`text-xs rounded-xl px-3 py-2 ${
              msg.role === "user"
                ? "bg-[#1e1e2e] border border-[#2a2a40] text-foreground ml-4"
                : msg.error
                  ? "text-red-400 bg-red-500/10 border border-red-500/20"
                  : "text-foreground"
            }`}
          >
            {msg.role === "user" ? msg.content : (
              <div>
                <MarkdownRenderer content={msg.content} />
                {/```/.test(msg.content) && (
                  <button
                    onClick={() => applyCode(msg.content)}
                    className="mt-2 text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >
                    Apply to editor
                  </button>
                )}
              </div>
            )}
          </div>
        ))}
        {askAi.isPending && (
          <div className="flex items-center gap-1.5 text-[#9898b8] text-xs px-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-2 py-2 border-t border-[#1a1a24]">
        <div className="flex gap-1">
          <input
            className="flex-1 bg-[#141420] border border-[#1a1a24] focus:border-primary/40 rounded-lg px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-[#7878a8] transition-colors"
            placeholder="Ask about this code…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(prompt); }
            }}
            disabled={askAi.isPending}
          />
          <button
            onClick={() => sendMessage(prompt)}
            disabled={askAi.isPending || !prompt.trim()}
            className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40 transition-colors"
          >
            {askAi.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <MessageSquare className="h-3 w-3" />}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Context-menu item type ────────────────────────────────────────────────────
interface ContextMenu { x: number; y: number; tab: string }

// ── Main EditorPanel ──────────────────────────────────────────────────────────
export function EditorPanel({ mobile = false }: { mobile?: boolean }) {
  const { onOpenFileRef, onOpenMobileFileRef, onReloadFileRef, onReloadMobileFileRef,
    setActiveFilePath, openCommandPalette } = useIDE();
  const { currentWorkspace, venvStatus } = useWorkspace();
  const theRef       = mobile ? onOpenMobileFileRef : onOpenFileRef;
  const theReloadRef = mobile ? onReloadMobileFileRef : onReloadFileRef;
  // Run-file feature — executes the current file in the workspace venv (Python)
  // or with node (JavaScript / TypeScript)
  const execMutation = useTerminalExec();
  const [isRunning, setIsRunning] = useState(false);
  const [runOutput, setRunOutput] = useState<{ stdout: string; stderr: string; exitCode: number } | null>(null);
  // Workspace-scoped persistence key — tabs for workspace A never bleed into workspace B
  const wsKey = currentWorkspace?.slug ?? "__no_workspace__";
  const tabsKey = `vesper.editor.tabs.${wsKey}`;

  // ── Tab management — initialised from localStorage ───────────────────────
  const [openTabs, setOpenTabs]      = useState<string[]>(() => lsGet<string[]>(tabsKey, []));
  const [activeTab, setActiveTabRaw] = useState<string | null>(() => {
    const saved = lsGet<string | null>(`${tabsKey}.active`, null);
    const tabs  = lsGet<string[]>(tabsKey, []);
    // Guard against a stale active path that's no longer in the open list
    return saved && tabs.includes(saved) ? saved : (tabs[0] ?? null);
  });
  const [tabStates, setTabStates]    = useState<Record<string, TabState>>({});

  const setActiveTab = useCallback((p: string | null) => {
    setActiveTabRaw(p);
    setActiveFilePath(p);
    lsSet(`${tabsKey}.active`, p);
  }, [setActiveFilePath, tabsKey]);

  // Persist open tab list whenever it changes (but not on every render)
  useEffect(() => { lsSet(tabsKey, openTabs); }, [openTabs, tabsKey]);

  // Sync activeFilePath into IDEContext on first mount (restoring from localStorage)
  useEffect(() => {
    if (activeTab) setActiveFilePath(activeTab);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally only on mount

  // Auto-scroll the active tab into view in the tab bar whenever it changes
  useEffect(() => {
    activeTabRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTab]);

  // When the workspace changes, reload tabs from the new workspace's storage
  const prevWsKey = useRef(wsKey);
  useEffect(() => {
    if (prevWsKey.current === wsKey) return;
    prevWsKey.current = wsKey;
    const tabs   = lsGet<string[]>(tabsKey, []);
    const active = lsGet<string | null>(`${tabsKey}.active`, null);
    setOpenTabs(tabs);
    setActiveTabRaw(active && tabs.includes(active) ? active : (tabs[0] ?? null));
    setTabStates({});
  }, [wsKey, tabsKey]);

  // ── UI state — editor preferences persisted across sessions ──────────────
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [wordWrap, setWordWrapRaw]    = useState<"on" | "off">(() => lsGet<"on" | "off">("vesper.editor.wordWrap", "off"));
  const [fontSize, setFontSizeRaw]    = useState<number>(() => lsGet<number>("vesper.editor.fontSize", 14));
  const [cursorPos, setCursorPos]     = useState({ line: 1, col: 1 });
  const [isSaving, setIsSaving]       = useState(false);

  const setWordWrap = useCallback((v: "on" | "off" | ((prev: "on" | "off") => "on" | "off")) => {
    setWordWrapRaw(prev => {
      const next = typeof v === "function" ? v(prev) : v;
      lsSet("vesper.editor.wordWrap", next);
      return next;
    });
  }, []);

  const setFontSize = useCallback((v: number | ((prev: number) => number)) => {
    setFontSizeRaw(prev => {
      const next = typeof v === "function" ? v(prev) : v;
      lsSet("vesper.editor.fontSize", next);
      return next;
    });
  }, []);

  // ── Right-click context menu ──────────────────────────────────────────────
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);

  // Dismiss context menu on Escape or click-outside
  useEffect(() => {
    if (!contextMenu) return;
    const onKey   = (e: KeyboardEvent) => { if (e.key === "Escape") setContextMenu(null); };
    const onClick  = () => setContextMenu(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [contextMenu]);

  const openContextMenu = useCallback((e: React.MouseEvent, tab: string) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, tab });
  }, []);

  // Monaco editor + Monaco API refs (so we can call them imperatively)
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

  // Tab bar ref — for scrolling active tab into view
  const tabBarRef    = useRef<HTMLDivElement>(null);
  const activeTabRef = useRef<HTMLDivElement>(null);

  // Auto-save debounce timer
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── API hooks ───────────────────────────────────────────────────────────────
  const { data: fileData } = useReadFile(
    { path: activeTab || "" },
    {
      query: {
        enabled: !!activeTab && !tabStates[activeTab]?.loaded,
        queryKey: getReadFileQueryKey({ path: activeTab || "" }),
      },
    },
  );
  const writeFileMutation = useWriteFile();

  // Load file content once fetched
  useEffect(() => {
    if (fileData && activeTab && !tabStates[activeTab]?.loaded) {
      setTabStates(prev => ({
        ...prev,
        [activeTab]: {
          content: fileData.content,
          savedContent: fileData.content,
          loaded: true,
        },
      }));
    }
  }, [fileData, activeTab]);

  // ── Open a file (called from FileExplorer via IDE context) ──────────────────
  const openFile = useCallback((path: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
    setActiveTab(path);
  }, [setActiveTab]);

  useEffect(() => {
    theRef.current = openFile;
    return () => { theRef.current = null; };
  }, [openFile, theRef]);

  // ── Force-reload a file (called by autonomous agent after writing) ────────────
  // Clears the loaded flag so the read query re-enables, fetching fresh content
  // from disk. Safe to call whether the file is already open or brand-new.
  const reloadFile = useCallback((path: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
    setTabStates(prev => {
      if (!prev[path]) return prev; // not cached yet — normal load path handles it
      return { ...prev, [path]: { ...prev[path], loaded: false } };
    });
    setActiveTab(path);
  }, [setActiveTab]);

  useEffect(() => {
    theReloadRef.current = reloadFile;
    return () => { theReloadRef.current = null; };
  }, [reloadFile, theReloadRef]);

  // ── Open a new empty untitled tab ────────────────────────────────────────────
  const untitledCount = useRef(0);
  const openNewTab = useCallback(() => {
    untitledCount.current += 1;
    const path = `__untitled_${untitledCount.current}__`;
    setOpenTabs(prev => [...prev, path]);
    setActiveTab(path);
    setTabStates(prev => ({
      ...prev,
      [path]: { content: "", savedContent: "", loaded: true },
    }));
  }, [setActiveTab]);

  // ── Close a tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback((path: string, e: React.MouseEvent | { stopPropagation: () => void }) => {
    e.stopPropagation();
    const next = openTabs.filter(p => p !== path);
    const idx  = openTabs.indexOf(path);
    // Switch to adjacent tab first, then remove (avoids stale closure inside updater)
    if (activeTab === path) setActiveTab(next[Math.max(0, idx - 1)] ?? null);
    setOpenTabs(next);
    // Free the cached content to avoid memory accumulation
    setTabStates(prev => { const s = { ...prev }; delete s[path]; return s; });
  }, [activeTab, openTabs, setActiveTab]);

  // ── Close Others / Close All ─────────────────────────────────────────────────
  const closeOthers = useCallback((keepPath: string) => {
    const removed = openTabs.filter(p => p !== keepPath);
    setOpenTabs([keepPath]);
    setActiveTab(keepPath);
    setTabStates(prev => {
      const s = { ...prev };
      removed.forEach(p => delete s[p]);
      return s;
    });
  }, [openTabs, setActiveTab]);

  const closeAll = useCallback(() => {
    setOpenTabs([]);
    setActiveTab(null);
    setTabStates({});
  }, [setActiveTab]);

  // ── Copy file path to clipboard ───────────────────────────────────────────
  const copyPath = useCallback((path: string) => {
    navigator.clipboard.writeText(path).then(
      ()  => toast.success("Path copied to clipboard"),
      ()  => toast.error("Failed to copy path"),
    );
  }, []); // toast is a stable Sonner import

  // ── Derived state ───────────────────────────────────────────────────────────
  const currentState = activeTab ? tabStates[activeTab] : null;
  const isDirty = !!(currentState && currentState.content !== currentState.savedContent);

  // ── Save the current file ────────────────────────────────────────────────────
  const handleSave = useCallback(async (path = activeTab) => {
    if (!path) return;
    // Untitled tabs aren't backed by real files — skip silently (auto-save fires on them too)
    if (path.startsWith("__untitled_")) return;
    const state = tabStates[path];
    if (!state?.loaded) return;
    setIsSaving(true);
    try {
      await writeFileMutation.mutateAsync({ data: { path, content: state.content } });
      setTabStates(prev => ({
        ...prev,
        [path]: { ...prev[path], savedContent: prev[path].content },
      }));
    } catch {
      toast.error("Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [activeTab, tabStates, writeFileMutation]);

  // ── Run current file in the workspace venv / node ───────────────────────────
  // Supports: .py (python via venv), .js/.mjs/.cjs (node), .sh (bash)
  // Auto-saves first so the file on disk is always up-to-date before execution.
  const RUNNABLE_EXT = new Set(["py", "js", "mjs", "cjs", "sh", "ts"]);
  const runFile = useCallback(async () => {
    if (!activeTab || activeTab.startsWith("__untitled_")) {
      toast.error("Cannot run an unsaved file", { description: "Save the file first." });
      return;
    }
    const filename = activeTab.split("/").pop() ?? activeTab;
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if (!RUNNABLE_EXT.has(ext)) {
      toast.error("Cannot run this file type", { description: `No runner for .${ext} files.` });
      return;
    }
    // Auto-save first so changes are on disk
    await handleSave(activeTab);

    // Build the shell command to run the file
    let cmd: string;
    if (ext === "py") {
      // python auto-resolves to the workspace .venv via PATH override in the backend
      cmd = `python "${activeTab}"`;
    } else if (["js", "mjs", "cjs"].includes(ext)) {
      cmd = `node "${activeTab}"`;
    } else if (ext === "ts") {
      cmd = `npx tsx "${activeTab}"`;
    } else {
      cmd = `bash "${activeTab}"`;
    }

    // Determine cwd: workspace directory if available, else repo root
    const wsCwd = currentWorkspace
      ? `/home/runner/workspace/${currentWorkspace.relPath}`
      : `/home/runner/workspace`;

    const wsId = currentWorkspace?.id ?? null;
    const toastId = toast.loading(`Running ${filename}…`);
    setIsRunning(true);
    setRunOutput(null);
    try {
      const res = await execMutation.mutateAsync({
        data: { command: cmd, cwd: wsCwd, workspace_id: wsId, timeout: 60 },
      });
      setRunOutput({ stdout: res.stdout, stderr: res.stderr, exitCode: res.exitCode });
      if (res.exitCode === 0) {
        toast.success(`${filename} finished`, { id: toastId, description: `Exit 0 · ${res.elapsedMs}ms` });
      } else {
        toast.error(`${filename} exited with code ${res.exitCode}`, { id: toastId });
      }
    } catch (err) {
      toast.error("Run failed", { id: toastId, description: String(err) });
    } finally {
      setIsRunning(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, currentWorkspace, handleSave, execMutation]);

  // ── Handle Monaco editor change ─────────────────────────────────────────────
  const handleEditorChange: OnChange = useCallback((value) => {
    if (!activeTab || value === undefined) return;
    setTabStates(prev => ({
      ...prev,
      [activeTab]: {
        ...(prev[activeTab] ?? { savedContent: value, loaded: true }),
        content: value,
      },
    }));

    // Debounced auto-save (1.5 s after last keystroke)
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => handleSave(activeTab), 1500);
  }, [activeTab, handleSave]);

  // ── Monaco mount — wire up cursor position and Ctrl+S ──────────────────────
  const handleEditorMount: OnMount = useCallback((editor, monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    // Track cursor position for the status bar
    editor.onDidChangeCursorPosition((e: MonacoNS.editor.ICursorPositionChangedEvent) => {
      setCursorPos({ line: e.position.lineNumber, col: e.position.column });
    });

    // Ctrl/Cmd+S → save (uses the monaco API directly, no window.monaco hacks)
    editor.addCommand(
      monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS,
      () => handleSave(),
    );
  }, [handleSave]);

  // ── Apply AI suggestion directly into editor ─────────────────────────────
  const applyToEditor = useCallback((code: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    const model = editor.getModel();
    if (!model) return;
    // Replace the entire file content with the suggestion
    model.setValue(code);
    toast.success("Applied — auto-saving…");
  }, []); // toast is a stable Sonner import

  // ── Global keyboard shortcuts ───────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Ctrl+S — save (Monaco also handles this, but catch it outside the editor too)
      if (ctrl && e.key === "s" && activeTab) { e.preventDefault(); handleSave(); }
      // Ctrl+W — close current tab
      if (ctrl && e.key === "w" && activeTab) {
        e.preventDefault();
        closeTab(activeTab, { stopPropagation: () => {} });
      }
      // Ctrl+T — open new untitled tab
      if (ctrl && e.key === "t") {
        e.preventDefault();
        openNewTab();
      }
      // Ctrl+P — command palette (file search)
      if (ctrl && e.key === "p") {
        e.preventDefault();
        openCommandPalette();
      }
      // Ctrl+Tab / Ctrl+Shift+Tab — cycle through open tabs
      if (ctrl && e.key === "Tab" && openTabs.length > 1) {
        e.preventDefault();
        const idx  = activeTab ? openTabs.indexOf(activeTab) : 0;
        const next = e.shiftKey
          ? openTabs[(idx - 1 + openTabs.length) % openTabs.length]
          : openTabs[(idx + 1) % openTabs.length];
        setActiveTab(next);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, activeTab, closeTab, openNewTab, openCommandPalette, openTabs, setActiveTab]);

  // ── Vesper Monaco theme — zinc/violet palette ─────────────────────────────
  const handleBeforeMount = useCallback((monaco: typeof MonacoNS) => {
    monaco.editor.defineTheme("vesper-dark", {
      base: "vs-dark",
      inherit: true,
      rules: [
        { token: "comment",           foreground: "4a4a72", fontStyle: "italic" },
        { token: "keyword",           foreground: "a78bfa" },  // violet-400
        { token: "string",            foreground: "6ee7b7" },  // emerald-300
        { token: "number",            foreground: "fbbf24" },  // amber-400
        { token: "type",              foreground: "67e8f9" },  // cyan-300
        { token: "identifier",        foreground: "c4b5fd" },  // violet-300
        { token: "delimiter",         foreground: "8080b0" },
        { token: "variable",          foreground: "e2e8f0" },  // slate-200
        { token: "function",          foreground: "93c5fd" },  // blue-300
        { token: "class",             foreground: "f9a8d4" },  // pink-300
        { token: "interface",         foreground: "67e8f9" },  // cyan-300
        { token: "operator",          foreground: "c084fc" },  // purple-400
        { token: "tag",               foreground: "a78bfa" },
        { token: "attribute.name",    foreground: "fbbf24" },
        { token: "attribute.value",   foreground: "6ee7b7" },
      ],
      colors: {
        "editor.background":                "#0d0d12",
        "editor.foreground":                "#d4d4e8",
        "editorLineNumber.foreground":      "#3a3a58",
        "editorLineNumber.activeForeground":"#6868a0",
        "editor.selectionBackground":       "#3b2d6b80",
        "editor.inactiveSelectionBackground":"#2a2040",
        "editorCursor.foreground":          "#a78bfa",
        "editorWhitespace.foreground":      "#1e1e2e",
        "editorIndentGuide.background1":    "#1a1a2e",
        "editorIndentGuide.activeBackground1": "#2e2e4e",
        "editor.lineHighlightBackground":   "#111118",
        "editorBracketMatch.background":    "#3b2d6b40",
        "editorBracketMatch.border":        "#a78bfa60",
        "scrollbar.shadow":                 "#00000000",
        "scrollbarSlider.background":       "#1e1e3040",
        "scrollbarSlider.hoverBackground":  "#2a2a4880",
        "scrollbarSlider.activeBackground": "#3a3a6080",
        "editorSuggestWidget.background":   "#0e0e18",
        "editorSuggestWidget.border":       "#1e1e30",
        "editorSuggestWidget.selectedBackground": "#2a1e4a",
        "editorHoverWidget.background":     "#0e0e18",
        "editorHoverWidget.border":         "#1e1e30",
      },
    });
  }, []);

  // ── Monaco editor options (memo to avoid full re-mount on every render) ────
  const monacoOptions = useMemo((): MonacoNS.editor.IStandaloneEditorConstructionOptions => ({
    theme: "vesper-dark",
    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    fontLigatures: !mobile, // ligatures hurt perf on low-end devices
    wordWrap,
    lineNumbers: "on",
    // Minimap wastes GPU on small/low-end screens; disable it on mobile
    minimap: { enabled: !mobile, scale: 1 },
    scrollBeyondLastLine: false,
    renderWhitespace: "selection",
    bracketPairColorization: { enabled: true },
    guides: { bracketPairs: true, indentation: true },
    suggestOnTriggerCharacters: true,
    quickSuggestions: { other: true, comments: false, strings: false },
    tabSize: 2,
    insertSpaces: true,
    autoIndent: "full",
    formatOnPaste: true,
    formatOnType: true,
    scrollbar: {
      vertical: "auto",
      horizontal: "auto",
      verticalScrollbarSize: mobile ? 3 : 6,
      horizontalScrollbarSize: mobile ? 3 : 6,
    },
    overviewRulerLanes: mobile ? 0 : 3,
    cursorBlinking: mobile ? "blink" : "smooth",
    cursorSmoothCaretAnimation: mobile ? "off" : "on",
    smoothScrolling: !mobile,
    padding: { top: 8, bottom: 8 },
    // Enable IntelliSense features
    suggest: { showKeywords: true, showSnippets: true, showClasses: true, showFunctions: true },
    parameterHints: { enabled: true },
    hover: { enabled: !mobile }, // hover dialogs are frustrating on touch
    contextmenu: !mobile,       // long-press context menu conflicts with native scroll
    multiCursorModifier: "alt",
    accessibilitySupport: "off", // improves perf in Replit
  }), [fontSize, wordWrap, mobile]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0d0d12]">
      {/* ── Tab strip ────────────────────────────────────────────────────────── */}
      <div ref={tabBarRef} className="flex items-center border-b border-[#1a1a24] bg-[#0a0a0c] overflow-x-auto shrink-0 h-9 scroll-smooth"
        style={{ scrollbarWidth: "none" }}>
        {openTabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 text-[#7878a8] text-xs select-none">
            <FilePlus className="h-3.5 w-3.5" />
            <span>Open a file from the Explorer</span>
          </div>
        ) : (
          openTabs.map(tab => {
            const isUntitled = tab.startsWith("__untitled_");
            const name = isUntitled
              ? `Untitled ${tab.replace("__untitled_", "").replace("__", "")}`
              : (tab.split("/").pop() ?? tab);
            const isActive = tab === activeTab;
            const dirty = !!(tabStates[tab] && tabStates[tab].content !== tabStates[tab].savedContent);
            return (
              <div
                key={tab}
                ref={isActive ? activeTabRef : undefined}
                onClick={() => setActiveTab(tab)}
                onContextMenu={e => openContextMenu(e, tab)}
                className={`flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer border-r border-[#1a1a24] shrink-0 group transition-colors ${
                  isActive
                    ? "bg-[#0d0d12] text-foreground border-t-2 border-t-violet-500"
                    : "bg-[#0a0a0c] text-[#9898b8] hover:bg-[#111118] hover:text-[#a0a0c0]"
                }`}
                title={tab}
              >
                <TabIcon name={name} />
                <span className="font-medium">{name}</span>
                {/* Unsaved indicator dot */}
                {dirty && !isSaving && (
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" title="Unsaved changes" />
                )}
                {/* Saving spinner */}
                {dirty && isSaving && <Loader2 className="h-2.5 w-2.5 animate-spin text-[#9898b8] shrink-0" />}
                <button
                  onClick={e => closeTab(tab, e)}
                  className="h-5 w-5 flex items-center justify-center rounded
                    opacity-60 md:opacity-0 md:group-hover:opacity-100
                    transition-opacity text-[#9898b8] hover:text-foreground hover:bg-[#1e1e2e]
                    active:bg-[#1e1e2e] touch-manipulation"
                  title="Close tab (Ctrl+W)"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })
        )}

        {/* Right-side toolbar */}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          {/* Command Palette */}
          <button
            onClick={openCommandPalette}
            className="hidden md:flex h-6 w-6 items-center justify-center rounded text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-colors"
            title="Open file (Ctrl+P)"
          >
            <Search className="h-3 w-3" />
          </button>
          {/* New tab button always visible */}
          <button
            onClick={openNewTab}
            className="h-6 w-6 flex items-center justify-center rounded text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-colors"
            title="New untitled tab (Ctrl+T)"
          >
            <FilePlus className="h-3 w-3" />
          </button>
          {activeTab && (
            <>
              <button
                onClick={() => setWordWrap(w => w === "on" ? "off" : "on")}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                  wordWrap === "on" ? "text-primary bg-primary/10" : "text-[#9898b8] hover:text-foreground hover:bg-[#141420]"
                }`}
                title="Toggle word wrap (Alt+Z)"
              >
                <WrapText className="h-3 w-3" />
              </button>
              <button
                onClick={() => setFontSize(s => Math.min(s + 1, 24))}
                className="h-6 w-6 flex items-center justify-center rounded text-[#9898b8] hover:text-foreground hover:bg-[#141420]"
                title="Increase font size"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
              <button
                onClick={() => setFontSize(s => Math.max(s - 1, 10))}
                className="h-6 w-6 flex items-center justify-center rounded text-[#9898b8] hover:text-foreground hover:bg-[#141420]"
                title="Decrease font size"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleSave()}
                disabled={!isDirty || isSaving}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                  isDirty ? "text-primary hover:bg-primary/10" : "text-[#7878a8]"
                }`}
                title="Save (Ctrl+S)"
              >
                {isSaving
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Save className="h-3 w-3" />}
              </button>
              {/* Run file button — only for runnable extensions */}
              {activeTab && !activeTab.startsWith("__untitled_") && (() => {
                const ext = activeTab.split(".").pop()?.toLowerCase() ?? "";
                const runnable = ["py", "js", "mjs", "cjs", "sh", "ts"].includes(ext);
                if (!runnable) return null;
                // For Python files, show venv status in the tooltip
                const pyVenvHint = ext === "py"
                  ? venvStatus?.healthy
                    ? ` · venv active (${venvStatus.python_version})`
                    : " · no venv (will use system python)"
                  : "";
                return (
                  <button
                    onClick={runFile}
                    disabled={isRunning}
                    className="h-6 w-6 flex items-center justify-center rounded transition-colors text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/10 disabled:opacity-40"
                    title={`Run file${pyVenvHint}`}
                  >
                    {isRunning
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <Play className="h-3 w-3" />}
                  </button>
                );
              })()}
              <button
                onClick={() => setShowAiPanel(a => !a)}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                  showAiPanel ? "text-primary bg-primary/10" : "text-[#9898b8] hover:text-foreground hover:bg-[#141420]"
                }`}
                title="AI assistant (Zap)"
              >
                <Zap className="h-3 w-3" />
              </button>
            </>
          )}
        </div>
      </div>

      {/* ── Editor body ──────────────────────────────────────────────────────── */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!activeTab ? (
          /* ── Premium empty state ─────────────────────────────────────── */
          <div className="flex flex-col items-center justify-center h-full gap-6 text-center px-8 select-none">

            {/* Logo glow */}
            <div className="relative flex flex-col items-center gap-3">
              <div className="absolute inset-0 -m-8 blur-3xl bg-primary/5 rounded-full pointer-events-none" />
              <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-[#1a1a2e] to-[#0d0d12]
                border border-[#1e1e2e] flex items-center justify-center
                shadow-[0_0_40px_rgba(99,102,241,0.06),inset_0_1px_0_rgba(255,255,255,0.04)]">
                <FileCode className="h-6 w-6 text-[#7878a8]" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#7878a8] tracking-tight">Open a file to begin</p>
                <p className="text-[11px] text-[#7878a8] mt-1">
                  Select from the Explorer or create a new file
                </p>
              </div>
            </div>

            {/* Keyboard shortcut grid */}
            <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
              {[
                { keys: ["Ctrl", "S"],        label: "Save file" },
                { keys: ["Ctrl", "W"],        label: "Close tab" },
                { keys: ["Ctrl", "T"],        label: "New untitled tab" },
                { keys: ["Ctrl", "Tab"],      label: "Next tab" },
                { keys: ["Ctrl", "⇧", "Tab"], label: "Previous tab" },
                { keys: ["Ctrl", "`"],        label: "Toggle terminal" },
                { keys: ["Ctrl", "J"],        label: "Toggle chat" },
              ].map(({ keys, label }) => (
                <div
                  key={label}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg
                    bg-[#0a0a0e] border border-[#141420] group hover:border-[#1e1e2e] transition-colors"
                >
                  <span className="text-[11px] text-[#7878a8] group-hover:text-[#7878a8] transition-colors">{label}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <kbd className="text-[9px] font-bold font-mono text-[#7878a8] group-hover:text-[#9898b8]
                          bg-[#141420] border border-[#1e1e2e] rounded px-1.5 py-0.5 transition-colors">
                          {k}
                        </kbd>
                        {i < keys.length - 1 && (
                          <span className="text-[9px] text-[#7070a0]">+</span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>

          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            {/* Monaco editor */}
            <ResizablePanel defaultSize={showAiPanel ? 60 : 100} minSize={35}>
              <div className="h-full">
                {currentState?.loaded ? (
                  <MonacoEditor
                    height="100%"
                    language={getMonacoLanguage(activeTab)}
                    value={currentState.content}
                    options={monacoOptions}
                    beforeMount={handleBeforeMount}
                    onChange={handleEditorChange}
                    onMount={handleEditorMount}
                    loading={
                      <div className="flex items-center justify-center h-full text-[#9898b8]">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    }
                  />
                ) : (
                  /* Loading skeleton while file data is fetched */
                  <div className="flex flex-col gap-3 p-6 h-full bg-[#0d0d14]">
                    <div className="flex items-center gap-2 mb-2">
                      <Skeleton className="h-3 w-16 bg-[#1e1e2e]" />
                      <Skeleton className="h-3 w-8 bg-[#1e1e2e]" />
                    </div>
                    {[70, 90, 55, 80, 45, 65, 88, 40, 72, 60].map((w, i) => (
                      <Skeleton
                        key={i}
                        className="h-3 bg-[#1e1e2e]"
                        style={{ width: `${w}%`, animationDelay: `${i * 0.04}s` }}
                      />
                    ))}
                    <div className="mt-2">
                      <Skeleton className="h-3 w-1/3 bg-[#1e1e2e]" style={{ animationDelay: "0.45s" }} />
                    </div>
                  </div>
                )}
              </div>
            </ResizablePanel>

            {/* AI assistant panel */}
            {showAiPanel && (
              <>
                <ResizableHandle className="w-px bg-[#1a1a24] hover:bg-primary/40 transition-colors cursor-col-resize" />
                <ResizablePanel defaultSize={40} minSize={25} maxSize={55}>
                  <AiSidePanel
                    activeTab={activeTab}
                    tabContent={currentState?.content ?? ""}
                    onApply={applyToEditor}
                    onClose={() => setShowAiPanel(false)}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      </div>

      {/* ── Run output panel — appears when a file has been executed ─────────── */}
      {runOutput !== null && (
        <div className="shrink-0 border-t border-[#1a1a24] bg-[#0a0a10] max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1 border-b border-[#1a1a24]">
            <div className="flex items-center gap-2 text-[10px] font-mono">
              <span className={`px-1.5 py-0.5 rounded font-mono ${
                runOutput.exitCode === 0
                  ? "bg-emerald-900/40 text-emerald-400"
                  : "bg-red-900/40 text-red-400"
              }`}>
                {runOutput.exitCode === 0 ? "✓ Exit 0" : `✗ Exit ${runOutput.exitCode}`}
              </span>
              <span className="text-[#7878a8]">Output</span>
            </div>
            <button
              className="text-[#7878a8] hover:text-foreground transition-colors p-0.5 rounded"
              onClick={() => setRunOutput(null)}
              title="Dismiss output"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="p-3 font-mono text-xs leading-relaxed space-y-1">
            {runOutput.stdout && (
              <pre className="text-emerald-300 whitespace-pre-wrap break-all">{runOutput.stdout}</pre>
            )}
            {runOutput.stderr && (
              <pre className="text-red-400 whitespace-pre-wrap break-all">{runOutput.stderr}</pre>
            )}
            {!runOutput.stdout && !runOutput.stderr && (
              <span className="text-[#7878a8]">(no output)</span>
            )}
          </div>
        </div>
      )}

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-3 h-5 bg-[#0a0a0c] border-t border-[#1a1a24] text-[10px] text-[#7878a8] font-mono select-none">
        <div className="flex items-center gap-3">
          {activeTab && <span className="text-[#9898b8]">{getLangLabel(activeTab)}</span>}
          {isDirty && !isSaving && <span className="text-amber-400 flex items-center gap-1">● Unsaved</span>}
          {isSaving   && <span className="text-[#9898b8] flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" /> Saving…</span>}
        </div>
        {activeTab && (
          <div className="flex items-center gap-3">
            <span>UTF-8</span>
            <span>Spaces: 2</span>
            <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
          </div>
        )}
      </div>

      {/* ── Tab right-click context menu ─────────────────────────────────────── */}
      {contextMenu && (
        <div
          className="fixed z-[200] min-w-[180px] py-1 rounded-xl
            bg-[#0e0e16] border border-[#1e1e30]
            shadow-[0_8px_40px_rgba(0,0,0,0.6)]
            text-xs text-foreground"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onMouseDown={e => e.stopPropagation()} // prevent click-outside dismissal when clicking items
        >
          {/* Close */}
          <button
            onClick={() => { closeTab(contextMenu.tab, { stopPropagation: () => {} }); setContextMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[#1e1e2e] transition-colors"
          >
            <X className="h-3 w-3 text-[#9898b8]" />
            Close
          </button>

          {/* Close Others */}
          {openTabs.length > 1 && (
            <button
              onClick={() => { closeOthers(contextMenu.tab); setContextMenu(null); }}
              className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[#1e1e2e] transition-colors"
            >
              <FolderX className="h-3 w-3 text-[#9898b8]" />
              Close Others
            </button>
          )}

          {/* Close All */}
          <button
            onClick={() => { closeAll(); setContextMenu(null); }}
            className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[#1e1e2e] transition-colors"
          >
            <XCircle className="h-3 w-3 text-[#9898b8]" />
            Close All
          </button>

          {/* Separator */}
          {!contextMenu.tab.startsWith("__untitled_") && (
            <>
              <div className="my-1 border-t border-[#1e1e2e]" />

              {/* Copy Path */}
              <button
                onClick={() => { copyPath(contextMenu.tab); setContextMenu(null); }}
                className="w-full flex items-center gap-2.5 px-3 py-1.5 hover:bg-[#1e1e2e] transition-colors text-[#9898b8]"
              >
                <Copy className="h-3 w-3" />
                Copy Path
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
