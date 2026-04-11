import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { ImportExportModal } from "@/components/import-export-modal";
import {
  useGetFileTree, getGetFileTreeQueryKey,
  useReadFile, getReadFileQueryKey,
  useWriteFile, useCreateFile, useDeleteFile,
  useListAis, getListAisQueryKey,
  useAskAiWithContext,
  FileNode,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import {
  Folder, FolderOpen, FileIcon, FileCode, FileText, FileJson,
  ChevronRight, ChevronDown, Save, Loader2, MessageSquare,
  Upload, Download, Plus, Trash2, X, RefreshCw,
  WrapText, ZoomIn, ZoomOut, Check, FilePlus, FolderPlus,
  Files, Cpu, ChevronUp, AlertCircle, Zap, Copy,
  MoreVertical, TerminalSquare,
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


// ── Language helpers ───────────────────────────────────────────────────────────
function getLangExtension(filename: string) {
  if (!filename) return [];
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)) return [javascript({ jsx: true, typescript: true })];
  if (ext === "py") return [python()];
  if (ext === "css") return [css()];
  if (["html", "htm", "svelte", "vue"].includes(ext)) return [html()];
  if (ext === "json") return [jsonLang()];
  if (["md", "mdx"].includes(ext)) return [markdownLang()];
  if (ext === "rs") return [rust()];
  if (["sql", "psql"].includes(ext)) return [sql()];
  return [];
}

function getLanguageLabel(filename: string): string {
  if (!filename) return "Plain Text";
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    js: "JavaScript", jsx: "JSX", ts: "TypeScript", tsx: "TSX",
    py: "Python", css: "CSS", html: "HTML", htm: "HTML",
    json: "JSON", md: "Markdown", mdx: "MDX", rs: "Rust",
    sql: "SQL", sh: "Shell", yaml: "YAML", yml: "YAML",
    toml: "TOML", go: "Go", java: "Java", rb: "Ruby",
    php: "PHP", cpp: "C++", c: "C", cs: "C#",
  };
  return map[ext] ?? "Plain Text";
}

function getFileIcon(name: string, small = false) {
  const sz = small ? "h-3.5 w-3.5" : "h-4 w-4";
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return <FileCode className={`${sz} text-blue-400`} />;
  if (ext === "json") return <FileJson className={`${sz} text-yellow-400`} />;
  if (["md", "mdx"].includes(ext)) return <FileText className={`${sz} text-slate-400`} />;
  if (ext === "py") return <FileCode className={`${sz} text-green-400`} />;
  if (ext === "css") return <FileCode className={`${sz} text-pink-400`} />;
  if (["html", "htm"].includes(ext)) return <FileCode className={`${sz} text-orange-400`} />;
  if (ext === "rs") return <FileCode className={`${sz} text-orange-600`} />;
  if (ext === "sql") return <FileCode className={`${sz} text-sky-400`} />;
  return <FileIcon className={`${sz} text-muted-foreground`} />;
}

// ── Tab state ─────────────────────────────────────────────────────────────────
interface TabState {
  content: string;
  savedContent: string;
  loaded: boolean;
}

// ── File tree component ────────────────────────────────────────────────────────
function FileTreeItem({
  node, depth = 0, onSelect, activePath, onDelete, onNewFile, onNewFolder,
}: {
  node: FileNode; depth?: number;
  onSelect: (path: string) => void;
  activePath: string | null;
  onDelete: (path: string, isDir: boolean) => void;
  onNewFile: (dirPath: string) => void;
  onNewFolder: (dirPath: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isSelected = activePath === node.path;

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (node.name.startsWith(".")) return null;

  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-1 px-1 hover:bg-sidebar-accent/60 cursor-pointer text-sm text-sidebar-foreground group rounded-md"
          style={{ paddingLeft: `${depth * 12 + 4}px` }}
          onClick={() => setExpanded(e => !e)}
        >
          <span className="mr-1 text-muted-foreground">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {expanded
            ? <FolderOpen className="h-4 w-4 mr-1.5 text-blue-400 shrink-0" />
            : <Folder className="h-4 w-4 mr-1.5 text-blue-400 shrink-0" />}
          <span className="truncate flex-1 text-[13px] font-medium">{node.name}</span>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
            <button
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="New file here"
              onClick={() => onNewFile(node.path)}
            ><FilePlus className="h-3 w-3" /></button>
            <button
              className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
              title="New folder here"
              onClick={() => onNewFolder(node.path)}
            ><FolderPlus className="h-3 w-3" /></button>
            <div className="relative" ref={menuRef}>
              <button
                className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                onClick={() => setMenuOpen(o => !o)}
              ><MoreVertical className="h-3 w-3" /></button>
              {menuOpen && (
                <div className="absolute left-0 top-6 z-50 bg-popover border border-border rounded-xl shadow-xl py-1 min-w-[140px]">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-muted transition-colors"
                    onClick={() => { onDelete(node.path, true); setMenuOpen(false); }}
                  ><Trash2 className="h-3 w-3" /> Delete folder</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {expanded && node.children?.map(child => (
          <FileTreeItem
            key={child.path} node={child} depth={depth + 1}
            onSelect={onSelect} activePath={activePath}
            onDelete={onDelete} onNewFile={onNewFile} onNewFolder={onNewFolder}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center py-1 px-1 cursor-pointer text-sm group rounded-md ${
        isSelected
          ? "bg-primary/15 text-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
      onClick={() => onSelect(node.path)}
    >
      {getFileIcon(node.name)}
      <span className={`truncate ml-1.5 text-[13px] flex-1 ${isSelected ? "font-semibold" : ""}`}>{node.name}</span>
      <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0" onClick={e => e.stopPropagation()}>
        <div className="relative" ref={null}>
          <button
            className="h-5 w-5 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-destructive transition-colors"
            title="Delete file"
            onClick={() => onDelete(node.path, false)}
          ><Trash2 className="h-3 w-3" /></button>
        </div>
      </div>
    </div>
  );
}

// ── AI message ────────────────────────────────────────────────────────────────
interface AiMsg { role: "user" | "assistant"; content: string; error?: boolean; }

// ── NEW FILE DIALOG (inline in tree header) ────────────────────────────────────
interface NewItemState { type: "file" | "folder"; parentPath: string; }

// ── MAIN EDITOR COMPONENT ─────────────────────────────────────────────────────
export default function Editor() {
  const { toast } = useToast();

  // ── File tree ───────────────────────────────────────────────────────────────
  const { data: treeData, isLoading: treeLoading, refetch: refetchTree } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }) } }
  );
  const [showImportExport, setShowImportExport] = useState(false);
  const [newItem, setNewItem] = useState<NewItemState | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const newItemInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (newItem) setTimeout(() => newItemInputRef.current?.focus(), 50);
  }, [newItem]);

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const [openTabs, setOpenTabs] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [tabStates, setTabStates] = useState<Record<string, TabState>>({});

  // ── Active file query ────────────────────────────────────────────────────────
  const { data: fileData, isLoading: fileLoading } = useReadFile(
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

  const closeTab = useCallback((path: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setOpenTabs(prev => {
      const idx = prev.indexOf(path);
      const next = prev.filter(p => p !== path);
      if (activeTab === path) {
        setActiveTab(next[Math.max(0, idx - 1)] ?? null);
      }
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

  // ── Save ────────────────────────────────────────────────────────────────────
  const writeFile = useWriteFile();

  const handleSave = useCallback(async () => {
    if (!activeTab || !currentState) return;
    try {
      await writeFile.mutateAsync({ data: { path: activeTab, content: currentState.content } });
      setTabStates(prev => ({
        ...prev,
        [activeTab]: { ...prev[activeTab], savedContent: prev[activeTab].content },
      }));
      toast({ description: `Saved ${activeTab.split("/").pop()}` });
    } catch {
      toast({ description: "Failed to save file", variant: "destructive" });
    }
  }, [activeTab, currentState, writeFile, toast]);

  // ── Create file/folder ──────────────────────────────────────────────────────
  const createFile = useCreateFile();
  const deleteFile = useDeleteFile();

  const handleCreateItem = async () => {
    if (!newItem || !newItemName.trim()) { setNewItem(null); return; }
    const parentPath = newItem.parentPath;
    const name = newItemName.trim();
    const fullPath = parentPath ? `${parentPath}/${name}` : name;

    try {
      await createFile.mutateAsync({ data: { path: fullPath, type: newItem.type } });
      await refetchTree();
      if (newItem.type === "file") openFile(fullPath);
      toast({ description: `Created ${name}` });
    } catch (e: any) {
      toast({ description: e?.message || "Failed to create", variant: "destructive" });
    }
    setNewItem(null);
    setNewItemName("");
  };

  const handleDeleteFile = async (path: string, isDir: boolean) => {
    if (!confirm(`Delete "${path.split("/").pop()}"? This cannot be undone.`)) return;
    try {
      await deleteFile.mutateAsync({ params: { path } });
      await refetchTree();
      if (openTabs.includes(path)) {
        setOpenTabs(prev => prev.filter(p => p !== path));
        if (activeTab === path) setActiveTab(null);
      }
      toast({ description: `Deleted ${path.split("/").pop()}` });
    } catch {
      toast({ description: "Failed to delete", variant: "destructive" });
    }
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────────
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "w") {
      e.preventDefault();
      if (activeTab) closeTab(activeTab, e as any);
    }
  }, [handleSave, activeTab, closeTab]);

  // ── Editor options ──────────────────────────────────────────────────────────
  const [wordWrap, setWordWrap] = useState(false);
  const [fontSize, setFontSize] = useState(14);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });

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
  ], [activeTab, wordWrap]);

  // ── AI panel ────────────────────────────────────────────────────────────────
  const { data: aisData } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const [selectedAi, setSelectedAi] = useState<string>("__auto__");
  const [aiMessages, setAiMessages] = useState<AiMsg[]>([]);
  const [aiPrompt, setAiPrompt] = useState("");
  const aiScrollRef = useRef<HTMLDivElement>(null);
  const askAiWithContext = useAskAiWithContext();

  useEffect(() => {
    if (aisData?.ais && selectedAi === "__auto__") {
      const active = aisData.ais.find(a => a.hasSession);
      if (active) setSelectedAi(active.id);
    }
  }, [aisData]);

  useEffect(() => {
    aiScrollRef.current?.scrollTo({ top: aiScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [aiMessages]);

  const resolveAiId = () => {
    if (selectedAi === "__auto__") {
      return aisData?.ais?.find((a: any) => a.hasSession)?.id ?? "pollinations";
    }
    return selectedAi;
  };

  const sendAiMessage = async (userText: string) => {
    if (!userText.trim()) return;
    if (!activeTab && !currentState) {
      toast({ description: "Open a file first", variant: "destructive" });
      return;
    }

    const userMsg: AiMsg = { role: "user", content: userText };
    setAiMessages(prev => [...prev, userMsg]);
    setAiPrompt("");

    const files = activeTab && currentState
      ? [{ path: activeTab, content: currentState.content }]
      : [];

    try {
      const result = await askAiWithContext.mutateAsync({
        data: { aiId: resolveAiId(), prompt: userText, files },
      });
      if (result.success) {
        setAiMessages(prev => [...prev, { role: "assistant", content: result.response }]);
      } else {
        setAiMessages(prev => [...prev, { role: "assistant", content: result.error || "Failed", error: true }]);
      }
    } catch {
      setAiMessages(prev => [...prev, { role: "assistant", content: "Unexpected error.", error: true }]);
    }
  };

  const handleQuickAction = (action: string) => sendAiMessage(`Please ${action} this code.`);

  const applyCodeFromMessage = (content: string) => {
    const match = content.match(/```[\w]*\n([\s\S]*?)```/);
    if (match?.[1] && activeTab) {
      handleEditorChange(match[1].trim());
      toast({ description: "Code applied to editor — press Ctrl+S to save" });
    } else {
      toast({ description: "No code block found in response", variant: "destructive" });
    }
  };

  // ── Mobile panel switcher ────────────────────────────────────────────────────
  type MobilePanel = "files" | "editor" | "ai";
  const [mobilePanel, setMobilePanel] = useState<MobilePanel>("editor");

  // ── Shared panels ───────────────────────────────────────────────────────────
  const FilesPanel = (
    <div className="flex flex-col h-full bg-sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">Explorer</span>
        <div className="flex items-center gap-0.5">
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="New file"
            onClick={() => { setNewItem({ type: "file", parentPath: "" }); setNewItemName(""); }}
          ><FilePlus className="h-3.5 w-3.5" /></button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="New folder"
            onClick={() => { setNewItem({ type: "folder", parentPath: "" }); setNewItemName(""); }}
          ><FolderPlus className="h-3.5 w-3.5" /></button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Refresh"
            onClick={() => refetchTree()}
          ><RefreshCw className="h-3.5 w-3.5" /></button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Import files"
            onClick={() => setShowImportExport(true)}
          ><Upload className="h-3.5 w-3.5" /></button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Export workspace"
            onClick={() => {
              const a = document.createElement("a");
              a.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/files/export`;
              a.download = "";
              document.body.appendChild(a); a.click(); document.body.removeChild(a);
              toast({ description: "Exporting workspace…" });
            }}
          ><Download className="h-3.5 w-3.5" /></button>
        </div>
      </div>

      {/* Inline new-item input */}
      {newItem && (
        <div className="px-2 py-1.5 border-b border-border shrink-0 bg-card">
          <p className="text-[10px] text-muted-foreground mb-1">
            New {newItem.type}{newItem.parentPath ? ` in ${newItem.parentPath}` : ""}
          </p>
          <div className="flex gap-1">
            <input
              ref={newItemInputRef}
              className="flex-1 text-xs bg-background border border-border rounded px-2 py-1 outline-none focus:border-primary"
              placeholder={newItem.type === "file" ? "filename.ts" : "folder-name"}
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleCreateItem();
                if (e.key === "Escape") { setNewItem(null); setNewItemName(""); }
              }}
            />
            <button
              className="h-7 px-2 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              onClick={handleCreateItem}
            ><Check className="h-3 w-3" /></button>
            <button
              className="h-7 px-2 text-xs border border-border rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={() => { setNewItem(null); setNewItemName(""); }}
            ><X className="h-3 w-3" /></button>
          </div>
        </div>
      )}

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-1.5">
          {treeLoading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : treeData?.tree ? (
            <FileTreeItem
              node={treeData.tree}
              onSelect={openFile}
              activePath={activeTab}
              onDelete={handleDeleteFile}
              onNewFile={path => { setNewItem({ type: "file", parentPath: path }); setNewItemName(""); }}
              onNewFolder={path => { setNewItem({ type: "folder", parentPath: path }); setNewItemName(""); }}
            />
          ) : (
            <p className="text-xs text-muted-foreground text-center py-6">No files found</p>
          )}
        </div>
      </ScrollArea>
    </div>
  );

  const EditorPanel = (
    <div className="flex flex-col h-full bg-background min-w-0">
      {/* Tab bar */}
      <div className="flex items-center border-b border-border bg-card shrink-0 overflow-x-auto min-h-[36px]">
        {openTabs.length === 0 ? (
          <span className="px-4 text-xs text-muted-foreground italic">No files open</span>
        ) : openTabs.map(path => {
          const name = path.split("/").pop() ?? path;
          const isActive = path === activeTab;
          const dirty = tabStates[path] && tabStates[path].content !== tabStates[path].savedContent;
          return (
            <div
              key={path}
              className={`flex items-center gap-1.5 px-3 h-[36px] cursor-pointer border-r border-border shrink-0 group transition-colors ${
                isActive
                  ? "bg-background text-foreground border-b-2 border-b-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              }`}
              onClick={() => setActiveTab(path)}
              title={path}
            >
              {getFileIcon(name, true)}
              <span className="text-xs font-medium max-w-[120px] truncate">
                {name}
              </span>
              {dirty && (
                <span className="h-1.5 w-1.5 rounded-full bg-primary shrink-0" title="Unsaved changes" />
              )}
              <button
                className="h-4 w-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all ml-0.5"
                onClick={e => closeTab(path, e)}
                title="Close tab"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {/* Right-side controls */}
        <div className="ml-auto flex items-center gap-1 px-2 shrink-0">
          <button
            className={`h-6 w-6 flex items-center justify-center rounded transition-colors text-xs ${
              wordWrap ? "bg-primary/20 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
            onClick={() => setWordWrap(w => !w)}
            title="Toggle word wrap"
          ><WrapText className="h-3.5 w-3.5" /></button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setFontSize(s => Math.max(10, s - 1))}
            title="Decrease font size"
          ><ZoomOut className="h-3.5 w-3.5" /></button>
          <span className="text-[10px] text-muted-foreground w-5 text-center">{fontSize}</span>
          <button
            className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setFontSize(s => Math.min(24, s + 1))}
            title="Increase font size"
          ><ZoomIn className="h-3.5 w-3.5" /></button>
          <button
            className={`h-6 px-2 flex items-center gap-1 rounded transition-colors text-xs font-medium ${
              activeTab && isDirty
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30"
            }`}
            onClick={handleSave}
            disabled={!activeTab || !isDirty || writeFile.isPending}
            title="Save (Ctrl+S)"
          >
            {writeFile.isPending
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <Save className="h-3 w-3" />}
            <span className="hidden sm:inline">Save</span>
          </button>
        </div>
      </div>

      {/* Breadcrumb */}
      {activeTab && (
        <div className="flex items-center gap-1 px-3 py-1 border-b border-border/50 bg-card/50 shrink-0">
          {activeTab.split("/").map((part, i, arr) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground/70" />}
              <span className={`text-[11px] ${i === arr.length - 1 ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                {part}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Editor area */}
      <div className="flex-1 overflow-auto bg-[#1a1b26]" style={{ fontSize: `${fontSize}px` }}>
        {fileLoading && activeTab && !tabStates[activeTab]?.loaded ? (
          <div className="h-full flex items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground/70" />
          </div>
        ) : activeTab && tabStates[activeTab]?.loaded ? (
          <CodeMirror
            key={`${activeTab}-${fontSize}`}
            value={tabStates[activeTab].content}
            height="100%"
            theme={tokyoNight}
            extensions={cmExtensions}
            onChange={handleEditorChange}
            className="h-full"
            style={{ fontSize: `${fontSize}px` }}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightSpecialChars: true,
              history: true,
              foldGutter: true,
              drawSelection: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              syntaxHighlighting: true,
              bracketMatching: true,
              closeBrackets: true,
              autocompletion: false,
              rectangularSelection: true,
              crosshairCursor: false,
              highlightActiveLine: true,
              highlightSelectionMatches: true,
              closeBracketsKeymap: true,
              searchKeymap: true,
            }}
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4 px-6">
            <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
              <TerminalSquare className="h-10 w-10 text-muted-foreground/85 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">Select a file to start editing</p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">Ctrl+F to search · Ctrl+S to save</p>
            </div>
          </div>
        )}
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-0.5 bg-primary/5 border-t border-border shrink-0">
        <div className="flex items-center gap-3">
          {activeTab && (
            <>
              <span className="text-[10px] text-muted-foreground">
                Ln {cursorPos.line}, Col {cursorPos.col}
              </span>
              {isDirty && (
                <span className="text-[10px] text-amber-500 font-medium flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Unsaved
                </span>
              )}
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {activeTab && (
            <span className="text-[10px] text-muted-foreground font-mono">
              {getLanguageLabel(activeTab)}
            </span>
          )}
          <span className="text-[10px] text-muted-foreground/70">UTF-8</span>
        </div>
      </div>
    </div>
  );

  const AiPanel = (
    <div className="flex flex-col h-full bg-sidebar border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-primary" />
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-widest">AI Assistant</span>
        </div>
        <div className="flex items-center gap-1">
          {/* AI Selector */}
          <select
            className="text-[11px] bg-background border border-border rounded-lg px-2 py-1 outline-none text-foreground focus:border-primary max-w-[130px]"
            value={selectedAi}
            onChange={e => setSelectedAi(e.target.value)}
          >
            <option value="__auto__">⚡ Auto</option>
            {aisData?.ais.map((ai: any) => (
              <option key={ai.id} value={ai.id}>
                {ai.hasSession ? "✓" : "○"} {ai.name}
              </option>
            ))}
          </select>
          {aiMessages.length > 0 && (
            <button
              className="h-6 w-6 flex items-center justify-center rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
              title="Clear conversation"
              onClick={() => setAiMessages([])}
            ><RefreshCw className="h-3 w-3" /></button>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="px-3 py-2 border-b border-border shrink-0">
        <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest mb-1.5">Quick Actions</p>
        <div className="grid grid-cols-2 gap-1">
          {[
            ["Explain", "explain"],
            ["Fix Bugs", "fix all bugs in"],
            ["Refactor", "refactor and improve"],
            ["Add Tests", "write unit tests for"],
            ["Document", "add JSDoc comments to"],
            ["Optimize", "optimize the performance of"],
          ].map(([label, action]) => (
            <button
              key={label}
              className="text-[11px] px-2 py-1.5 rounded-lg border border-border text-muted-foreground hover:bg-muted hover:text-foreground hover:border-primary/40 transition-all text-left disabled:opacity-40"
              disabled={askAiWithContext.isPending || !activeTab}
              onClick={() => handleQuickAction(action)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Conversation thread */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0" ref={aiScrollRef}>
        {aiMessages.length === 0 ? (
          <div className="text-center py-6 space-y-2">
            <MessageSquare className="h-8 w-8 text-muted-foreground/55 mx-auto" />
            <p className="text-xs text-muted-foreground/80">
              Open a file and ask the AI to explain, fix, refactor, or improve your code.
            </p>
          </div>
        ) : aiMessages.map((msg, i) => (
          <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "assistant" && (
              <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                <Zap className="h-3 w-3 text-primary" />
              </div>
            )}
            <div className={`max-w-[90%] text-xs rounded-xl px-3 py-2 ${
              msg.role === "user"
                ? "bg-primary/15 text-foreground border border-primary/20"
                : msg.error
                  ? "bg-red-950/30 text-red-400 border border-red-500/20"
                  : "bg-card border border-border text-foreground"
            }`}>
              {msg.role === "user" ? (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              ) : (
                <div>
                  <MarkdownRenderer content={msg.content} />
                  {!msg.error && (
                    <div className="flex gap-1 mt-2 pt-1.5 border-t border-border/50">
                      <button
                        className="text-[10px] px-2 py-0.5 rounded bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={() => { navigator.clipboard.writeText(msg.content); toast({ description: "Copied" }); }}
                      >
                        <Copy className="h-2.5 w-2.5 inline mr-1" />Copy
                      </button>
                      <button
                        className="text-[10px] px-2 py-0.5 rounded bg-primary/15 hover:bg-primary/25 text-primary transition-colors"
                        onClick={() => applyCodeFromMessage(msg.content)}
                      >
                        <Check className="h-2.5 w-2.5 inline mr-1" />Apply
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        ))}
        {askAiWithContext.isPending && (
          <div className="flex gap-2 justify-start">
            <div className="h-5 w-5 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
              <Zap className="h-3 w-3 text-primary" />
            </div>
            <div className="bg-card border border-border rounded-xl px-3 py-2 flex items-center gap-1.5">
              <span className="h-1.5 w-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
              <span className="h-1.5 w-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
              <span className="h-1.5 w-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* Prompt input */}
      <div className="px-3 py-2 border-t border-border shrink-0">
        <div className="relative">
          <Textarea
            value={aiPrompt}
            onChange={e => setAiPrompt(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendAiMessage(aiPrompt);
              }
            }}
            placeholder={activeTab ? `Ask about ${activeTab.split("/").pop()}…` : "Open a file first…"}
            className="min-h-[64px] max-h-32 resize-none text-xs bg-background border-border focus:border-primary pr-10 rounded-xl"
            disabled={askAiWithContext.isPending}
          />
          <button
            className="absolute right-2 bottom-2 h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 transition-all"
            disabled={askAiWithContext.isPending || !aiPrompt.trim()}
            onClick={() => sendAiMessage(aiPrompt)}
          >
            {askAiWithContext.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <ChevronUp className="h-3.5 w-3.5" />}
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/70 mt-1 text-right">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full w-full bg-background" onKeyDown={handleKeyDown} tabIndex={-1}>

      {/* ── Mobile panel switcher ─────────────────────────────────────── */}
      <div className="sm:hidden flex items-center border-b border-border bg-card shrink-0">
        {(["files", "editor", "ai"] as MobilePanel[]).map(panel => {
          const labels: Record<MobilePanel, { icon: React.ReactNode; label: string }> = {
            files: { icon: <Files className="h-4 w-4" />, label: "Files" },
            editor: { icon: <TerminalSquare className="h-4 w-4" />, label: "Editor" },
            ai: { icon: <Cpu className="h-4 w-4" />, label: "AI" },
          };
          const { icon, label } = labels[panel];
          return (
            <button
              key={panel}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors text-[11px] font-semibold ${
                mobilePanel === panel
                  ? "text-primary border-b-2 border-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMobilePanel(panel)}
            >
              {icon}
              {label}
            </button>
          );
        })}
      </div>

      {/* ── Mobile panels ────────────────────────────────────────────── */}
      <div className="sm:hidden flex-1 min-h-0 overflow-hidden">
        {mobilePanel === "files" && FilesPanel}
        {mobilePanel === "editor" && EditorPanel}
        {mobilePanel === "ai" && AiPanel}
      </div>

      {/* ── Desktop layout ────────────────────────────────────────────── */}
      <div className="hidden sm:flex flex-1 min-h-0 overflow-hidden">
        <ResizablePanelGroup direction="horizontal" className="h-full">
          <ResizablePanel defaultSize={18} minSize={14} maxSize={28}>
            {FilesPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={52} minSize={30}>
            {EditorPanel}
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={30} minSize={22} maxSize={42}>
            {AiPanel}
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <ImportExportModal open={showImportExport} onClose={() => setShowImportExport(false)} />
    </div>
  );
}
