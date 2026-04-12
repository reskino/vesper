/**
 * CommandPalette — Unified Ctrl+P / Ctrl+K overlay for the Vesper IDE.
 *
 * Two modes, auto-detected by the query prefix:
 *  File mode    (Ctrl+P) — query does NOT start with ">"
 *               Fuzzy-searches all files in the current workspace tree.
 *
 *  Command mode (Ctrl+K) — query starts with ">"
 *               Shows categorised IDE commands: switch agent, export,
 *               toggle panels, new chat, show shortcuts, etc.
 *
 * Type ">" in file mode to switch to command mode.
 * Delete the ">" to switch back to file mode.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useGetFileTree } from "@workspace/api-client-react";
import type { FileNode } from "@workspace/api-client-react";
import {
  FileCode, FileText, FileJson, FileIcon,
  Search, X, CornerDownLeft, Terminal, MessageSquare,
  Printer, FileDown, FolderInput, RotateCcw, Keyboard,
  ChevronRight, Zap, Bot,
} from "lucide-react";
import { useIDE } from "@/contexts/ide-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { useAgentMode, AGENT_OPTIONS } from "@/contexts/agent-context";
import { exportChatAsPdf, exportChatAsDocxBackend } from "@/lib/export-chat";
import { toast } from "sonner";

// ─────────────────────────────────────────────────────────────────────────────
// File-mode helpers
// ─────────────────────────────────────────────────────────────────────────────

function flattenTree(node: FileNode, acc: FileNode[] = []): FileNode[] {
  if (node.type === "file") acc.push(node);
  else if (node.children) node.children.forEach(c => flattenTree(c, acc));
  return acc;
}

function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase(), t = target.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 + (q.length / t.length) * 50;
  let score = 0, qi = 0, lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastIdx === -1 ? 10 : Math.max(1, 10 - (ti - lastIdx - 1));
      lastIdx = ti; qi++;
    }
  }
  return qi === q.length ? score : 0;
}

function highlightMatch(query: string, text: string): { text: string; hi: boolean }[] {
  if (!query) return [{ text, hi: false }];
  const q = query.toLowerCase(), t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx !== -1) {
    const parts: { text: string; hi: boolean }[] = [];
    if (idx > 0) parts.push({ text: text.slice(0, idx), hi: false });
    parts.push({ text: text.slice(idx, idx + q.length), hi: true });
    if (idx + q.length < text.length) parts.push({ text: text.slice(idx + q.length), hi: false });
    return parts;
  }
  const parts: { text: string; hi: boolean }[] = [];
  let i = 0, qi = 0;
  while (i < text.length) {
    if (qi < q.length && t[i] === q[qi]) { parts.push({ text: text[i], hi: true }); qi++; }
    else parts.push({ text: text[i], hi: false });
    i++;
  }
  return parts;
}

function PaletteFileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const cls = "h-3.5 w-3.5 shrink-0";
  if (["ts","tsx","js","jsx","vue","svelte"].includes(ext)) return <FileCode className={`${cls} text-sky-400`} />;
  if (["json","yaml","yml","toml"].includes(ext))           return <FileJson className={`${cls} text-amber-400`} />;
  if (["md","mdx","txt"].includes(ext))                     return <FileText className={`${cls} text-emerald-400`} />;
  if (["py","rb","go","rs","java","cpp","c","h"].includes(ext)) return <FileCode className={`${cls} text-violet-400`} />;
  if (["css","scss","less"].includes(ext))                  return <FileCode className={`${cls} text-pink-400`} />;
  return <FileIcon className={`${cls} text-[#6868a8]`} />;
}

function Highlighted({ query, text, className = "" }: { query: string; text: string; className?: string }) {
  const parts = useMemo(() => highlightMatch(query, text), [query, text]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.hi
          ? <mark key={i} className="bg-violet-500/30 text-violet-200 rounded-[2px] not-italic">{p.text}</mark>
          : <span key={i}>{p.text}</span>
      )}
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Command-mode: command definitions
// ─────────────────────────────────────────────────────────────────────────────

interface Command {
  id:       string;
  group:    string;
  label:    string;
  hint?:    string;  // keyboard shortcut hint
  icon:     React.ReactNode;
  onRun:    () => void;
}

/** Build the full command list. Accepts callbacks from the parent component. */
function buildCommands(deps: {
  setAgentType:       (t: string) => void;
  currentAgentId:     string;
  toggleChat:         () => void;
  toggleTerminal:     () => void;
  triggerNewChat:     () => void;
  openShortcutsModal: () => void;
  setMobileTab:       (t: any) => void;
}): Command[] {
  const {
    setAgentType, currentAgentId,
    toggleChat, toggleTerminal, triggerNewChat,
    openShortcutsModal, setMobileTab,
  } = deps;

  const ICON = { size: "h-3.5 w-3.5 shrink-0" };

  // Agent-switch commands
  const agentCmds: Command[] = AGENT_OPTIONS.map(a => ({
    id:    `agent-${a.id}`,
    group: "Switch Agent",
    label: a.name,
    hint:  a.roleHint,
    icon:  <span className={`w-2 h-2 rounded-full shrink-0 ${a.dotColor}`} />,
    onRun: () => {
      setAgentType(a.id);
      toast.success(`Switched to ${a.name}`);
    },
  }));

  const actionCmds: Command[] = [
    {
      id: "new-chat",   group: "Chat", label: "New Chat",
      hint: "Ctrl+N",   icon: <MessageSquare className={`${ICON.size} text-violet-400`} />,
      onRun: triggerNewChat,
    },
    {
      id: "toggle-chat",   group: "View", label: "Toggle Chat Panel",
      hint: "Ctrl+J",       icon: <MessageSquare className={`${ICON.size} text-[#6868a8]`} />,
      onRun: toggleChat,
    },
    {
      id: "toggle-terminal", group: "View", label: "Toggle Terminal",
      hint: "Ctrl+`",         icon: <Terminal className={`${ICON.size} text-[#6868a8]`} />,
      onRun: toggleTerminal,
    },
    {
      id: "export-pdf",  group: "Export", label: "Export Chat as PDF",
      icon: <Printer className={`${ICON.size} text-rose-400`} />,
      onRun: () => toast("Use the Export menu in the chat header to export as PDF."),
    },
    {
      id: "export-docx", group: "Export", label: "Export Chat as Word (.docx)",
      icon: <FileDown className={`${ICON.size} text-sky-400`} />,
      onRun: () => toast("Use the Export menu in the chat header to download Word."),
    },
    {
      id: "save-workspace", group: "Export", label: "Save Chat to Workspace",
      icon: <FolderInput className={`${ICON.size} text-emerald-400`} />,
      onRun: () => toast("Use the Export menu in the chat header to save to workspace."),
    },
    {
      id: "show-shortcuts", group: "Help", label: "Show Keyboard Shortcuts",
      hint: "?",              icon: <Keyboard className={`${ICON.size} text-amber-400`} />,
      onRun: openShortcutsModal,
    },
  ];

  return [...agentCmds, ...actionCmds];
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────

interface CommandPaletteProps {
  open:         boolean;
  onClose:      () => void;
  /** Text to pre-fill in the input when opened (e.g. ">" for command mode) */
  initialQuery?: string;
}

export function CommandPalette({ open, onClose, initialQuery = "" }: CommandPaletteProps) {
  const { openFileInEditor, toggleChat, toggleTerminal, triggerNewChat, openShortcutsModal, setMobileTab } = useIDE();
  const { currentWorkspace } = useWorkspace();
  const { setAgentType, agentType } = useAgentMode();
  const [query, setQuery]   = useState(initialQuery);
  const [cursor, setCursor] = useState(0);
  const inputRef   = useRef<HTMLInputElement>(null);
  const itemRefs   = useRef<(HTMLButtonElement | null)[]>([]);

  // Detect mode: anything starting with ">" is command mode
  const isCommandMode = query.startsWith(">");
  const cmdQuery      = isCommandMode ? query.slice(1).trimStart() : "";
  const fileQuery     = !isCommandMode ? query : "";

  // ── File tree ──────────────────────────────────────────────────────────────
  const relPath = currentWorkspace?.relPath ?? "";
  const rootPath = currentWorkspace?.path ?? "";
  const { data: treeData } = useGetFileTree(
    { path: relPath },
    { query: { enabled: open && !!relPath && !isCommandMode, staleTime: 10_000 } }
  );
  const allFiles: FileNode[] = useMemo(() =>
    treeData?.tree ? flattenTree(treeData.tree) : [], [treeData]
  );
  const fileResults: FileNode[] = useMemo(() => {
    if (isCommandMode) return [];
    if (!fileQuery.trim()) return allFiles.slice(0, 50);
    return allFiles
      .map(f => ({ file: f, score: fuzzyScore(fileQuery, f.name) * 2 + fuzzyScore(fileQuery, f.path) }))
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(r => r.file);
  }, [isCommandMode, fileQuery, allFiles]);

  // ── Commands ───────────────────────────────────────────────────────────────
  const allCommands = useMemo(() =>
    buildCommands({ setAgentType, currentAgentId: agentType, toggleChat, toggleTerminal, triggerNewChat, openShortcutsModal, setMobileTab }),
    [setAgentType, agentType, toggleChat, toggleTerminal, triggerNewChat, openShortcutsModal, setMobileTab]
  );
  const commandResults = useMemo(() => {
    if (!isCommandMode) return allCommands;
    if (!cmdQuery) return allCommands;
    const q = cmdQuery.toLowerCase();
    return allCommands.filter(c =>
      c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q)
    );
  }, [isCommandMode, cmdQuery, allCommands]);

  // Flat list of "items" for keyboard navigation
  const totalItems = isCommandMode ? commandResults.length : fileResults.length;

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery(initialQuery);
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open, initialQuery]);

  useEffect(() => { setCursor(0); }, [query]);

  useEffect(() => {
    itemRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // ── Run action ─────────────────────────────────────────────────────────────
  const runItem = useCallback((idx: number) => {
    if (isCommandMode) {
      commandResults[idx]?.onRun();
      onClose();
    } else {
      const file = fileResults[idx];
      if (file) { openFileInEditor(file.path); onClose(); }
    }
  }, [isCommandMode, commandResults, fileResults, openFileInEditor, onClose]);

  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown")  { e.preventDefault(); setCursor(c => Math.min(c + 1, totalItems - 1)); }
    if (e.key === "ArrowUp")    { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && totalItems > 0) { e.preventDefault(); runItem(cursor); }
    if (e.key === "Escape")     { e.preventDefault(); onClose(); }
  }, [totalItems, cursor, runItem, onClose]);

  if (!open) return null;

  // ── Render grouped commands ─────────────────────────────────────────────────
  function renderCommandRows() {
    // Group by .group
    const groups: Record<string, { cmd: Command; flatIdx: number }[]> = {};
    let idx = 0;
    for (const cmd of commandResults) {
      if (!groups[cmd.group]) groups[cmd.group] = [];
      groups[cmd.group].push({ cmd, flatIdx: idx++ });
    }

    return Object.entries(groups).map(([groupName, items]) => (
      <div key={groupName}>
        <div className="px-3 py-1 mt-1 text-[10px] font-semibold text-[#3a3a5a] uppercase tracking-widest">
          {groupName}
        </div>
        {items.map(({ cmd, flatIdx }) => {
          const active = flatIdx === cursor;
          return (
            <button
              key={cmd.id}
              ref={el => { itemRefs.current[flatIdx] = el; }}
              onClick={() => runItem(flatIdx)}
              onMouseEnter={() => setCursor(flatIdx)}
              aria-selected={active}
              className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors ${
                active ? "bg-violet-600/20" : "hover:bg-[#111120]"
              }`}
            >
              <span className="flex items-center justify-center w-5 h-5">{cmd.icon}</span>
              <span className="flex-1 text-sm text-foreground truncate">{cmd.label}</span>
              {cmd.hint && (
                <kbd className="text-[10px] font-mono text-[#4a4a72] bg-[#111118] border border-[#1a1a28]
                  rounded px-1.5 py-0.5 shrink-0">
                  {cmd.hint}
                </kbd>
              )}
              {active && <ChevronRight className="h-3 w-3 text-[#4a4a72] shrink-0 ml-1" />}
            </button>
          );
        })}
      </div>
    ));
  }

  // ── Render file rows ────────────────────────────────────────────────────────
  function renderFileRows() {
    if (fileResults.length === 0) {
      return (
        <div className="py-8 text-center text-sm text-[#4a4a72]">
          {allFiles.length === 0 ? "No files in workspace" : "No files match"}
        </div>
      );
    }
    return fileResults.map((file, i) => {
      const disp    = rootPath ? file.path.replace(rootPath + "/", "") : file.path;
      const relDir  = disp.includes("/") ? disp.slice(0, disp.lastIndexOf("/")) : "";
      const active  = i === cursor;
      return (
        <button
          key={file.path}
          ref={el => { itemRefs.current[i] = el; }}
          onClick={() => runItem(i)}
          onMouseEnter={() => setCursor(i)}
          aria-selected={active}
          className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
            active ? "bg-violet-600/20" : "hover:bg-[#111120]"
          }`}
        >
          <PaletteFileIcon name={file.name} />
          <div className="flex-1 min-w-0">
            <Highlighted query={fileQuery} text={file.name} className="block text-sm font-medium text-foreground truncate" />
            {relDir && <Highlighted query={fileQuery} text={relDir} className="block text-[11px] text-[#5858a0] truncate mt-0.5" />}
          </div>
          {active && <CornerDownLeft className="h-3 w-3 text-[#4a4a72] shrink-0" />}
        </button>
      );
    });
  }

  // ── Mode indicator badge ────────────────────────────────────────────────────
  const modeBadge = isCommandMode
    ? <span className="text-[10px] font-semibold text-violet-400 bg-violet-500/10 border border-violet-500/20 rounded px-1.5 py-0.5 shrink-0">Commands</span>
    : <span className="text-[10px] font-semibold text-[#4a4a72] bg-[#111118] border border-[#1a1a28] rounded px-1.5 py-0.5 shrink-0">Files</span>;

  return (
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[10vh] px-4
        bg-black/60 backdrop-blur-sm motion-reduce:backdrop-blur-none"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label="Command palette"
      aria-modal="true"
    >
      <div
        className="w-full max-w-xl bg-[#0c0c14] border border-[#1e1e30]
          rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)]
          flex flex-col overflow-hidden
          animate-in fade-in slide-in-from-top-4 duration-150
          motion-reduce:animate-none"
      >
        {/* ── Input row ────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#1a1a28]">
          {isCommandMode
            ? <Zap className="h-4 w-4 text-violet-400 shrink-0" />
            : <Search className="h-4 w-4 text-[#6868a8] shrink-0" />
          }
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={isCommandMode ? "Type a command…" : "Search files  —  type > for commands"}
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-[#4a4a72]
              outline-none caret-violet-400 min-w-0"
            autoComplete="off"
            spellCheck={false}
            aria-label={isCommandMode ? "Command search" : "File search"}
            aria-autocomplete="list"
            aria-controls="palette-list"
          />
          <div className="flex items-center gap-2 shrink-0">
            {modeBadge}
            {query && (
              <button
                onClick={() => setQuery("")}
                className="text-[#4a4a72] hover:text-foreground transition-colors"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* ── Results ──────────────────────────────────────────────────────── */}
        <div
          id="palette-list"
          role="listbox"
          className="overflow-y-auto max-h-[340px] py-1"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#1e1e30 transparent" }}
        >
          {isCommandMode ? renderCommandRows() : renderFileRows()}
        </div>

        {/* ── Footer ───────────────────────────────────────────────────────── */}
        <div className="px-4 py-2 border-t border-[#1a1a28] flex items-center gap-4 text-[10px] text-[#3a3a5a]">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> {isCommandMode ? "run" : "open"}</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
          {!isCommandMode && (
            <span className="text-[#2a2a4a]">
              <kbd className="font-mono">&gt;</kbd> command mode
            </span>
          )}
          <span className="ml-auto">
            {isCommandMode
              ? `${commandResults.length} command${commandResults.length !== 1 ? "s" : ""}`
              : `${fileResults.length} of ${allFiles.length} files`
            }
          </span>
        </div>
      </div>
    </div>
  );
}
