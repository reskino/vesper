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
} from "@workspace/api-client-react";
import {
  FileIcon, FileCode, FileText, FileJson,
  Save, Loader2, MessageSquare, X, WrapText,
  ZoomIn, ZoomOut, FilePlus, Zap, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { useIDE } from "@/contexts/ide-context";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

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
  return <FileIcon className="h-3 w-3 text-[#52526e] shrink-0" />;
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
          className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors"
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
          <p className="text-center py-6 text-[#52526e] text-xs">
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
          <div className="flex items-center gap-1.5 text-[#52526e] text-xs px-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-2 py-2 border-t border-[#1a1a24]">
        <div className="flex gap-1">
          <input
            className="flex-1 bg-[#141420] border border-[#1a1a24] focus:border-primary/40 rounded-lg px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-[#3a3a5c] transition-colors"
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

// ── Main EditorPanel ──────────────────────────────────────────────────────────
export function EditorPanel() {
  const { onOpenFileRef } = useIDE();
  const { toast } = useToast();

  // ── Tab management ──────────────────────────────────────────────────────────
  const [openTabs, setOpenTabs]       = useState<string[]>([]);
  const [activeTab, setActiveTab]     = useState<string | null>(null);
  const [tabStates, setTabStates]     = useState<Record<string, TabState>>({});

  // ── UI state ────────────────────────────────────────────────────────────────
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [wordWrap, setWordWrap]       = useState<"on" | "off">("off");
  const [fontSize, setFontSize]       = useState(14);
  const [cursorPos, setCursorPos]     = useState({ line: 1, col: 1 });
  const [isSaving, setIsSaving]       = useState(false);

  // Monaco editor + Monaco API refs (so we can call them imperatively)
  const editorRef = useRef<MonacoNS.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof MonacoNS | null>(null);

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
  }, []);

  useEffect(() => {
    onOpenFileRef.current = openFile;
    return () => { onOpenFileRef.current = null; };
  }, [openFile, onOpenFileRef]);

  // ── Close a tab ─────────────────────────────────────────────────────────────
  const closeTab = useCallback((path: string, e: React.MouseEvent | { stopPropagation: () => void }) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const idx = prev.indexOf(path);
      const next = prev.filter(p => p !== path);
      if (activeTab === path) setActiveTab(next[Math.max(0, idx - 1)] ?? null);
      return next;
    });
  }, [activeTab]);

  // ── Derived state ───────────────────────────────────────────────────────────
  const currentState = activeTab ? tabStates[activeTab] : null;
  const isDirty = !!(currentState && currentState.content !== currentState.savedContent);

  // ── Save the current file ────────────────────────────────────────────────────
  const handleSave = useCallback(async (path = activeTab) => {
    if (!path) return;
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
      toast({ description: "Failed to save", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, [activeTab, tabStates, writeFileMutation, toast]);

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
    toast({ description: "Applied — auto-saving…" });
  }, [toast]);

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
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, activeTab, closeTab]);

  // ── Monaco editor options (memo to avoid full re-mount on every render) ────
  const monacoOptions = useMemo((): MonacoNS.editor.IStandaloneEditorConstructionOptions => ({
    theme: "vs-dark",
    fontSize,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, monospace",
    fontLigatures: true,
    wordWrap,
    lineNumbers: "on",
    minimap: { enabled: true, scale: 1 },
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
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6,
    },
    overviewRulerLanes: 3,
    cursorBlinking: "smooth",
    cursorSmoothCaretAnimation: "on",
    smoothScrolling: true,
    padding: { top: 8, bottom: 8 },
    // Enable IntelliSense features
    suggest: { showKeywords: true, showSnippets: true, showClasses: true, showFunctions: true },
    parameterHints: { enabled: true },
    hover: { enabled: true },
    contextmenu: true,
    multiCursorModifier: "alt",
    accessibilitySupport: "off", // improves perf in Replit
  }), [fontSize, wordWrap]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0d0d12]">
      {/* ── Tab strip ────────────────────────────────────────────────────────── */}
      <div className="flex items-center border-b border-[#1a1a24] bg-[#0a0a0c] overflow-x-auto shrink-0 h-9">
        {openTabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 text-[#3a3a5c] text-xs select-none">
            <FilePlus className="h-3.5 w-3.5" />
            <span>Open a file from the Explorer</span>
          </div>
        ) : (
          openTabs.map(tab => {
            const name = tab.split("/").pop() ?? tab;
            const isActive = tab === activeTab;
            const dirty = !!(tabStates[tab] && tabStates[tab].content !== tabStates[tab].savedContent);
            return (
              <div
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer border-r border-[#1a1a24] shrink-0 group transition-colors ${
                  isActive
                    ? "bg-[#0d0d12] text-foreground border-t-2 border-t-primary"
                    : "bg-[#0a0a0c] text-[#52526e] hover:bg-[#111118] hover:text-[#a0a0c0]"
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
                {dirty && isSaving && <Loader2 className="h-2.5 w-2.5 animate-spin text-[#52526e] shrink-0" />}
                <button
                  onClick={e => closeTab(tab, e)}
                  className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-[#52526e] hover:text-foreground hover:bg-[#1e1e2e]"
                  title="Close tab"
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </div>
            );
          })
        )}

        {/* Right-side toolbar */}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          {activeTab && (
            <>
              <button
                onClick={() => setWordWrap(w => w === "on" ? "off" : "on")}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                  wordWrap === "on" ? "text-primary bg-primary/10" : "text-[#52526e] hover:text-foreground hover:bg-[#141420]"
                }`}
                title="Toggle word wrap (Alt+Z)"
              >
                <WrapText className="h-3 w-3" />
              </button>
              <button
                onClick={() => setFontSize(s => Math.min(s + 1, 24))}
                className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420]"
                title="Increase font size"
              >
                <ZoomIn className="h-3 w-3" />
              </button>
              <button
                onClick={() => setFontSize(s => Math.max(s - 1, 10))}
                className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420]"
                title="Decrease font size"
              >
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                onClick={() => handleSave()}
                disabled={!isDirty || isSaving}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                  isDirty ? "text-primary hover:bg-primary/10" : "text-[#3a3a5c]"
                }`}
                title="Save (Ctrl+S)"
              >
                {isSaving
                  ? <Loader2 className="h-3 w-3 animate-spin" />
                  : <Save className="h-3 w-3" />}
              </button>
              <button
                onClick={() => setShowAiPanel(a => !a)}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${
                  showAiPanel ? "text-primary bg-primary/10" : "text-[#52526e] hover:text-foreground hover:bg-[#141420]"
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
                <FileCode className="h-6 w-6 text-[#2a2a40]" />
              </div>
              <div>
                <p className="text-[14px] font-semibold text-[#3a3a5c] tracking-tight">Open a file to begin</p>
                <p className="text-[11px] text-[#252535] mt-1">
                  Select from the Explorer or create a new file
                </p>
              </div>
            </div>

            {/* Keyboard shortcut grid */}
            <div className="flex flex-col gap-1.5 w-full max-w-[280px]">
              {[
                { keys: ["Ctrl", "S"],   label: "Save file" },
                { keys: ["Ctrl", "W"],   label: "Close tab" },
                { keys: ["Ctrl", "`"],   label: "Toggle terminal" },
                { keys: ["Ctrl", "J"],   label: "Toggle chat" },
                { keys: ["Ctrl", "N"],   label: "New chat" },
              ].map(({ keys, label }) => (
                <div
                  key={label}
                  className="flex items-center justify-between px-3 py-1.5 rounded-lg
                    bg-[#0a0a0e] border border-[#141420] group hover:border-[#1e1e2e] transition-colors"
                >
                  <span className="text-[11px] text-[#2a2a40] group-hover:text-[#3a3a5c] transition-colors">{label}</span>
                  <div className="flex items-center gap-1">
                    {keys.map((k, i) => (
                      <span key={i} className="flex items-center gap-1">
                        <kbd className="text-[9px] font-bold font-mono text-[#2a2a40] group-hover:text-[#52526e]
                          bg-[#141420] border border-[#1e1e2e] rounded px-1.5 py-0.5 transition-colors">
                          {k}
                        </kbd>
                        {i < keys.length - 1 && (
                          <span className="text-[9px] text-[#1e1e2e]">+</span>
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
                    onChange={handleEditorChange}
                    onMount={handleEditorMount}
                    loading={
                      <div className="flex items-center justify-center h-full text-[#52526e]">
                        <Loader2 className="h-5 w-5 animate-spin" />
                      </div>
                    }
                  />
                ) : (
                  /* Loading skeleton while file data is fetched */
                  <div className="flex items-center justify-center h-full text-[#52526e]">
                    <Loader2 className="h-5 w-5 animate-spin" />
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

      {/* ── Status bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-3 h-5 bg-[#0a0a0c] border-t border-[#1a1a24] text-[10px] text-[#3a3a5c] font-mono select-none">
        <div className="flex items-center gap-3">
          {activeTab && <span className="text-[#52526e]">{getLangLabel(activeTab)}</span>}
          {isDirty && !isSaving && <span className="text-amber-400 flex items-center gap-1">● Unsaved</span>}
          {isSaving   && <span className="text-[#52526e] flex items-center gap-1"><Loader2 className="h-2.5 w-2.5 animate-spin" /> Saving…</span>}
        </div>
        {activeTab && (
          <div className="flex items-center gap-3">
            <span>UTF-8</span>
            <span>Spaces: 2</span>
            <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
          </div>
        )}
      </div>
    </div>
  );
}
