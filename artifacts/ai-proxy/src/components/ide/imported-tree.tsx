/**
 * ImportedTree — collapsible sidebar panel that shows a locally-imported
 * project folder (read entirely in-browser, no upload needed).
 *
 * Features:
 *  • Recursive folder/file tree with VS Code-style indentation
 *  • File-type colour-coded icons matching the workspace explorer
 *  • Click a file → shows content in a read-only preview sheet
 *  • Folder import button (Option B: showDirectoryPicker with Option A fallback)
 *  • Progress indicator during large-folder reads
 *  • "Clear project" action
 *  • Summary badge: N files, X KB total
 */
import { useState, useRef } from "react";
import {
  Folder, FolderOpen, FileCode, FileIcon, FileText, FileJson,
  ChevronRight, ChevronDown, FolderInput, X, Loader2,
  Eye, EyeOff, SkipForward,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  type ImportedFileNode,
  readFolderFromInput,
  openFolderWithPicker,
  isFSAccessSupported,
  countProjectFiles,
  countTotalFiles,
} from "@/lib/folder-import";
import { useIDE } from "@/contexts/ide-context";
import { useToast } from "@/hooks/use-toast";

// ─────────────────────────────────────────────────────────────────────────────
// File icon helper
// ─────────────────────────────────────────────────────────────────────────────

function FileTypeIcon({ name }: { name: string }) {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (["js", "jsx", "ts", "tsx"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
  if (ext === "json") return <FileJson className="h-3.5 w-3.5 text-yellow-400 shrink-0" />;
  if (["md", "mdx"].includes(ext)) return <FileText className="h-3.5 w-3.5 text-slate-400 shrink-0" />;
  if (ext === "py") return <FileCode className="h-3.5 w-3.5 text-green-400 shrink-0" />;
  if (["css", "scss", "less"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-pink-400 shrink-0" />;
  if (["html", "htm"].includes(ext)) return <FileCode className="h-3.5 w-3.5 text-orange-400 shrink-0" />;
  if (ext === "rs") return <FileCode className="h-3.5 w-3.5 text-orange-500 shrink-0" />;
  if (ext === "go") return <FileCode className="h-3.5 w-3.5 text-cyan-400 shrink-0" />;
  if (ext === "sql") return <FileCode className="h-3.5 w-3.5 text-sky-400 shrink-0" />;
  if (ext === "sh") return <FileCode className="h-3.5 w-3.5 text-emerald-400 shrink-0" />;
  return <FileIcon className="h-3.5 w-3.5 text-[#52526e] shrink-0" />;
}

// ─────────────────────────────────────────────────────────────────────────────
// File preview sheet (slide-up from bottom, mobile-friendly)
// ─────────────────────────────────────────────────────────────────────────────

function FilePreviewSheet({
  file,
  onClose,
}: {
  file: ImportedFileNode;
  onClose: () => void;
}) {
  const ext = file.name.split(".").pop() ?? "";
  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div
        className="fixed bottom-0 left-0 right-0 z-50 flex flex-col
          bg-[#0d0d12] border-t border-[#1a1a24] rounded-t-2xl shadow-2xl
          md:top-0 md:right-0 md:left-auto md:rounded-none md:border-l md:border-t-0"
        style={{ height: "70dvh", maxWidth: "min(100%, 600px)" }}
      >
        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-[#1a1a24]">
          <div className="flex items-center gap-2 min-w-0">
            <FileTypeIcon name={file.name} />
            <span className="text-sm font-semibold text-foreground truncate">{file.path || file.name}</span>
            {file.size && (
              <span className="text-[10px] text-[#52526e] shrink-0">
                {(file.size / 1024).toFixed(0)} KB
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="h-7 w-7 flex items-center justify-center rounded-lg text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors ml-2 shrink-0"
            aria-label="Close preview"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          {file.skipped ? (
            <div className="flex items-center gap-2 p-4 text-sm text-[#52526e] italic">
              <SkipForward className="h-4 w-4 shrink-0" />
              {file.content}
            </div>
          ) : (
            <pre
              className="p-4 text-xs font-mono text-[#c0c0d0] leading-relaxed whitespace-pre-wrap break-all"
            >
              <code className={`language-${ext}`}>{file.content}</code>
            </pre>
          )}
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Tree item
// ─────────────────────────────────────────────────────────────────────────────

function TreeNode({
  node,
  depth,
  onFileClick,
}: {
  node: ImportedFileNode;
  depth: number;
  onFileClick: (node: ImportedFileNode) => void;
}) {
  const [expanded, setExpanded] = useState(depth < 2);
  const indent = depth * 10 + 8;

  if (node.name.startsWith(".") && depth > 0) return null;

  if (node.isFolder) {
    return (
      <div>
        <button
          className="w-full flex items-center py-0.5 hover:bg-[#141420] rounded text-[#a0a0c0] transition-colors select-none"
          style={{ paddingLeft: `${indent}px` }}
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
        >
          <span className="mr-0.5 text-[#52526e] shrink-0">
            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          </span>
          {expanded
            ? <FolderOpen className="h-3.5 w-3.5 mr-1.5 text-blue-400 shrink-0" />
            : <Folder className="h-3.5 w-3.5 mr-1.5 text-blue-400 shrink-0" />}
          <span className="truncate text-[12px]">{node.name}</span>
        </button>
        {expanded && node.children?.map(child => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            onFileClick={onFileClick}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      className={`w-full flex items-center py-0.5 rounded text-left transition-colors
        ${node.skipped
          ? "text-[#3a3a5c] hover:bg-[#141420]"
          : "text-[#8080a0] hover:bg-[#141420] hover:text-foreground"
        }`}
      style={{ paddingLeft: `${indent + 14}px` }}
      onClick={() => onFileClick(node)}
      title={node.skipped ? "File skipped (binary or too large)" : node.path}
    >
      {node.skipped ? (
        <SkipForward className="h-3.5 w-3.5 text-[#3a3a5c] shrink-0" />
      ) : (
        <FileTypeIcon name={node.name} />
      )}
      <span className={`truncate ml-1.5 text-[12px] ${node.skipped ? "line-through opacity-50" : ""}`}>
        {node.name}
      </span>
      {!node.skipped && node.size && node.size > 10_000 && (
        <span className="ml-auto text-[10px] text-[#3a3a5c] pr-1 shrink-0">
          {(node.size / 1024).toFixed(0)}k
        </span>
      )}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main ImportedTree panel
// ─────────────────────────────────────────────────────────────────────────────

interface ImportProgress {
  loaded: number;
  total: number;
  current: string;
}

export function ImportedTree() {
  const { importedProject, setImportedProject } = useIDE();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [progressMsg, setProgressMsg] = useState("");
  const [preview, setPreview] = useState<ImportedFileNode | null>(null);
  const [showContext, setShowContext] = useState(false);

  const isLoading = !!progress || !!progressMsg;

  // ── Import via File System Access API (with webkitdirectory fallback) ────
  const handleOpenFolder = async () => {
    if (isFSAccessSupported()) {
      try {
        setProgressMsg("Reading folder…");
        const tree = await openFolderWithPicker(msg => setProgressMsg(msg));
        if (tree) {
          setImportedProject(tree);
          const total = countTotalFiles(tree);
          const readable = countProjectFiles(tree);
          toast({ description: `Imported "${tree.name}" — ${readable} files readable of ${total} total` });
        }
      } catch (e: any) {
        toast({ description: e.message || "Failed to open folder", variant: "destructive" });
      } finally {
        setProgressMsg("");
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  // ── Import via <input webkitdirectory> fallback ──────────────────────────
  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = e.target;
    if (!files || files.length === 0) return;
    e.target.value = "";

    setProgress({ loaded: 0, total: files.length, current: "" });
    try {
      const tree = await readFolderFromInput(files, (loaded, total, current) => {
        setProgress({ loaded, total, current });
      });
      setImportedProject(tree);
      const readable = countProjectFiles(tree);
      toast({ description: `Imported "${tree.name}" — ${readable} readable files` });
    } catch (err: any) {
      toast({ description: err.message || "Import failed", variant: "destructive" });
    } finally {
      setProgress(null);
    }
  };

  // ── Render: no project imported ──────────────────────────────────────────
  if (!importedProject && !isLoading) {
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-full px-4 py-10 text-center">
        <div className="h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center">
          <FolderInput className="h-6 w-6 text-primary" />
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground mb-1">Import your project</p>
          <p className="text-xs text-[#52526e] leading-relaxed max-w-[180px] mx-auto">
            Import a local folder so the AI can see your full codebase
          </p>
        </div>
        <button
          onClick={handleOpenFolder}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-primary-foreground
            text-sm font-semibold hover:bg-primary/80 transition-all active:scale-95 min-h-[44px]"
        >
          <FolderInput className="h-4 w-4" />
          Open Folder
        </button>
        <p className="text-[10px] text-[#3a3a5c] max-w-[180px]">
          Files stay in your browser — nothing is uploaded to any server
        </p>

        {/* Hidden fallback input */}
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          /* @ts-ignore — webkitdirectory is not in TS types */
          webkitdirectory=""
          directory=""
          multiple
          onChange={handleInputChange}
        />
      </div>
    );
  }

  // ── Render: loading / progress ───────────────────────────────────────────
  if (isLoading) {
    const pct = progress ? Math.round((progress.loaded / progress.total) * 100) : null;
    return (
      <div className="flex flex-col items-center justify-center gap-4 h-full px-4 py-10">
        <Loader2 className="h-8 w-8 text-primary animate-spin" />
        <div className="text-center">
          <p className="text-sm font-semibold text-foreground mb-1">
            {pct !== null ? `Reading files… ${pct}%` : "Opening folder…"}
          </p>
          {(progress?.current || progressMsg) && (
            <p className="text-[11px] text-[#52526e] font-mono truncate max-w-[200px]">
              {progress?.current || progressMsg}
            </p>
          )}
          {progress && (
            <div className="mt-3 w-40 h-1.5 bg-[#1a1a24] rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full transition-all"
                style={{ width: `${pct}%` }}
              />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── Render: project imported ─────────────────────────────────────────────
  const totalFiles = countTotalFiles(importedProject!);
  const readableFiles = countProjectFiles(importedProject!);

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c]">
      {/* Header */}
      <div className="shrink-0 px-3 py-2 border-b border-[#1a1a24] bg-[#0a0a0c]">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-[11px] font-bold text-foreground truncate">
              {importedProject!.name}
            </span>
          </div>
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              onClick={handleOpenFolder}
              className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors"
              title="Import a different folder"
            >
              <FolderInput className="h-3 w-3" />
            </button>
            <button
              onClick={() => setImportedProject(null)}
              className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-red-400 hover:bg-[#141420] transition-colors"
              title="Clear imported project"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded px-1.5 py-0.5 font-bold">
            {readableFiles} files
          </span>
          {totalFiles > readableFiles && (
            <span className="text-[10px] text-[#52526e]">
              {totalFiles - readableFiles} skipped
            </span>
          )}
          <span className="text-[10px] text-[#52526e]">· added to AI context</span>
        </div>
      </div>

      {/* File tree */}
      <ScrollArea className="flex-1">
        <div className="p-1 pb-4">
          {importedProject!.children?.map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={0}
              onFileClick={setPreview}
            />
          ))}
        </div>
      </ScrollArea>

      {/* Hidden fallback input */}
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        /* @ts-ignore */
        webkitdirectory=""
        directory=""
        multiple
        onChange={handleInputChange}
      />

      {/* File preview sheet */}
      {preview && (
        <FilePreviewSheet file={preview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Compact import button — used in the file-explorer header
// ─────────────────────────────────────────────────────────────────────────────

export function FolderImportButton({ className = "" }: { className?: string }) {
  const { importedProject, setImportedProject } = useIDE();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [loading, setLoading] = useState(false);

  const handleClick = async () => {
    if (isFSAccessSupported()) {
      setLoading(true);
      try {
        const tree = await openFolderWithPicker();
        if (tree) {
          setImportedProject(tree);
          toast({ description: `Imported "${tree.name}" — ${countProjectFiles(tree)} files` });
        }
      } catch (e: any) {
        if (e.name !== "AbortError")
          toast({ description: e.message || "Failed", variant: "destructive" });
      } finally {
        setLoading(false);
      }
    } else {
      fileInputRef.current?.click();
    }
  };

  const handleInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const { files } = e.target;
    if (!files || files.length === 0) return;
    e.target.value = "";
    setLoading(true);
    try {
      const tree = await readFolderFromInput(files);
      setImportedProject(tree);
      toast({ description: `Imported "${tree.name}" — ${countProjectFiles(tree)} files` });
    } catch (err: any) {
      toast({ description: err.message || "Import failed", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <button
        onClick={handleClick}
        disabled={loading}
        className={`h-5 w-5 flex items-center justify-center rounded transition-colors
          ${importedProject
            ? "text-primary hover:text-foreground hover:bg-[#141420]"
            : "text-[#52526e] hover:text-[#a0a0c0] hover:bg-[#141420]"
          } ${className}`}
        title={importedProject ? `Project: ${importedProject.name}` : "Import local folder for AI context"}
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FolderInput className="h-3 w-3" />}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        /* @ts-ignore */
        webkitdirectory=""
        directory=""
        multiple
        onChange={handleInputChange}
      />
    </>
  );
}
