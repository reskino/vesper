/**
 * FileExplorer — VS Code-style file tree with per-project workspace support.
 *
 * Workspace features (new):
 *  - WorkspaceSwitcher dropdown in the header (create / switch workspaces)
 *  - File tree scoped to the active workspace subdirectory
 *  - "Install Dependency" panel — isolated uv/venv (Python) or npm (JS)
 *  - Collapsible "Installed packages" section
 *
 * Existing features retained:
 *  - Recursive tree, colour-coded icons, inline create/rename/delete
 *  - Multi-select (Ctrl+Click / Shift+Click) + "Open all"
 *  - Import (zip/GitHub), Export workspace as zip
 *  - Mobile search, Start Fresh (clear workspace)
 */

import { useState, useRef, useEffect, useCallback, useId } from "react";
import {
  useGetFileTree, getGetFileTreeQueryKey,
  useCreateFile, useDeleteFile, useRenameFile,
  FileNode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder, FolderOpen, FileIcon, FileCode, FileText, FileJson,
  ChevronRight, ChevronDown, RefreshCw, FilePlus, FolderPlus,
  Trash2, Upload, Download, Check, X, Loader2, Pencil, Search,
  ChevronsLeft, ChevronsUpDown, FolderX, Package, PackagePlus, Plus, Layers,
  ChevronUp, AlertCircle, CheckCircle2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIDE } from "@/contexts/ide-context";
import { useWorkspace, type Workspace } from "@/contexts/workspace-context";
import { ImportExportModal } from "@/components/import-export-modal";
import { ImportedTree, FolderImportButton, FolderImportLargeButton } from "@/components/ide/imported-tree";

// ── File-type icon ────────────────────────────────────────────────────────────
function FileIcon2({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  if (ext === "json") return <FileJson className="h-3.5 w-3.5 text-yellow-400 shrink-0" />;
  if (["md", "mdx"].includes(ext)) return <FileText className="h-3.5 w-3.5 text-violet-400 shrink-0" />;
  if (ext === "py") return <FileCode className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (["css", "scss", "less"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-pink-400 shrink-0" />;
  if (["html", "htm"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-orange-400 shrink-0" />;
  if (ext === "rs") return <FileCode className="h-3.5 w-3.5 text-orange-500 shrink-0" />;
  if (ext === "sql") return <FileCode className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  if (ext === "go") return <FileCode className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
  if (ext === "sh") return <FileCode className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  if (ext === "yaml" || ext === "yml") return <FileCode className="h-3.5 w-3.5 text-amber-400 shrink-0" />;
  if (ext === "toml") return <FileCode className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <FileIcon className="h-3.5 w-3.5 text-[#9898b8] shrink-0" />;
}

// ── Inline rename ─────────────────────────────────────────────────────────────
function InlineRename({ initialValue, onConfirm, onCancel }: {
  initialValue: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : value.length);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      ref={inputRef}
      className="flex-1 min-w-0 bg-[#1e1e2e] border border-primary/60 rounded px-1 py-0 text-[12px] text-foreground outline-none"
      value={value}
      onChange={e => setValue(e.target.value)}
      onKeyDown={e => {
        if (e.key === "Enter") { e.preventDefault(); if (value.trim()) onConfirm(value.trim()); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
      }}
      onBlur={() => { if (value.trim() && value.trim() !== initialValue) onConfirm(value.trim()); else onCancel(); }}
      onClick={e => e.stopPropagation()}
    />
  );
}

// ── TreeItem ──────────────────────────────────────────────────────────────────
interface TreeItemProps {
  node: FileNode;
  depth: number;
  activePath: string | null;
  renamingPath: string | null;
  selectedPaths: Set<string>;
  collapseAllKey: number;
  onSelect: (path: string, multi: boolean) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onStartRename: (path: string) => void;
  onConfirmRename: (path: string, newName: string) => void;
  onCancelRename: () => void;
}

function TreeItem({
  node, depth, activePath, renamingPath, selectedPaths, collapseAllKey,
  onSelect, onDelete, onNewFile, onNewFolder,
  onStartRename, onConfirmRename, onCancelRename,
}: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth === 0);

  // Collapse all folders when collapseAllKey increments (except workspace root at depth 0)
  useEffect(() => {
    if (collapseAllKey > 0 && node.type === "directory") {
      setExpanded(false);
    }
  }, [collapseAllKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const isSelected = activePath === node.path;
  const isMulti    = selectedPaths.has(node.path);
  const isRenaming = renamingPath === node.path;
  const indent     = depth * 10 + 8;

  // Hide dotfiles (but not .vesper — it's internal, just ignore it)
  if (node.name.startsWith(".")) return null;

  const btnHover = "h-4 w-4 flex items-center justify-center rounded hover:bg-[#1e1e2e] text-[#9898b8] hover:text-foreground transition-colors";

  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-0.5 cursor-pointer group rounded select-none hover:bg-[#141420] text-[#a0a0c0]"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setExpanded(e => !e)}
          onDoubleClick={() => onStartRename(node.path)}
        >
          <span className="mr-0.5 text-[#9898b8] shrink-0">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {expanded
            ? <FolderOpen className="h-3.5 w-3.5 mr-1 text-blue-400 shrink-0" />
            : <Folder     className="h-3.5 w-3.5 mr-1 text-blue-400 shrink-0" />}
          {isRenaming ? (
            <InlineRename
              initialValue={node.name}
              onConfirm={n => onConfirmRename(node.path, n)}
              onCancel={onCancelRename}
            />
          ) : (
            <span className="truncate flex-1 text-[12px]">{node.name}</span>
          )}
          {!isRenaming && (
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pr-1" onClick={e => e.stopPropagation()}>
              <button className={btnHover} title="Rename (F2)" onClick={() => onStartRename(node.path)}><Pencil className="h-2.5 w-2.5" /></button>
              <button className={btnHover} title="New file" onClick={() => onNewFile(node.path)}><FilePlus className="h-2.5 w-2.5" /></button>
              <button className={btnHover} title="New folder" onClick={() => onNewFolder(node.path)}><FolderPlus className="h-2.5 w-2.5" /></button>
              <button className={`${btnHover} hover:text-red-400`} title="Delete folder" onClick={() => onDelete(node.path, true)}><Trash2 className="h-2.5 w-2.5" /></button>
            </div>
          )}
        </div>
        {expanded && node.children?.map((child: FileNode) => (
          <TreeItem
            key={child.path}
            node={child}
            depth={depth + 1}
            activePath={activePath}
            renamingPath={renamingPath}
            selectedPaths={selectedPaths}
            collapseAllKey={collapseAllKey}
            onSelect={onSelect}
            onDelete={onDelete}
            onNewFile={onNewFile}
            onNewFolder={onNewFolder}
            onStartRename={onStartRename}
            onConfirmRename={onConfirmRename}
            onCancelRename={onCancelRename}
          />
        ))}
      </div>
    );
  }

  const fileActive = isSelected || isMulti;
  return (
    <div
      className={`flex items-center py-0.5 cursor-pointer group rounded select-none transition-colors ${
        isMulti
          ? "bg-primary/20 text-foreground ring-[1px] ring-inset ring-primary/30"
          : isSelected
            ? "bg-primary/15 text-foreground"
            : "text-[#8080a0] hover:bg-[#141420]"
      }`}
      style={{ paddingLeft: `${indent + 14}px` }}
      onClick={e => onSelect(node.path, e.ctrlKey || e.metaKey || e.shiftKey)}
      onDoubleClick={() => onStartRename(node.path)}
      title={node.path}
    >
      <FileIcon2 name={node.name} />
      {isRenaming ? (
        <span className="ml-1.5 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
          <InlineRename
            initialValue={node.name}
            onConfirm={n => onConfirmRename(node.path, n)}
            onCancel={onCancelRename}
          />
        </span>
      ) : (
        <span className={`truncate ml-1.5 text-[12px] flex-1 ${fileActive ? "font-semibold text-foreground" : ""}`}>
          {node.name}
        </span>
      )}
      {isMulti && !isRenaming && (
        <div className="shrink-0 pr-1.5">
          <div className="h-4 w-4 rounded bg-primary/80 flex items-center justify-center">
            <Check className="h-2.5 w-2.5 text-white" />
          </div>
        </div>
      )}
      {!isRenaming && !isMulti && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 pr-1 gap-0.5" onClick={e => e.stopPropagation()}>
          <button className={btnHover} title="Rename (F2)" onClick={() => onStartRename(node.path)}><Pencil className="h-2.5 w-2.5" /></button>
          <button className={`${btnHover} hover:text-red-400`} title="Delete" onClick={() => onDelete(node.path, false)}><Trash2 className="h-2.5 w-2.5" /></button>
        </div>
      )}
    </div>
  );
}

// ── Workspace Switcher ────────────────────────────────────────────────────────
function WorkspaceSwitcher() {
  const { workspaces, currentWorkspace, switchWorkspace, createWorkspace, isLoading } = useWorkspace();
  const [open, setOpen]       = useState(false);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [busy, setBusy]       = useState(false);
  const wrapRef               = useRef<HTMLDivElement>(null);
  const inputRef              = useRef<HTMLInputElement>(null);
  const { toast }             = useToast();
  const listboxId             = useId();

  // Close on click-outside
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  useEffect(() => {
    if (creating) setTimeout(() => inputRef.current?.focus(), 50);
  }, [creating]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      await createWorkspace(newName.trim());
      toast({ description: `Workspace "${newName.trim()}" created` });
      setNewName("");
      setCreating(false);
      setOpen(false);
    } catch (err: any) {
      toast({ description: err?.message ?? "Failed to create workspace", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  const label = currentWorkspace ? currentWorkspace.name : "Global";
  const langColor = currentWorkspace?.language === "python"
    ? "text-green-400"
    : currentWorkspace?.language === "js"
      ? "text-blue-400"
      : "text-[#9898b8]";

  return (
    <div ref={wrapRef} className="relative">
      {/* Trigger */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        title={`Active workspace: ${label}`}
        className="flex items-center gap-1.5 h-6 px-2 rounded-lg border border-[#1e1e2e]
          bg-[#141420] text-[11px] font-semibold text-[#a0a0c0] max-w-[130px]
          hover:border-primary/40 hover:text-foreground transition-all select-none"
      >
        <Layers className="h-3 w-3 shrink-0 text-primary/60" />
        <span className="truncate flex-1">{label}</span>
        <ChevronDown className={`h-2.5 w-2.5 shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Dropdown */}
      {open && (
        <div
          id={listboxId}
          role="listbox"
          aria-label="Select workspace"
          className="absolute top-full left-0 mt-1.5 z-50 w-64 rounded-xl border border-[#1a1a24]
            bg-[#0b0b0e] shadow-2xl shadow-black/70 overflow-hidden"
        >
          {/* Header */}
          <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
            <p className="text-[9px] text-[#7878a8] uppercase tracking-widest font-bold">Workspaces</p>
            {isLoading && <Loader2 className="h-3 w-3 animate-spin text-[#7878a8]" />}
          </div>

          {/* Global option */}
          <div className="px-1.5">
            <button
              role="option"
              aria-selected={!currentWorkspace}
              onClick={() => { switchWorkspace(null); setOpen(false); }}
              className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] flex items-center gap-2 transition-colors
                ${!currentWorkspace
                  ? "bg-primary/10 text-primary border border-primary/15"
                  : "text-[#9898b8] hover:bg-[#111118] hover:text-foreground"
                }`}
            >
              <FolderOpen className="h-3.5 w-3.5 shrink-0" />
              <span className="font-semibold">Global (root)</span>
              {!currentWorkspace && <Check className="h-3 w-3 ml-auto opacity-60" />}
            </button>
          </div>

          {/* Named workspaces */}
          {workspaces.length > 0 && (
            <div className="px-1.5 mt-0.5 max-h-[200px] overflow-y-auto space-y-0.5">
              {workspaces.map(ws => {
                const isActive = currentWorkspace?.id === ws.id;
                return (
                  <button
                    key={ws.id}
                    role="option"
                    aria-selected={isActive}
                    onClick={() => { switchWorkspace(ws); setOpen(false); }}
                    className={`w-full text-left px-2.5 py-2 rounded-lg text-[11px] flex items-center gap-2 transition-colors
                      ${isActive
                        ? "bg-primary/10 text-primary border border-primary/15"
                        : "text-[#9898b8] hover:bg-[#111118] hover:text-foreground"
                      }`}
                  >
                    <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                      ws.language === "python" ? "bg-green-400"
                      : ws.language === "js" ? "bg-blue-400"
                      : "bg-[#7878a8]"
                    }`} />
                    <span className="font-semibold truncate flex-1">{ws.name}</span>
                    <span className="opacity-40 text-[9px] shrink-0">
                      {ws.language === "python" ? "py" : ws.language === "js" ? "js" : "?"}
                    </span>
                    {isActive && <Check className="h-3 w-3 opacity-60" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* New workspace form */}
          <div className="px-1.5 pb-2 mt-1 border-t border-[#111118] pt-2">
            {creating ? (
              <div className="px-1 space-y-1.5">
                <input
                  ref={inputRef}
                  className="w-full h-8 px-2.5 text-xs bg-[#141420] border border-[#1e1e2e]
                    focus:border-primary/50 rounded-lg outline-none text-foreground placeholder:text-[#7878a8]"
                  placeholder="Project name…"
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setCreating(false); setNewName(""); }
                  }}
                  disabled={busy}
                />
                <div className="flex gap-1.5">
                  <button
                    onClick={handleCreate}
                    disabled={!newName.trim() || busy}
                    className="flex-1 h-7 text-[11px] font-bold bg-primary text-primary-foreground
                      rounded-lg hover:bg-primary/80 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
                  >
                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    Create
                  </button>
                  <button
                    onClick={() => { setCreating(false); setNewName(""); }}
                    className="h-7 px-2 text-[11px] border border-[#1e1e2e] rounded-lg text-[#9898b8]
                      hover:text-foreground hover:bg-[#141420] transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-[11px]
                  text-[#7878a8] hover:bg-[#111118] hover:text-foreground transition-colors"
              >
                <Plus className="h-3 w-3" />
                New workspace
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── No-Workspace Onboarding Panel ────────────────────────────────────────────
function NoWorkspacePanel() {
  const {
    workspaces, isLoading, createWorkspace, switchWorkspace,
  } = useWorkspace();
  const { toast }           = useToast();
  const [name, setName]     = useState("");
  const [busy, setBusy]     = useState(false);
  const inputRef            = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await createWorkspace(name.trim());
      toast({ description: `Workspace "${name.trim()}" created` });
      setName("");
    } catch (err: any) {
      toast({ description: err?.message ?? "Failed to create workspace", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-5 py-8 gap-6">
      {/* Icon + headline */}
      <div className="text-center space-y-2">
        <div className="h-14 w-14 mx-auto rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Layers className="h-7 w-7 text-primary/70" />
        </div>
        <h2 className="text-sm font-bold text-foreground">Workspace Required</h2>
        <p className="text-[11px] text-[#9898b8] leading-relaxed max-w-[220px]">
          Each project lives in its own isolated folder with separate files and dependencies.
        </p>
      </div>

      {/* Create new workspace */}
      <div className="w-full space-y-2">
        <p className="text-[10px] font-bold text-[#7878a8] uppercase tracking-widest">Create workspace</p>
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            className="flex-1 h-9 px-3 text-xs bg-[#141420] border border-[#1e1e2e]
              focus:border-primary/50 rounded-xl outline-none text-foreground
              placeholder:text-[#7878a8] disabled:opacity-50"
            placeholder="Project name…"
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleCreate(); }}
            disabled={busy}
          />
          <button
            onClick={handleCreate}
            disabled={!name.trim() || busy}
            className="h-9 px-3 text-xs font-bold bg-primary text-primary-foreground
              rounded-xl hover:bg-primary/80 disabled:opacity-40 transition-colors
              flex items-center gap-1.5 shrink-0"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Create
          </button>
        </div>
      </div>

      {/* Switch to existing */}
      {(isLoading || workspaces.length > 0) && (
        <div className="w-full space-y-1.5">
          <p className="text-[10px] font-bold text-[#7878a8] uppercase tracking-widest">
            {isLoading ? "Loading…" : "Existing workspaces"}
          </p>
          {isLoading ? (
            <div className="flex justify-center py-3">
              <Loader2 className="h-4 w-4 animate-spin text-[#7878a8]" />
            </div>
          ) : (
            <div className="space-y-1">
              {workspaces.map(ws => (
                <button
                  key={ws.id}
                  onClick={() => switchWorkspace(ws)}
                  className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl
                    bg-[#141420] border border-[#1a1a24] hover:border-primary/30
                    hover:bg-[#111118] transition-all text-left group"
                >
                  <div className={`h-2 w-2 rounded-full shrink-0 ${
                    ws.language === "python" ? "bg-green-400"
                    : ws.language === "js" ? "bg-blue-400"
                    : "bg-[#7878a8]"
                  }`} />
                  <span className="text-xs font-semibold text-foreground truncate flex-1">
                    {ws.name}
                  </span>
                  <span className="text-[9px] text-[#7878a8] shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    Open →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Install Dependency Panel ──────────────────────────────────────────────────
function InstallDepPanel({ onClose }: { onClose: () => void }) {
  const { currentWorkspace, installDep, installState, deps, lockfile, lastInstallTool, refreshDeps } = useWorkspace();
  const [pkg, setPkg]         = useState("");
  const [ver, setVer]         = useState("");
  const [showDeps, setShowDeps] = useState(true);
  const { toast }             = useToast();
  const inputRef              = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    refreshDeps();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleInstall = async () => {
    if (!pkg.trim()) return;
    try {
      await installDep(pkg.trim(), ver.trim() || undefined);
      toast({ description: `${pkg.trim()} installed into "${currentWorkspace?.name}"` });
      setPkg("");
      setVer("");
    } catch (err: any) {
      toast({ description: err?.message ?? "Install failed", variant: "destructive" });
    }
  };

  const isRunning  = installState.status === "running";
  const lang       = currentWorkspace?.language ?? "unknown";

  const lockfileColor = lockfile === "uv.lock"
    ? "text-green-400 border-green-500/30 bg-green-500/10"
    : lockfile === "package-lock.json"
      ? "text-blue-400 border-blue-500/30 bg-blue-500/10"
      : "";

  return (
    <div className="shrink-0 border-t border-[#1a1a24] bg-[#0a0a0c]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a24]">
        <div className="flex items-center gap-1.5 flex-wrap">
          <PackagePlus className="h-3.5 w-3.5 text-primary/70 shrink-0" />
          <span className="text-[11px] font-bold text-[#9898b8] uppercase tracking-wider">Install</span>
          {lang !== "unknown" && (
            <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border
              ${lang === "python"
                ? "text-green-400 border-green-500/30 bg-green-500/10"
                : "text-blue-400 border-blue-500/30 bg-blue-500/10"
              }`}>
              {lang === "python" ? "uv add" : "npm"}
            </span>
          )}
          {lockfile && (
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${lockfileColor} flex items-center gap-0.5`}>
              <span className="h-1.5 w-1.5 rounded-full bg-current inline-block" />
              {lockfile}
            </span>
          )}
          {lastInstallTool && !lockfile && (
            <span className="text-[9px] text-[#7878a8]">via {lastInstallTool}</span>
          )}
        </div>
        <button
          onClick={onClose}
          className="h-5 w-5 flex items-center justify-center rounded text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-colors"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      {/* Input row */}
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex gap-1.5">
          <input
            ref={inputRef}
            className="flex-1 h-7 px-2.5 text-xs bg-[#141420] border border-[#1e1e2e]
              focus:border-primary/50 rounded-lg outline-none text-foreground
              placeholder:text-[#7878a8] disabled:opacity-50"
            placeholder={lang === "js" ? "lodash / @types/node" : "requests / numpy==1.26"}
            value={pkg}
            onChange={e => setPkg(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleInstall(); }}
            disabled={isRunning}
          />
          <input
            className="w-20 h-7 px-2 text-xs bg-[#141420] border border-[#1e1e2e]
              focus:border-primary/50 rounded-lg outline-none text-foreground
              placeholder:text-[#7878a8] disabled:opacity-50"
            placeholder="version"
            value={ver}
            onChange={e => setVer(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") handleInstall(); }}
            disabled={isRunning}
          />
          <button
            onClick={handleInstall}
            disabled={!pkg.trim() || isRunning}
            className="h-7 px-2.5 text-[11px] font-bold bg-primary text-primary-foreground
              rounded-lg hover:bg-primary/80 disabled:opacity-40 transition-colors
              flex items-center gap-1 shrink-0"
          >
            {isRunning
              ? <Loader2 className="h-3 w-3 animate-spin" />
              : <PackagePlus className="h-3 w-3" />
            }
            {isRunning ? "…" : "Install"}
          </button>
        </div>

        {/* Status output */}
        {installState.status !== "idle" && (
          <div className={`flex items-start gap-2 p-2 rounded-lg text-[10px] leading-relaxed
            ${installState.status === "error"
              ? "bg-red-500/10 border border-red-500/20 text-red-400"
              : installState.status === "done"
                ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-400"
                : "bg-primary/10 border border-primary/20 text-primary/80"
            }`}>
            {installState.status === "running" && <Loader2 className="h-3 w-3 animate-spin shrink-0 mt-px" />}
            {installState.status === "done" && <CheckCircle2 className="h-3 w-3 shrink-0 mt-px" />}
            {installState.status === "error" && <AlertCircle className="h-3 w-3 shrink-0 mt-px" />}
            <span className="font-mono break-all">{installState.message}</span>
          </div>
        )}
      </div>

      {/* Installed packages */}
      <div className="border-t border-[#111118]">
        <button
          onClick={() => setShowDeps(v => !v)}
          className="w-full flex items-center justify-between px-3 py-1.5 hover:bg-[#141420] transition-colors"
        >
          <div className="flex items-center gap-1.5">
            {showDeps ? <ChevronDown className="h-3 w-3 text-[#9898b8]" /> : <ChevronRight className="h-3 w-3 text-[#9898b8]" />}
            <Package className="h-3 w-3 text-[#9898b8]" />
            <span className="text-[10px] font-bold text-[#9898b8] uppercase tracking-wider">Installed</span>
            <span className="text-[9px] bg-[#1a1a24] text-[#7878a8] rounded px-1">{deps.length}</span>
          </div>
        </button>

        {showDeps && (
          <div className="max-h-28 overflow-y-auto">
            {deps.length === 0 ? (
              <p className="text-center py-3 text-[10px] text-[#7878a8]">No packages installed yet</p>
            ) : (
              <div className="px-3 pb-2 flex flex-wrap gap-1">
                {deps.map(d => (
                  <span
                    key={d.name}
                    className="text-[9px] bg-[#0f0f16] border border-[#1a1a24] rounded-md px-1.5 py-0.5 text-[#9898b8] leading-none"
                  >
                    {d.name}
                    {d.version && <span className="opacity-50 ml-1">{d.version}</span>}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Flat file search helper ───────────────────────────────────────────────────
function findMatchingFiles(node: FileNode, query: string): FileNode[] {
  if (!node) return [];
  if (!node.children) {
    return node.name.toLowerCase().includes(query.toLowerCase()) ? [node] : [];
  }
  return node.children.flatMap(child => findMatchingFiles(child, query));
}

// ── Main FileExplorer ─────────────────────────────────────────────────────────
interface NewItemState { type: "file" | "folder"; parentPath: string; }

export function FileExplorer({ activePath }: { activePath: string | null }) {
  const { openFileInEditor, importedProject, toggleSidebarPanel } = useIDE();
  const { currentWorkspace, refreshWorkspaces }                   = useWorkspace();
  const { toast }                                                  = useToast();
  const [showImported, setShowImported]   = useState(true);
  const [showInstallDep, setShowInstallDep] = useState(false);
  const queryClient                         = useQueryClient();

  const [showImportExport, setShowImportExport] = useState(false);
  const [newItem, setNewItem]           = useState<NewItemState | null>(null);
  const [newItemName, setNewItemName]   = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const newItemInputRef                 = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery]   = useState("");
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [collapseAllKey, setCollapseAllKey] = useState(0);

  // ── Workspace-scoped tree path ───────────────────────────────────────────
  // Only query the file tree when a workspace is actually selected.
  // When null, we show the <NoWorkspacePanel> onboarding UI instead of
  // loading the raw monorepo root (which would expose internal folders like
  // artifacts/, lib/, python-backend/, etc.)
  const treePath  = currentWorkspace?.relPath ?? "";
  const treeDepth = 6;
  const treeEnabled = !!currentWorkspace;

  const { data: treeData, isLoading, refetch } = useGetFileTree(
    { path: treePath, depth: treeDepth },
    {
      query: {
        queryKey: getGetFileTreeQueryKey({ path: treePath, depth: treeDepth }),
        enabled:  treeEnabled,
      },
    },
  );

  // When workspace changes, invalidate cache and clear selection / rename state
  useEffect(() => {
    if (treeEnabled) {
      queryClient.invalidateQueries({ queryKey: getGetFileTreeQueryKey({ path: treePath, depth: treeDepth }) });
    }
    setSelectedPaths(new Set());
    setRenamingPath(null);
    setNewItem(null);
    setShowInstallDep(false);
    setCollapseAllKey(0); // reset collapse state so the new tree opens fully
  }, [treePath]); // eslint-disable-line react-hooks/exhaustive-deps

  const createFileMutation = useCreateFile();
  const deleteFileMutation = useDeleteFile();
  const renameFileMutation = useRenameFile();

  useEffect(() => {
    if (newItem) setTimeout(() => newItemInputRef.current?.focus(), 50);
  }, [newItem]);

  // ── Multi-select ─────────────────────────────────────────────────────────
  const handleSelect = useCallback((path: string, multi: boolean) => {
    if (multi) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        next.has(path) ? next.delete(path) : next.add(path);
        return next;
      });
    } else {
      setSelectedPaths(new Set());
      openFileInEditor(path);
    }
  }, [openFileInEditor]);

  const openAllSelected = useCallback(() => {
    selectedPaths.forEach(p => openFileInEditor(p));
    setSelectedPaths(new Set());
  }, [selectedPaths, openFileInEditor]);

  // ── Create file/folder ───────────────────────────────────────────────────
  // Default parent is the workspace root (not the global root)
  const wsRootPath = currentWorkspace?.relPath ?? "";

  const handleCreate = async () => {
    if (!newItem || !newItemName.trim()) { setNewItem(null); return; }
    // If parentPath is empty treat it as workspace root
    const base = newItem.parentPath || wsRootPath;
    const fullPath = base ? `${base}/${newItemName.trim()}` : newItemName.trim();
    try {
      await createFileMutation.mutateAsync({ data: { path: fullPath, type: newItem.type } });
      await refetch();
      if (newItem.type === "file") openFileInEditor(fullPath);
      toast({ description: `Created "${newItemName.trim()}"` });
    } catch (e: any) {
      toast({ description: e?.message || "Failed to create", variant: "destructive" });
    }
    setNewItem(null);
    setNewItemName("");
  };

  // ── Delete ───────────────────────────────────────────────────────────────
  const handleDelete = async (path: string, isDir: boolean) => {
    const name = path.split("/").pop();
    if (!confirm(`Delete "${name}"?\n${isDir ? "This will delete the folder and all its contents." : "This cannot be undone."}`)) return;
    try {
      await deleteFileMutation.mutateAsync({ params: { path } });
      await refetch();
      toast({ description: `Deleted "${name}"` });
    } catch {
      toast({ description: "Failed to delete", variant: "destructive" });
    }
  };

  // ── Rename ───────────────────────────────────────────────────────────────
  const handleConfirmRename = async (oldPath: string, newName: string) => {
    setRenamingPath(null);
    const parts = oldPath.split("/");
    parts[parts.length - 1] = newName;
    const newPath = parts.join("/");
    if (newPath === oldPath) return;
    try {
      await renameFileMutation.mutateAsync({ data: { old_path: oldPath, new_path: newPath } });
      await refetch();
      toast({ description: `Renamed to "${newName}"` });
    } catch (e: any) {
      toast({ description: e?.message || "Failed to rename", variant: "destructive" });
    }
  };

  // ── Export workspace ─────────────────────────────────────────────────────
  const exportWorkspace = () => {
    const a = document.createElement("a");
    a.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/files/export`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ description: "Exporting workspace…" });
  };

  // ── Clear workspace ──────────────────────────────────────────────────────
  const clearWorkspace = async () => {
    if (!confirm("Start fresh? This will delete ALL files in the current workspace. Cannot be undone.")) return;
    const tree = treeData?.tree;
    if (!tree?.children) return;
    let deleted = 0;
    for (const node of tree.children) {
      try {
        await deleteFileMutation.mutateAsync({ params: { path: node.path } });
        deleted++;
      } catch { /* continue */ }
    }
    await refetch();
    setSelectedPaths(new Set());
    toast({ description: `Cleared — ${deleted} item${deleted !== 1 ? "s" : ""} removed.` });
  };

  // Compute search results
  const searchResults = searchQuery.trim() && treeData?.tree
    ? findMatchingFiles(treeData.tree, searchQuery.trim())
    : null;

  const multiCount = selectedPaths.size;

  const iconBtn = "h-5 w-5 flex items-center justify-center rounded text-[#9898b8] hover:text-[#a0a0c0] hover:bg-[#141420] transition-colors";

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0a0a0c]">

      {/* ── Desktop header ───────────────────────────────────────────────── */}
      <div className="hidden md:flex flex-col border-b border-[#1a1a24] shrink-0">
        {/* Row 1: collapse + workspace-aware title + action icons */}
        <div className="flex items-center justify-between px-2 py-1.5">
          <div className="flex items-center gap-1 min-w-0">
            <button
              onClick={() => toggleSidebarPanel("files")}
              className={`${iconBtn} shrink-0`}
              title="Collapse explorer"
            >
              <ChevronsLeft className="h-3 w-3" />
            </button>
            <span className="text-[10px] font-bold text-[#7878a8] uppercase tracking-widest select-none pl-1 shrink-0">
              {currentWorkspace ? "Workspace" : "Explorer"}
            </span>
            {currentWorkspace?.language && currentWorkspace.language !== "unknown" && (
              <span className={`text-[8px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border leading-none shrink-0
                ${currentWorkspace.language === "python"
                  ? "text-green-400 border-green-500/30 bg-green-500/10"
                  : "text-blue-400 border-blue-500/30 bg-blue-500/10"
                }`}>
                {currentWorkspace.language === "python" ? "py" : "js"}
              </span>
            )}
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            {treeEnabled && (
              <button
                className={`${iconBtn}`}
                title="Collapse all folders"
                onClick={() => setCollapseAllKey(k => k + 1)}
              >
                <ChevronsUpDown className="h-3 w-3" />
              </button>
            )}
            {[
              { icon: FilePlus,    title: "New file",    onClick: () => { setNewItem({ type: "file",   parentPath: wsRootPath }); setNewItemName(""); } },
              { icon: FolderPlus, title: "New folder",  onClick: () => { setNewItem({ type: "folder", parentPath: wsRootPath }); setNewItemName(""); } },
              { icon: RefreshCw,  title: "Refresh",     onClick: () => { refetch(); refreshWorkspaces(); } },
              { icon: Upload,     title: "Import files (zip/GitHub)", onClick: () => setShowImportExport(true) },
              { icon: Download,   title: "Export workspace", onClick: exportWorkspace },
              { icon: FolderX,    title: "Start fresh", onClick: clearWorkspace },
            ].map(({ icon: Icon, title, onClick }) => (
              <button
                key={title}
                className={`${iconBtn} last:hover:text-red-400`}
                title={title}
                onClick={onClick}
              >
                <Icon className="h-3 w-3" />
              </button>
            ))}
            <button
              onClick={() => setShowInstallDep(v => !v)}
              className={`${iconBtn} ${showInstallDep ? "text-primary" : ""}`}
              title="Toggle dependencies panel"
            >
              <PackagePlus className="h-3 w-3" />
            </button>
            <FolderImportButton />
          </div>
        </div>

        {/* Row 2: workspace switcher + context path */}
        <div className="px-2 pb-1.5 flex items-center gap-1.5">
          <WorkspaceSwitcher />
          {currentWorkspace && (
            <span className="text-[9px] text-[#505070] truncate">
              workspaces/{currentWorkspace.id}
            </span>
          )}
        </div>
      </div>

      {/* ── Multi-select action bar (desktop) ────────────────────────────── */}
      {multiCount > 0 && (
        <div className="hidden md:flex items-center justify-between px-3 py-1.5 bg-primary/10 border-b border-primary/20 shrink-0">
          <span className="text-[11px] font-semibold text-primary">
            {multiCount} file{multiCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={openAllSelected}
              className="h-6 px-2.5 text-[11px] font-bold bg-primary text-primary-foreground rounded-lg hover:bg-primary/80 transition-colors"
            >
              Open all
            </button>
            <button
              onClick={() => setSelectedPaths(new Set())}
              className="h-6 w-6 flex items-center justify-center rounded-lg text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-colors"
              title="Clear selection"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile header ────────────────────────────────────────────────── */}
      <div className="md:hidden flex flex-col gap-2.5 px-3 pt-3 pb-2 border-b border-[#1a1a24] shrink-0">
        {/* Workspace switcher row on mobile */}
        <div className="flex items-center gap-2">
          <WorkspaceSwitcher />
          <button
            onClick={() => setShowInstallDep(v => !v)}
            className="flex items-center gap-1.5 h-8 px-3 rounded-xl bg-[#141420] border border-[#1a1a24]
              text-[11px] font-semibold text-[#9898b8] active:bg-[#1e1e2e] transition-all"
          >
            <PackagePlus className="h-3.5 w-3.5" />
            Deps
          </button>
        </div>

        <FolderImportLargeButton />

        <div className="flex gap-2">
          {[
            { icon: FilePlus,   label: "New File",   onClick: () => { setNewItem({ type: "file",   parentPath: wsRootPath }); setNewItemName(""); } },
            { icon: FolderPlus, label: "New Folder", onClick: () => { setNewItem({ type: "folder", parentPath: wsRootPath }); setNewItemName(""); } },
            { icon: Upload,     label: "Import Zip", onClick: () => setShowImportExport(true) },
            { icon: RefreshCw,  label: "Refresh",    onClick: () => { refetch(); refreshWorkspaces(); } },
          ].map(({ icon: Icon, label, onClick }) => (
            <button key={label} onClick={onClick}
              className="flex-1 flex flex-col items-center justify-center gap-1 h-14 rounded-2xl
                bg-[#141420] border border-[#1a1a24] active:bg-[#1e1e2e] active:scale-[0.97]
                transition-all text-[#7070a0]"
            >
              <Icon className="h-4 w-4" />
              <span className="text-[10px] font-semibold leading-none">{label}</span>
            </button>
          ))}
        </div>

        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#9898b8] pointer-events-none" />
          <input
            className="w-full h-11 pl-10 pr-4 bg-[#141420] border border-[#1a1a24]
              focus:border-primary/40 rounded-xl text-sm text-foreground
              placeholder:text-[#7878a8] outline-none transition-colors"
            placeholder="Search files…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="absolute right-3 top-1/2 -translate-y-1/2 text-[#9898b8] active:text-foreground" onClick={() => setSearchQuery("")}>
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* ── No workspace selected: show onboarding ───────────────────────── */}
      {!currentWorkspace ? (
        <NoWorkspacePanel />
      ) : (
        <>
          {/* ── New-item creation input ─────────────────────────────────── */}
          {newItem && (
            <div className="px-2 py-1.5 border-b border-[#1a1a24] shrink-0 bg-[#0d0d12]">
              <p className="text-[10px] text-[#9898b8] mb-1">
                New {newItem.type} in {currentWorkspace.name}
              </p>
              <div className="flex gap-1">
                <input
                  ref={newItemInputRef}
                  className="flex-1 text-xs bg-[#141420] border border-[#1a1a24] focus:border-primary/60 rounded px-2 py-1 outline-none text-foreground transition-colors"
                  placeholder={newItem.type === "file" ? "filename.ts" : "folder-name"}
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter") handleCreate();
                    if (e.key === "Escape") { setNewItem(null); setNewItemName(""); }
                  }}
                />
                <button className="h-6 px-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors" onClick={handleCreate}>
                  <Check className="h-3 w-3" />
                </button>
                <button className="h-6 px-1.5 text-xs border border-[#1a1a24] rounded hover:bg-[#141420] text-[#9898b8] transition-colors" onClick={() => { setNewItem(null); setNewItemName(""); }}>
                  <X className="h-3 w-3" />
                </button>
              </div>
            </div>
          )}

          {/* ── Empty workspace state ──────────────────────────────────── */}
          {!isLoading && treeData?.tree && !treeData.tree.children?.length && (
            <div className="px-3 py-6 text-center shrink-0">
              <FolderOpen className="h-8 w-8 mx-auto mb-2 text-[#7878a8] opacity-40" />
              <p className="text-[11px] text-[#7878a8] mb-3">"{currentWorkspace.name}" is empty</p>
              <div className="flex gap-2 justify-center">
                <button
                  onClick={() => { setNewItem({ type: "file", parentPath: wsRootPath }); setNewItemName(""); }}
                  className="h-7 px-3 text-[11px] font-semibold bg-primary/10 text-primary border border-primary/25 rounded-lg hover:bg-primary/20 transition-colors"
                >
                  + New file
                </button>
                <button
                  onClick={() => setShowInstallDep(true)}
                  className="h-7 px-3 text-[11px] font-semibold bg-[#141420] text-[#9898b8] border border-[#1e1e2e] rounded-lg hover:bg-[#1e1e2e] hover:text-foreground transition-colors"
                >
                  Install dep
                </button>
              </div>
            </div>
          )}

          {/* ── File tree ──────────────────────────────────────────────── */}
          <ScrollArea className={importedProject ? "h-[40%]" : "flex-1"}>
            <div className="p-1">
              {isLoading ? (
                <div className="flex items-center justify-center py-8 text-[#9898b8]">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              ) : searchResults !== null ? (
                searchResults.length === 0 ? (
                  <p className="text-center py-8 text-[#9898b8] text-xs">No files match "{searchQuery}"</p>
                ) : (
                  <div className="py-1">
                    {searchResults.map(file => (
                      <button
                        key={file.path}
                        onClick={() => { openFileInEditor(file.path); setSearchQuery(""); }}
                        className="w-full flex items-center gap-2.5 px-3 py-3 text-left
                          text-sm text-[#a0a0c0] active:bg-[#141420] transition-colors rounded-lg"
                      >
                        <FileIcon2 name={file.name} />
                        <div className="min-w-0">
                          <p className="font-medium text-foreground truncate">{file.name}</p>
                          <p className="text-[11px] text-[#9898b8] truncate">{file.path}</p>
                        </div>
                      </button>
                    ))}
                  </div>
                )
              ) : treeData?.tree ? (
                <TreeItem
                  node={treeData.tree}
                  depth={0}
                  activePath={activePath}
                  renamingPath={renamingPath}
                  selectedPaths={selectedPaths}
                  collapseAllKey={collapseAllKey}
                  onSelect={handleSelect}
                  onDelete={handleDelete}
                  onNewFile={dir  => { setNewItem({ type: "file",   parentPath: dir }); setNewItemName(""); }}
                  onNewFolder={dir => { setNewItem({ type: "folder", parentPath: dir }); setNewItemName(""); }}
                  onStartRename={path => setRenamingPath(path)}
                  onConfirmRename={handleConfirmRename}
                  onCancelRename={() => setRenamingPath(null)}
                />
              ) : (
                <p className="text-center py-8 text-[#9898b8] text-xs">No files found</p>
              )}
            </div>
          </ScrollArea>

          {/* ── Imported project section ───────────────────────────────── */}
          {importedProject && (
            <div className="flex-1 flex flex-col min-h-0 border-t border-[#1a1a24]">
              <button
                className="shrink-0 flex items-center justify-between px-3 py-1.5 hover:bg-[#141420] transition-colors"
                onClick={() => setShowImported(v => !v)}
              >
                <div className="flex items-center gap-1.5">
                  {showImported ? <ChevronDown className="h-3 w-3 text-[#9898b8]" /> : <ChevronRight className="h-3 w-3 text-[#9898b8]" />}
                  <FolderOpen className="h-3.5 w-3.5 text-primary" />
                  <span className="text-[10px] font-bold text-primary uppercase tracking-widest">{importedProject.name}</span>
                </div>
                <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 font-bold">AI context</span>
              </button>
              {showImported && (
                <div className="flex-1 min-h-0">
                  <ImportedTree />
                </div>
              )}
            </div>
          )}

          {/* ── Install dependency panel ───────────────────────────────── */}
          {showInstallDep && (
            <InstallDepPanel onClose={() => setShowInstallDep(false)} />
          )}

          {/* ── Keyboard hint ──────────────────────────────────────────── */}
          {multiCount === 0 && !importedProject && !isLoading && treeData?.tree && !showInstallDep && (
            <div className="hidden md:block shrink-0 px-3 py-2 border-t border-[#1a1a24]">
              <p className="text-[10px] text-[#7878a8] leading-relaxed">
                Ctrl+Click or ⌘+Click to multi-select · workspace isolated
              </p>
            </div>
          )}
        </>
      )}

      {/* ── Import/Export modal ───────────────────────────────────────────── */}
      {showImportExport && (
        <ImportExportModal
          open={showImportExport}
          onClose={() => { refetch(); setShowImportExport(false); }}
        />
      )}
    </div>
  );
}
