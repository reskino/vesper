/**
 * CommandPalette — Ctrl+P file-search overlay for the Vesper IDE.
 *
 * Features:
 *  - Fuzzy-matches all files in the current workspace tree
 *  - Keyboard navigation (↑ ↓ Enter Esc)
 *  - Opens the selected file in the editor via IDEContext.openFileInEditor
 *  - Scores results: name match > path match, with character-proximity bonus
 *  - Shows file-type icons and the relative path as a subtitle
 *  - Respects reduced-motion preference for the slide-in animation
 */

import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useGetFileTree } from "@workspace/api-client-react";
import type { FileNode } from "@workspace/api-client-react";
import {
  FileCode, FileText, FileJson, FileIcon, Search, X,
  CornerDownLeft,
} from "lucide-react";
import { useIDE } from "@/contexts/ide-context";
import { useWorkspace } from "@/contexts/workspace-context";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively flatten a FileNode tree into an array of file paths */
function flattenTree(node: FileNode, acc: FileNode[] = []): FileNode[] {
  if (node.type === "file") {
    acc.push(node);
  } else if (node.children) {
    for (const child of node.children) flattenTree(child, acc);
  }
  return acc;
}

/** Simple fuzzy scorer: returns > 0 if all query chars appear in target in order */
function fuzzyScore(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t.includes(q)) return 100 + (q.length / t.length) * 50; // substring bonus

  let score = 0;
  let qi = 0;
  let lastIdx = -1;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      // proximity bonus — chars close together score higher
      score += lastIdx === -1 ? 10 : Math.max(1, 10 - (ti - lastIdx - 1));
      lastIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

/** Return spans marking matched characters for highlight rendering */
function highlightMatch(query: string, text: string): { text: string; hi: boolean }[] {
  if (!query) return [{ text, hi: false }];
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  const parts: { text: string; hi: boolean }[] = [];
  let i = 0;

  // Simple substring highlight first
  const idx = t.indexOf(q);
  if (idx !== -1) {
    if (idx > 0) parts.push({ text: text.slice(0, idx), hi: false });
    parts.push({ text: text.slice(idx, idx + q.length), hi: true });
    if (idx + q.length < text.length) parts.push({ text: text.slice(idx + q.length), hi: false });
    return parts;
  }

  // Fall back to character-by-character fuzzy highlight
  let qi = 0;
  while (i < text.length) {
    if (qi < q.length && t[i] === q[qi]) {
      parts.push({ text: text[i], hi: true });
      qi++;
    } else {
      parts.push({ text: text[i], hi: false });
    }
    i++;
  }
  return parts;
}

// ── File icon ─────────────────────────────────────────────────────────────────
function PaletteFileIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  const cls = "h-4 w-4 shrink-0";
  if (["ts", "tsx", "js", "jsx", "vue", "svelte"].includes(ext))
    return <FileCode className={`${cls} text-sky-400`} />;
  if (["json", "yaml", "yml", "toml"].includes(ext))
    return <FileJson className={`${cls} text-amber-400`} />;
  if (["md", "mdx", "txt"].includes(ext))
    return <FileText className={`${cls} text-emerald-400`} />;
  if (["py", "rb", "go", "rs", "java", "cpp", "c", "h"].includes(ext))
    return <FileCode className={`${cls} text-violet-400`} />;
  if (["css", "scss", "less"].includes(ext))
    return <FileCode className={`${cls} text-pink-400`} />;
  return <FileIcon className={`${cls} text-[#6868a8]`} />;
}

// ── Highlighted text span ─────────────────────────────────────────────────────
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

// ── Main component ────────────────────────────────────────────────────────────
interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const { openFileInEditor } = useIDE();
  const { currentWorkspace }  = useWorkspace();

  const [query, setQuery]   = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef  = useRef<HTMLInputElement>(null);
  const listRef   = useRef<HTMLDivElement>(null);
  const itemRefs  = useRef<(HTMLButtonElement | null)[]>([]);

  // ── Fetch workspace file tree ─────────────────────────────────────────────
  const rootPath = currentWorkspace?.path ?? "";
  const { data: treeData } = useGetFileTree(
    { rootPath },
    { query: { enabled: open && !!rootPath, staleTime: 10_000 } }
  );

  // ── Flatten tree → file list ──────────────────────────────────────────────
  const allFiles: FileNode[] = useMemo(() => {
    if (!treeData?.tree) return [];
    return flattenTree(treeData.tree);
  }, [treeData]);

  // ── Fuzzy-filter and score ────────────────────────────────────────────────
  const results = useMemo(() => {
    if (!query.trim()) return allFiles.slice(0, 50);
    return allFiles
      .map(f => {
        const nameScore = fuzzyScore(query, f.name) * 2;   // name match counts double
        const pathScore = fuzzyScore(query, f.path);
        const total = nameScore + pathScore;
        return { file: f, score: total };
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 50)
      .map(r => r.file);
  }, [query, allFiles]);

  // ── Reset state when opened ───────────────────────────────────────────────
  useEffect(() => {
    if (open) {
      setQuery("");
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // ── Keep cursor in bounds ─────────────────────────────────────────────────
  useEffect(() => { setCursor(0); }, [results]);

  // ── Scroll highlighted item into view ─────────────────────────────────────
  useEffect(() => {
    itemRefs.current[cursor]?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  // ── Open selected file ────────────────────────────────────────────────────
  const openFile = useCallback((path: string) => {
    openFileInEditor(path);
    onClose();
  }, [openFileInEditor, onClose]);

  // ── Keyboard handler ──────────────────────────────────────────────────────
  const onKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setCursor(c => Math.min(c + 1, results.length - 1)); }
    if (e.key === "ArrowUp")   { e.preventDefault(); setCursor(c => Math.max(c - 1, 0)); }
    if (e.key === "Enter" && results[cursor]) { e.preventDefault(); openFile(results[cursor].path); }
    if (e.key === "Escape") { e.preventDefault(); onClose(); }
  }, [results, cursor, openFile, onClose]);

  if (!open) return null;

  return (
    /* Backdrop */
    <div
      className="fixed inset-0 z-[300] flex items-start justify-center pt-[10vh] px-4
        bg-black/60 backdrop-blur-sm motion-reduce:backdrop-blur-none"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Panel */}
      <div
        className="w-full max-w-xl bg-[#0c0c14] border border-[#1e1e30]
          rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)]
          flex flex-col overflow-hidden
          animate-in fade-in slide-in-from-top-4 duration-150
          motion-reduce:animate-none"
      >
        {/* Search input */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[#1a1a28]">
          <Search className="h-4 w-4 text-[#6868a8] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search files…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-[#4a4a72]
              outline-none caret-violet-400"
            autoComplete="off"
            spellCheck={false}
          />
          {query && (
            <button onClick={() => setQuery("")} className="text-[#4a4a72] hover:text-foreground transition-colors">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Results list */}
        <div
          ref={listRef}
          className="overflow-y-auto max-h-80 py-1"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#1e1e30 transparent" }}
        >
          {results.length === 0 && (
            <div className="py-8 text-center text-sm text-[#4a4a72]">
              {allFiles.length === 0 ? "No files in workspace" : "No files match"}
            </div>
          )}
          {results.map((file, i) => {
            // Show path relative to workspace root (strip rootPath prefix)
            const relPath = rootPath ? file.path.replace(rootPath + "/", "") : file.path;
            const relDir  = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
            const isActive = i === cursor;
            return (
              <button
                key={file.path}
                ref={el => { itemRefs.current[i] = el; }}
                onClick={() => openFile(file.path)}
                onMouseEnter={() => setCursor(i)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                  isActive ? "bg-violet-600/20" : "hover:bg-[#111120]"
                }`}
              >
                <PaletteFileIcon name={file.name} />
                <div className="flex-1 min-w-0">
                  <Highlighted
                    query={query}
                    text={file.name}
                    className="block text-sm font-medium text-foreground truncate"
                  />
                  {relDir && (
                    <Highlighted
                      query={query}
                      text={relDir}
                      className="block text-[11px] text-[#5858a0] truncate mt-0.5"
                    />
                  )}
                </div>
                {isActive && (
                  <CornerDownLeft className="h-3 w-3 text-[#4a4a72] shrink-0" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-[#1a1a28] flex items-center gap-4 text-[10px] text-[#3a3a5a]">
          <span><kbd className="font-mono">↑↓</kbd> navigate</span>
          <span><kbd className="font-mono">↵</kbd> open</span>
          <span><kbd className="font-mono">Esc</kbd> close</span>
          <span className="ml-auto">{results.length} of {allFiles.length} files</span>
        </div>
      </div>
    </div>
  );
}
