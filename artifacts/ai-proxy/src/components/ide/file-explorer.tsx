import { useState, useRef, useEffect, useCallback } from "react";
import {
  useGetFileTree, getGetFileTreeQueryKey, useCreateFile, useDeleteFile, FileNode,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Folder, FolderOpen, FileIcon, FileCode, FileText, FileJson,
  ChevronRight, ChevronDown, RefreshCw, FilePlus, FolderPlus,
  Trash2, MoreVertical, Upload, Download, Check, X, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useIDE } from "@/contexts/ide-context";
import { ImportExportModal } from "@/components/import-export-modal";

function getFileIcon(name: string) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  if (ext === "json") return <FileJson className="h-3.5 w-3.5 text-yellow-400 shrink-0" />;
  if (["md", "mdx"].includes(ext)) return <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
  if (ext === "py") return <FileCode className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (ext === "css") return <FileCode className="h-3.5 w-3.5 text-pink-400 shrink-0" />;
  if (["html", "htm"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-orange-400 shrink-0" />;
  if (ext === "rs") return <FileCode className="h-3.5 w-3.5 text-orange-600 shrink-0" />;
  if (ext === "sql") return <FileCode className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  return <FileIcon className="h-3.5 w-3.5 text-[#52526e] shrink-0" />;
}

interface TreeItemProps {
  node: FileNode; depth: number;
  activePath: string | null;
  onSelect: (p: string) => void;
  onDelete: (p: string, isDir: boolean) => void;
  onNewFile: (dir: string) => void;
  onNewFolder: (dir: string) => void;
}

function TreeItem({ node, depth, activePath, onSelect, onDelete, onNewFile, onNewFolder }: TreeItemProps) {
  const [expanded, setExpanded] = useState(depth === 0);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isSelected = activePath === node.path;

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  if (node.name.startsWith(".")) return null;

  const indent = depth * 10 + 8;

  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-0.5 hover:bg-[#141420] cursor-pointer text-[#a0a0c0] group rounded"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setExpanded(e => !e)}
        >
          <span className="mr-0.5 text-[#52526e]">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {expanded
            ? <FolderOpen className="h-3.5 w-3.5 mr-1 text-blue-400 shrink-0" />
            : <Folder className="h-3.5 w-3.5 mr-1 text-blue-400 shrink-0" />}
          <span className="truncate flex-1 text-[12px]">{node.name}</span>
          <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 shrink-0 pr-1" onClick={e => e.stopPropagation()}>
            <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-[#1e1e2e]" title="New file" onClick={() => onNewFile(node.path)}>
              <FilePlus className="h-2.5 w-2.5" />
            </button>
            <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-[#1e1e2e]" title="New folder" onClick={() => onNewFolder(node.path)}>
              <FolderPlus className="h-2.5 w-2.5" />
            </button>
            <div className="relative" ref={menuRef}>
              <button className="h-4 w-4 flex items-center justify-center rounded hover:bg-[#1e1e2e]" onClick={() => setMenuOpen(o => !o)}>
                <MoreVertical className="h-2.5 w-2.5" />
              </button>
              {menuOpen && (
                <div className="absolute left-0 top-5 z-50 bg-[#0d0d12] border border-[#1a1a24] rounded-lg shadow-xl py-1 min-w-[130px]">
                  <button
                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-[#141420] transition-colors"
                    onClick={() => { onDelete(node.path, true); setMenuOpen(false); }}
                  ><Trash2 className="h-3 w-3" /> Delete folder</button>
                </div>
              )}
            </div>
          </div>
        </div>
        {expanded && node.children?.map(c => (
          <TreeItem key={c.path} node={c} depth={depth + 1} activePath={activePath}
            onSelect={onSelect} onDelete={onDelete} onNewFile={onNewFile} onNewFolder={onNewFolder} />
        ))}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center py-0.5 cursor-pointer group rounded ${
        isSelected ? "bg-primary/15 text-foreground" : "text-[#8080a0] hover:bg-[#141420]"
      }`}
      style={{ paddingLeft: `${indent + 14}px` }}
      onClick={() => onSelect(node.path)}
    >
      {getFileIcon(node.name)}
      <span className={`truncate ml-1.5 text-[12px] flex-1 ${isSelected ? "font-semibold text-foreground" : ""}`}>{node.name}</span>
      <div className="opacity-0 group-hover:opacity-100 flex items-center shrink-0 pr-1" onClick={e => e.stopPropagation()}>
        <button
          className="h-4 w-4 flex items-center justify-center rounded hover:bg-[#1e1e2e] text-red-400/60 hover:text-red-400"
          onClick={() => onDelete(node.path, false)}
        ><Trash2 className="h-2.5 w-2.5" /></button>
      </div>
    </div>
  );
}

interface NewItemState { type: "file" | "folder"; parentPath: string; }

export function FileExplorer({ activePath }: { activePath: string | null }) {
  const { openFileInEditor } = useIDE();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showImportExport, setShowImportExport] = useState(false);
  const [newItem, setNewItem] = useState<NewItemState | null>(null);
  const [newItemName, setNewItemName] = useState("");
  const newItemInputRef = useRef<HTMLInputElement>(null);

  const { data: treeData, isLoading, refetch } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }) } }
  );
  const createFile = useCreateFile();
  const deleteFile = useDeleteFile();

  useEffect(() => {
    if (newItem) setTimeout(() => newItemInputRef.current?.focus(), 50);
  }, [newItem]);

  const handleCreate = async () => {
    if (!newItem || !newItemName.trim()) { setNewItem(null); return; }
    const fullPath = newItem.parentPath ? `${newItem.parentPath}/${newItemName.trim()}` : newItemName.trim();
    try {
      await createFile.mutateAsync({ data: { path: fullPath, type: newItem.type } });
      await refetch();
      if (newItem.type === "file") openFileInEditor(fullPath);
      toast({ description: `Created ${newItemName.trim()}` });
    } catch (e: any) {
      toast({ description: e?.message || "Failed to create", variant: "destructive" });
    }
    setNewItem(null); setNewItemName("");
  };

  const handleDelete = async (path: string, isDir: boolean) => {
    if (!confirm(`Delete "${path.split("/").pop()}"? This cannot be undone.`)) return;
    try {
      await deleteFile.mutateAsync({ params: { path } });
      await refetch();
      toast({ description: `Deleted ${path.split("/").pop()}` });
    } catch {
      toast({ description: "Failed to delete", variant: "destructive" });
    }
  };

  const exportWorkspace = () => {
    const a = document.createElement("a");
    a.href = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/files/export`;
    a.download = ""; document.body.appendChild(a); a.click(); document.body.removeChild(a);
    toast({ description: "Exporting workspace…" });
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#1a1a24] shrink-0">
        <span className="text-[10px] font-bold text-[#3a3a5c] uppercase tracking-widest">Explorer</span>
        <div className="flex items-center gap-0.5">
          {[
            { icon: FilePlus, title: "New file", onClick: () => { setNewItem({ type: "file", parentPath: "" }); setNewItemName(""); } },
            { icon: FolderPlus, title: "New folder", onClick: () => { setNewItem({ type: "folder", parentPath: "" }); setNewItemName(""); } },
            { icon: RefreshCw, title: "Refresh", onClick: () => refetch() },
            { icon: Upload, title: "Import files", onClick: () => setShowImportExport(true) },
            { icon: Download, title: "Export workspace", onClick: exportWorkspace },
          ].map(({ icon: Icon, title, onClick }) => (
            <button
              key={title}
              className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-[#a0a0c0] hover:bg-[#141420] transition-colors"
              title={title} onClick={onClick}
            ><Icon className="h-3 w-3" /></button>
          ))}
        </div>
      </div>

      {/* New item input */}
      {newItem && (
        <div className="px-2 py-1.5 border-b border-[#1a1a24] shrink-0 bg-[#0d0d12]">
          <p className="text-[10px] text-[#52526e] mb-1">
            New {newItem.type}{newItem.parentPath ? ` in ${newItem.parentPath}` : ""}
          </p>
          <div className="flex gap-1">
            <input
              ref={newItemInputRef}
              className="flex-1 text-xs bg-[#141420] border border-[#1a1a24] rounded px-2 py-1 outline-none focus:border-primary text-foreground"
              placeholder={newItem.type === "file" ? "filename.ts" : "folder-name"}
              value={newItemName}
              onChange={e => setNewItemName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleCreate();
                if (e.key === "Escape") { setNewItem(null); setNewItemName(""); }
              }}
            />
            <button className="h-6 px-1.5 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90" onClick={handleCreate}>
              <Check className="h-3 w-3" />
            </button>
            <button className="h-6 px-1.5 text-xs border border-[#1a1a24] rounded hover:bg-[#141420] text-[#52526e]" onClick={() => { setNewItem(null); setNewItemName(""); }}>
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* Tree */}
      <ScrollArea className="flex-1">
        <div className="p-1">
          {isLoading ? (
            <div className="flex items-center justify-center py-8 text-[#52526e]">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : treeData?.tree ? (
            <TreeItem
              node={treeData.tree} depth={0} activePath={activePath}
              onSelect={openFileInEditor} onDelete={handleDelete}
              onNewFile={dir => { setNewItem({ type: "file", parentPath: dir }); setNewItemName(""); }}
              onNewFolder={dir => { setNewItem({ type: "folder", parentPath: dir }); setNewItemName(""); }}
            />
          ) : (
            <div className="text-center py-8 text-[#52526e] text-xs">No files found</div>
          )}
        </div>
      </ScrollArea>

      {showImportExport && <ImportExportModal open={showImportExport} onClose={() => { refetch(); setShowImportExport(false); }} />}
    </div>
  );
}
