/**
 * FileExplorer — VS Code-style file tree with:
 *  - Recursive tree view (hidden files filtered out)
 *  - Multi-select via Ctrl/Cmd+Click or Shift+Click; "Open all" action bar
 *  - File-type colour-coded icons
 *  - Create file / Create folder (inline input)
 *  - Rename file / folder (double-click or press F2)
 *  - Delete file / folder (confirmation dialog)
 *  - Import (zip / GitHub) via ImportExportModal
 *  - Export workspace as zip
 *  - Collapse sidebar shortcut
 *  - Start Fresh (clear workspace) button
 */
import { useState, useRef, useEffect, useCallback } from "react";
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
  ChevronsLeft, FolderX,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIDE } from "@/contexts/ide-context";
import { ImportExportModal } from "@/components/import-export-modal";
import { ImportedTree, FolderImportButton, FolderImportLargeButton } from "@/components/ide/imported-tree";

// ── File-type icon ─────────────────────────────────────────────────────────────
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
  return <FileIcon className="h-3.5 w-3.5 text-[#52526e] shrink-0" />;
}

// ── Inline rename input ────────────────────────────────────────────────────────
interface InlineRenameProps {
  initialValue: string;
  onConfirm: (newName: string) => void;
  onCancel: () => void;
}

function InlineRename({ initialValue, onConfirm, onCancel }: InlineRenameProps) {
  const [value, setValue] = useState(initialValue);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dot = value.lastIndexOf(".");
    el.setSelectionRange(0, dot > 0 ? dot : value.length);
  }, []);

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

// ── TreeItem ───────────────────────────────────────────────────────────────────
interface TreeItemProps {
  node: FileNode;
  depth: number;
  activePath: string | null;
  renamingPath: string | null;
  selectedPaths: Set<string>;
  onSelect: (path: string, multi: boolean) => void;
  onDelete: (path: string, isDir: boolean) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
  onStartRename: (path: string) => void;
  onConfirmRename: (path: string, newName: string) => void;
  onCancelRename: () => void;
}

function TreeItem({
  node, depth, activePath, renamingPath, selectedPaths,
  onSelect, onDelete, onNewFile, onNewFolder,
  onStartRename, onConfirmRename, onCancelRename,
}: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected  = activePath === node.path;
  const isMulti     = selectedPaths.has(node.path);
  const isRenaming  = renamingPath === node.path;
  const isHidden    = node.name.startsWith(".");

  if (isHidden) return null;

  const indent = depth * 10 + 8;

  const btnHover = "h-4 w-4 flex items-center justify-center rounded hover:bg-[#1e1e2e] text-[#52526e] hover:text-foreground transition-colors";

  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-0.5 cursor-pointer group rounded select-none hover:bg-[#141420] text-[#a0a0c0]"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setExpanded(e => !e)}
          onDoubleClick={() => onStartRename(node.path)}
        >
          <span className="mr-0.5 text-[#52526e] shrink-0">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {expanded
            ? <FolderOpen className="h-3.5 w-3.5 mr-1 text-blue-400 shrink-0" />
            : <Folder     className="h-3.5 w-3.5 mr-1 text-blue-400 shrink-0" />}

          {isRenaming ? (
            <InlineRename
              initialValue={node.name}
              onConfirm={newName => onConfirmRename(node.path, newName)}
              onCancel={onCancelRename}
            />
          ) : (
            <span className="truncate flex-1 text-[12px]">{node.name}</span>
          )}

          {!isRenaming && (
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pr-1" onClick={e => e.stopPropagation()}>
              <button className={btnHover} title="Rename (F2)" onClick={() => onStartRename(node.path)}>
                <Pencil className="h-2.5 w-2.5" />
              </button>
              <button className={btnHover} title="New file" onClick={() => onNewFile(node.path)}>
                <FilePlus className="h-2.5 w-2.5" />
              </button>
              <button className={btnHover} title="New folder" onClick={() => onNewFolder(node.path)}>
                <FolderPlus className="h-2.5 w-2.5" />
              </button>
              <button
                className={`${btnHover} hover:text-red-400`}
                title="Delete folder"
                onClick={() => onDelete(node.path, true)}
              >
                <Trash2 className="h-2.5 w-2.5" />
              </button>
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

  // ── File row ────────────────────────────────────────────────────────────────
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
      onClick={e => {
        const multi = e.ctrlKey || e.metaKey || e.shiftKey;
        onSelect(node.path, multi);
      }}
      onDoubleClick={() => onStartRename(node.path)}
      title={node.path}
    >
      <FileIcon2 name={node.name} />

      {isRenaming ? (
        <span className="ml-1.5 flex-1 min-w-0" onClick={e => e.stopPropagation()}>
          <InlineRename
            initialValue={node.name}
            onConfirm={newName => onConfirmRename(node.path, newName)}
            onCancel={onCancelRename}
          />
        </span>
      ) : (
        <span className={`truncate ml-1.5 text-[12px] flex-1 ${fileActive ? "font-semibold text-foreground" : ""}`}>
          {node.name}
        </span>
      )}

      {/* Multi-select checkmark */}
      {isMulti && !isRenaming && (
        <div className="shrink-0 pr-1.5">
          <div className="h-4 w-4 rounded bg-primary/80 flex items-center justify-center">
            <Check className="h-2.5 w-2.5 text-white" />
          </div>
        </div>
      )}

      {!isRenaming && !isMulti && (
        <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 pr-1 gap-0.5" onClick={e => e.stopPropagation()}>
          <button className={btnHover} title="Rename (F2)" onClick={() => onStartRename(node.path)}>
            <Pencil className="h-2.5 w-2.5" />
          </button>
          <button className={`${btnHover} hover:text-red-400`} title="Delete file" onClick={() => onDelete(node.path, false)}>
            <Trash2 className="h-2.5 w-2.5" />
          </button>
        </div>
      )}
    </div>
  );
}

// ── New-item creation state ───────────────────────────────────────────────────
interface NewItemState { type: "file" | "folder"; parentPath: string; }

// ── Flat file search helper ───────────────────────────────────────────────────
function findMatchingFiles(node: FileNode, query: string): FileNode[] {
  if (!node) return [];
  if (!node.children) {
    return node.name.toLowerCase().includes(query.toLowerCase()) ? [node] : [];
  }
  return node.children.flatMap(child => findMatchingFiles(child, query));
}

// ── Main FileExplorer ─────────────────────────────────────────────────────────
export function FileExplorer({ activePath }: { activePath: string | null }) {
  const { openFileInEditor, importedProject, toggleSidebarPanel } = useIDE();
  const { toast } = useToast();
  const [showImported, setShowImported] = useState(true);
  const queryClient = useQueryClient();

  const [showImportExport, setShowImportExport] = useState(false);
  const [newItem, setNewItem]           = useState<NewItemState | null>(null);
  const [newItemName, setNewItemName]   = useState("");
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const newItemInputRef                 = useRef<HTMLInputElement>(null);
  const [searchQuery, setSearchQuery]   = useState("");

  // ── Multi-select ─────────────────────────────────────────────────────────────
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  const { data: treeData, isLoading, refetch } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }) } },
  );

  const createFileMutation = useCreateFile();
  const deleteFileMutation = useDeleteFile();
  const renameFileMutation = useRenameFile();

  useEffect(() => {
    if (newItem) setTimeout(() => newItemInputRef.current?.focus(), 50);
  }, [newItem]);

  // ── Select handler (supports multi-select) ────────────────────────────────
  const handleSelect = useCallback((path: string, multi: boolean) => {
    if (multi) {
      setSelectedPaths(prev => {
        const next = new Set(prev);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
    } else {
      // Single click: clear selection and open the file
      setSelectedPaths(new Set());
      openFileInEditor(path);
    }
  }, [openFileInEditor]);

  // ── Open all selected files ───────────────────────────────────────────────
  const openAllSelected = useCallback(() => {
    selectedPaths.forEach(p => openFileInEditor(p));
    setSelectedPaths(new Set());
  }, [selectedPaths, openFileInEditor]);

  // ── Create file or folder ─────────────────────────────────────────────────
  const handleCreate = async () => {
    if (!newItem || !newItemName.trim()) { setNewItem(null); return; }
    const fullPath = newItem.parentPath
      ? `${newItem.parentPath}/${newItemName.trim()}`
      : newItemName.trim();
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

  // ── Delete file or folder ─────────────────────────────────────────────────
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

  // ── Rename ────────────────────────────────────────────────────────────────
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

  // ── Export workspace ──────────────────────────────────────────────────────
  const exportWorkspace = () => {
    const a = document.createElement("a");
    a.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/files/export`;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ description: "Exporting workspace…" });
  };

  // ── Clear workspace ───────────────────────────────────────────────────────
  const clearWorkspace = async () => {
    if (!confirm("Start fresh? This will delete ALL files in your workspace. This cannot be undone.")) return;
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
    toast({ description: `Workspace cleared — ${deleted} item${deleted !== 1 ? "s" : ""} removed.` });
  };

  // Compute search results (mobile only when query is non-empty)
  const searchResults = searchQuery.trim() && treeData?.tree
    ? findMatchingFiles(treeData.tree, searchQuery.trim())
    : null;

  const multiCount = selectedPaths.size;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#0a0a0c]">

      {/* ── Desktop header ───────────────────────────────────────────────── */}
      <div className="hidden md:flex items-center justify-between px-2 py-2 border-b border-[#1a1a24] shrink-0">
        <div className="flex items-center gap-1">
          {/* Collapse sidebar button */}
          <button
            onClick={() => toggleSidebarPanel("files")}
            className="h-5 w-5 flex items-center justify-center rounded text-[#3a3a5c] hover:text-[#a0a0c0] hover:bg-[#141420] transition-colors"
            title="Collapse explorer (click activity bar to reopen)"
          >
            <ChevronsLeft className="h-3 w-3" />
          </button>
          <span className="text-[10px] font-bold text-[#3a3a5c] uppercase tracking-widest select-none pl-1">
            Explorer
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          {[
            { icon: FilePlus,    title: "New file",                  onClick: () => { setNewItem({ type: "file",   parentPath: "" }); setNewItemName(""); } },
            { icon: FolderPlus, title: "New folder",                 onClick: () => { setNewItem({ type: "folder", parentPath: "" }); setNewItemName(""); } },
            { icon: RefreshCw,  title: "Refresh",                    onClick: () => refetch() },
            { icon: Upload,     title: "Import files (zip/GitHub)",  onClick: () => setShowImportExport(true) },
            { icon: Download,   title: "Export workspace",           onClick: exportWorkspace },
            { icon: FolderX,    title: "Start fresh (clear all files)", onClick: clearWorkspace },
          ].map(({ icon: Icon, title, onClick }) => (
            <button key={title}
              className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-[#a0a0c0] hover:bg-[#141420] transition-colors last:hover:text-red-400"
              title={title} onClick={onClick}
            >
              <Icon className="h-3 w-3" />
            </button>
          ))}
          <FolderImportButton />
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
              className="h-6 w-6 flex items-center justify-center rounded-lg text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors"
              title="Clear selection"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Mobile header ────────────────────────────────────────────────── */}
      <div className="md:hidden flex flex-col gap-2.5 px-3 pt-3 pb-2 border-b border-[#1a1a24] shrink-0">
        <FolderImportLargeButton />

        <div className="flex gap-2">
          {[
            { icon: FilePlus,   label: "New File",   onClick: () => { setNewItem({ type: "file",   parentPath: "" }); setNewItemName(""); } },
            { icon: FolderPlus, label: "New Folder", onClick: () => { setNewItem({ type: "folder", parentPath: "" }); setNewItemName(""); } },
            { icon: Upload,     label: "Import Zip", onClick: () => setShowImportExport(true) },
            { icon: RefreshCw,  label: "Refresh",    onClick: () => refetch() },
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
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#52526e] pointer-events-none" />
          <input
            className="w-full h-11 pl-10 pr-4 bg-[#141420] border border-[#1a1a24]
              focus:border-primary/40 rounded-xl text-sm text-foreground
              placeholder:text-[#3a3a5c] outline-none transition-colors"
            placeholder="Search files…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[#52526e] active:text-foreground"
              onClick={() => setSearchQuery("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* New-item creation input */}
      {newItem && (
        <div className="px-2 py-1.5 border-b border-[#1a1a24] shrink-0 bg-[#0d0d12]">
          <p className="text-[10px] text-[#52526e] mb-1">
            New {newItem.type}{newItem.parentPath ? ` in ${newItem.parentPath}` : " in workspace root"}
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
            <button
              className="h-6 px-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors"
              onClick={handleCreate}
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              className="h-6 px-1.5 text-xs border border-[#1a1a24] rounded hover:bg-[#141420] text-[#52526e] transition-colors"
              onClick={() => { setNewItem(null); setNewItemName(""); }}
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Workspace file tree (or mobile search results) */}
      <ScrollArea className={importedProject ? "h-[40%]" : "flex-1"}>
        <div className="p-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-[#52526e]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : searchResults !== null ? (
            searchResults.length === 0 ? (
              <p className="text-center py-8 text-[#52526e] text-xs">No files match "{searchQuery}"</p>
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
                      <p className="text-[11px] text-[#52526e] truncate">{file.path}</p>
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
              onSelect={handleSelect}
              onDelete={handleDelete}
              onNewFile={dir  => { setNewItem({ type: "file",   parentPath: dir }); setNewItemName(""); }}
              onNewFolder={dir => { setNewItem({ type: "folder", parentPath: dir }); setNewItemName(""); }}
              onStartRename={path => setRenamingPath(path)}
              onConfirmRename={handleConfirmRename}
              onCancelRename={() => setRenamingPath(null)}
            />
          ) : (
            <p className="text-center py-8 text-[#52526e] text-xs">No files found</p>
          )}
        </div>
      </ScrollArea>

      {/* Imported project section */}
      {importedProject && (
        <div className="flex-1 flex flex-col min-h-0 border-t border-[#1a1a24]">
          <button
            className="shrink-0 flex items-center justify-between px-3 py-1.5 hover:bg-[#141420] transition-colors"
            onClick={() => setShowImported(v => !v)}
          >
            <div className="flex items-center gap-1.5">
              {showImported
                ? <ChevronDown  className="h-3 w-3 text-[#52526e]" />
                : <ChevronRight className="h-3 w-3 text-[#52526e]" />}
              <FolderOpen className="h-3.5 w-3.5 text-primary" />
              <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
                {importedProject.name}
              </span>
            </div>
            <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 font-bold">
              AI context
            </span>
          </button>
          {showImported && (
            <div className="flex-1 min-h-0">
              <ImportedTree />
            </div>
          )}
        </div>
      )}

      {/* Keyboard hint — visible at bottom when nothing selected */}
      {multiCount === 0 && !importedProject && !isLoading && treeData?.tree && (
        <div className="hidden md:block shrink-0 px-3 py-2 border-t border-[#1a1a24]">
          <p className="text-[10px] text-[#2a2a44] leading-relaxed">
            Ctrl+Click or ⌘+Click to select multiple files, then "Open all"
          </p>
        </div>
      )}

      {/* Import/Export modal */}
      {showImportExport && (
        <ImportExportModal
          open={showImportExport}
          onClose={() => { refetch(); setShowImportExport(false); }}
        />
      )}
    </div>
  );
}
