import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  useReadFile, getReadFileQueryKey, useWriteFile,
  useListAis, getListAisQueryKey, useAskAiWithContext,
  FileNode,
} from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  FileIcon, FileCode, FileText, FileJson,
  Save, Loader2, MessageSquare, X, RefreshCw,
  WrapText, ZoomIn, ZoomOut, Copy, Check,
  FilePlus, ChevronDown, Zap, AlertCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import CodeMirror, { EditorView } from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json as jsonLang } from "@codemirror/lang-json";
import { markdown as markdownLang } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";
import { search } from "@codemirror/search";
import { autocompletion } from "@codemirror/autocomplete";
import { useIDE } from "@/contexts/ide-context";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";

// ── Language helpers ──────────────────────────────────────────────────────────
function getLangExtension(filename: string) {
  if (!filename) return [];
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs"].includes(ext)) return [javascript({ jsx: true, typescript: true })];
  if (ext === "py") return [python()];
  if (ext === "css") return [css()];
  if (["html", "htm", "svelte", "vue"].includes(ext)) return [html()];
  if (ext === "json") return [jsonLang()];
  if (["md", "mdx"].includes(ext)) return [markdownLang()];
  if (ext === "rs") return [rust()];
  if (["sql", "psql"].includes(ext)) return [sql()];
  return [];
}

function getLangLabel(filename: string): string {
  if (!filename) return "Plain Text";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "JavaScript", jsx: "JSX", ts: "TypeScript", tsx: "TSX",
    py: "Python", css: "CSS", html: "HTML", json: "JSON",
    md: "Markdown", rs: "Rust", sql: "SQL", sh: "Shell",
    yaml: "YAML", toml: "TOML", go: "Go",
  };
  return map[ext] ?? "Plain Text";
}

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return <FileCode className="h-3 w-3 text-blue-400" />;
  if (ext === "json") return <FileJson className="h-3 w-3 text-yellow-400" />;
  if (["md", "mdx"].includes(ext)) return <FileText className="h-3 w-3 text-slate-400" />;
  if (ext === "py") return <FileCode className="h-3 w-3 text-green-400" />;
  if (ext === "css") return <FileCode className="h-3 w-3 text-pink-400" />;
  if (["html", "htm"].includes(ext)) return <FileCode className="h-3 w-3 text-orange-400" />;
  return <FileIcon className="h-3 w-3 text-[#52526e]" />;
}

interface TabState { content: string; savedContent: string; loaded: boolean; }
interface AiMsg { role: "user" | "assistant"; content: string; error?: boolean; }

// ── AI sidebar panel ──────────────────────────────────────────────────────────
function AiSidePanel({
  activeTab, tabContent, onApply, onClose,
}: {
  activeTab: string | null; tabContent: string; onApply: (code: string) => void; onClose: () => void;
}) {
  const { selectedAi } = useIDE();
  const { data: aisData } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [prompt, setPrompt] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const askAiWithContext = useAskAiWithContext();
  const isPending = askAiWithContext.isPending;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const resolveAi = () => {
    if (selectedAi === "__auto__") return aisData?.ais?.find((a: any) => a.hasSession)?.id ?? "pollinations";
    return selectedAi;
  };

  const sendMessage = async (text: string) => {
    if (!text.trim() || isPending) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    setPrompt("");
    const files = activeTab && tabContent ? [{ path: activeTab, content: tabContent }] : [];
    try {
      const result = await askAiWithContext.mutateAsync({ data: { aiId: resolveAi(), prompt: text, files } });
      setMessages(prev => [...prev, result.success
        ? { role: "assistant", content: result.response }
        : { role: "assistant", content: result.error || "Failed", error: true }
      ]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Error occurred.", error: true }]);
    }
  };

  const QUICK_ACTIONS = [
    { label: "Explain", prompt: "Please explain what this code does in detail." },
    { label: "Fix bugs", prompt: "Find and fix any bugs in this code." },
    { label: "Refactor", prompt: "Refactor this code for better readability and performance." },
    { label: "Write tests", prompt: "Write comprehensive unit tests for this code." },
  ];

  const applyCode = (content: string) => {
    const match = content.match(/```[\w]*\n([\s\S]*?)```/);
    if (match?.[1]) onApply(match[1].trim());
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] border-l border-[#1a1a24]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a24] shrink-0">
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-bold text-[#a0a0c0]">AI Assistant</span>
        </div>
        <button onClick={onClose} className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420]">
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Quick actions */}
      <div className="flex gap-1 px-2 py-1.5 border-b border-[#1a1a24] shrink-0 flex-wrap">
        {QUICK_ACTIONS.map(a => (
          <button
            key={a.label}
            onClick={() => sendMessage(a.prompt)}
            disabled={!activeTab || isPending}
            className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-[#141420] hover:bg-[#1e1e2e] border border-[#1a1a24] text-[#a0a0c0] hover:text-foreground disabled:opacity-40 transition-all"
          >{a.label}</button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-2 space-y-2" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="text-center py-6 text-[#52526e] text-xs">
            {activeTab ? "Ask about your code or use a quick action above." : "Open a file to get started."}
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`text-xs rounded-xl px-3 py-2 ${
            msg.role === "user"
              ? "bg-[#1e1e2e] border border-[#2a2a40] text-foreground ml-4"
              : msg.error ? "text-red-400 bg-red-500/10 border border-red-500/20" : "text-foreground"
          }`}>
            {msg.role === "user" ? msg.content : (
              <div>
                <MarkdownRenderer content={msg.content} />
                {/```/.test(msg.content) && (
                  <button
                    onClick={() => applyCode(msg.content)}
                    className="mt-2 text-[10px] font-bold px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                  >Apply to editor</button>
                )}
              </div>
            )}
          </div>
        ))}
        {isPending && (
          <div className="flex items-center gap-1.5 text-[#52526e] text-xs px-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
          </div>
        )}
      </div>

      {/* Input */}
      <div className="shrink-0 px-2 py-2 border-t border-[#1a1a24]">
        <div className="flex gap-1">
          <input
            className="flex-1 bg-[#141420] border border-[#1a1a24] focus:border-primary/40 rounded-lg px-2.5 py-1.5 text-xs outline-none text-foreground placeholder:text-[#3a3a5c]"
            placeholder="Ask about this code…"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(prompt); } }}
            disabled={isPending}
          />
          <button
            onClick={() => sendMessage(prompt)}
            disabled={isPending || !prompt.trim()}
            className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40 transition-colors"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <MessageSquare className="h-3 w-3" />}
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

  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});
  const [showAiPanel, setShowAiPanel] = useState(false);
  const [wordWrap, setWordWrap] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

  const { data: fileData } = useReadFile(
    { path: activeTab || "" },
    { query: { enabled: !!activeTab && !tabStates[activeTab]?.loaded, queryKey: getReadFileQueryKey({ path: activeTab || "" }) } }
  );

  useEffect(() => {
    if (fileData && activeTab && !tabStates[activeTab]?.loaded) {
      setTabStates(prev => ({
        ...prev,
        [activeTab]: { content: fileData.content, savedContent: fileData.content, loaded: true },
      }));
    }
  }, [fileData, activeTab]);

  const openFile = useCallback((path: string) => {
    setOpenTabs(prev => prev.includes(path) ? prev : [...prev, path]);
    setActiveTab(path);
  }, []);

  // Register with IDE context so file explorer can open files
  useEffect(() => {
    onOpenFileRef.current = openFile;
    return () => { onOpenFileRef.current = null; };
  }, [openFile, onOpenFileRef]);

  const closeTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const idx = prev.indexOf(path);
      const next = prev.filter(p => p !== path);
      if (activeTab === path) setActiveTab(next[Math.max(0, idx - 1)] ?? null);
      return next;
    });
  }, [activeTab]);

  const currentState = activeTab ? tabStates[activeTab] : null;
  const isDirty = !!(currentState && currentState.content !== currentState.savedContent);

  const handleEditorChange = useCallback((val: string) => {
    if (!activeTab) return;
    setTabStates(prev => ({
      ...prev,
      [activeTab]: { ...(prev[activeTab] ?? { savedContent: val, loaded: true }), content: val },
    }));
  }, [activeTab]);

  const writeFile = useWriteFile();
  const handleSave = useCallback(async () => {
    if (!activeTab || !currentState) return;
    try {
      await writeFile.mutateAsync({ data: { path: activeTab, content: currentState.content } });
      setTabStates(prev => ({ ...prev, [activeTab]: { ...prev[activeTab], savedContent: prev[activeTab].content } }));
      toast({ description: `Saved ${activeTab.split("/").pop()}` });
    } catch {
      toast({ description: "Failed to save", variant: "destructive" });
    }
  }, [activeTab, currentState, writeFile, toast]);

  const cmExtensions = useMemo(() => [
    ...getLangExtension(activeTab ?? ""),
    search({ top: true }),
    autocompletion(),
    EditorView.updateListener.of(update => {
      if (update.selectionSet) {
        const pos = update.state.selection.main.head;
        const line = update.state.doc.lineAt(pos);
        setCursorPos({ line: line.number, col: pos - line.from + 1 });
      }
    }),
    ...(wordWrap ? [EditorView.lineWrapping] : []),
    EditorView.theme({ "&": { fontSize: `${fontSize}px` } }),
  ], [activeTab, wordWrap, fontSize]);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); handleSave(); }
      if ((e.ctrlKey || e.metaKey) && e.key === "w") {
        e.preventDefault();
        if (activeTab) closeTab(activeTab, { stopPropagation: () => {} } as any);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleSave, activeTab, closeTab]);

  const editorContent = (
    <div className="flex flex-col h-full bg-[#0d0d12]">
      {/* Tab bar */}
      <div className="flex items-center border-b border-[#1a1a24] bg-[#0a0a0c] overflow-x-auto shrink-0 h-9">
        {openTabs.length === 0 ? (
          <div className="flex items-center gap-2 px-4 text-[#3a3a5c] text-xs">
            <FilePlus className="h-3.5 w-3.5" />
            <span>Open a file from the Explorer</span>
          </div>
        ) : (
          openTabs.map(tab => {
            const name = tab.split("/").pop() ?? tab;
            const isActive = tab === activeTab;
            const dirty = tabStates[tab] && tabStates[tab].content !== tabStates[tab].savedContent;
            return (
              <div
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-3 h-full text-xs cursor-pointer border-r border-[#1a1a24] shrink-0 group transition-colors ${
                  isActive
                    ? "bg-[#0d0d12] text-foreground border-t border-t-primary"
                    : "bg-[#0a0a0c] text-[#52526e] hover:bg-[#111118] hover:text-[#a0a0c0]"
                }`}
              >
                {getFileIcon(name)}
                <span className="font-medium">{name}</span>
                {dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shrink-0" />}
                <button
                  onClick={e => closeTab(tab, e)}
                  className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity text-[#52526e] hover:text-foreground hover:bg-[#1e1e2e]"
                ><X className="h-2.5 w-2.5" /></button>
              </div>
            );
          })
        )}
        {/* Toolbar right */}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          {activeTab && (
            <>
              <button
                onClick={() => setWordWrap(w => !w)}
                className={`h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors ${wordWrap ? "text-primary bg-primary/10" : ""}`}
                title="Toggle word wrap"
              ><WrapText className="h-3 w-3" /></button>
              <button onClick={() => setFontSize(s => Math.min(s + 1, 22))} className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420]" title="Zoom in">
                <ZoomIn className="h-3 w-3" />
              </button>
              <button onClick={() => setFontSize(s => Math.max(s - 1, 10))} className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420]" title="Zoom out">
                <ZoomOut className="h-3 w-3" />
              </button>
              <button
                onClick={handleSave}
                disabled={!isDirty || writeFile.isPending}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${isDirty ? "text-primary hover:bg-primary/10" : "text-[#3a3a5c]"}`}
                title="Save (Ctrl+S)"
              >
                {writeFile.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Save className="h-3 w-3" />}
              </button>
              <button
                onClick={() => setShowAiPanel(a => !a)}
                className={`h-6 w-6 flex items-center justify-center rounded transition-colors ${showAiPanel ? "text-primary bg-primary/10" : "text-[#52526e] hover:text-foreground hover:bg-[#141420]"}`}
                title="AI assistant"
              ><Zap className="h-3 w-3" /></button>
            </>
          )}
        </div>
      </div>

      {/* Editor body */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {!activeTab ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-center px-4">
            <FileCode className="h-10 w-10 text-[#1e1e2e]" />
            <p className="text-[#3a3a5c] text-sm">No file open</p>
            <p className="text-[#1e1e2e] text-xs">Select a file from the Explorer to start editing</p>
          </div>
        ) : (
          <ResizablePanelGroup direction="horizontal" className="h-full">
            <ResizablePanel defaultSize={showAiPanel ? 65 : 100} minSize={40}>
              <div className="h-full overflow-auto">
                {currentState?.loaded ? (
                  <CodeMirror
                    value={currentState.content}
                    extensions={cmExtensions}
                    theme={tokyoNight}
                    onChange={handleEditorChange}
                    style={{ height: "100%", fontSize: `${fontSize}px` }}
                    basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: true, autocompletion: false }}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full text-[#52526e]">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}
              </div>
            </ResizablePanel>

            {showAiPanel && (
              <>
                <ResizableHandle className="w-px bg-[#1a1a24] hover:bg-primary/50 transition-colors" />
                <ResizablePanel defaultSize={35} minSize={25}>
                  <AiSidePanel
                    activeTab={activeTab}
                    tabContent={currentState?.content ?? ""}
                    onApply={code => { handleEditorChange(code); toast({ description: "Applied — Ctrl+S to save" }); }}
                    onClose={() => setShowAiPanel(false)}
                  />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>
        )}
      </div>

      {/* Status bar */}
      <div className="shrink-0 flex items-center justify-between px-3 h-5 bg-[#0a0a0c] border-t border-[#1a1a24] text-[10px] text-[#3a3a5c] font-mono">
        <div className="flex items-center gap-3">
          {activeTab && <span>{getLangLabel(activeTab)}</span>}
          {isDirty && <span className="text-amber-400">● Unsaved</span>}
        </div>
        {activeTab && (
          <span>Ln {cursorPos.line}, Col {cursorPos.col}</span>
        )}
      </div>
    </div>
  );

  return editorContent;
}
