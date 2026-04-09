import { useState, useRef, useCallback } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Upload, FolderUp, FileArchive, Github, Download,
  CheckCircle2, XCircle, Loader2, File, FolderOpen,
  Package, ExternalLink,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { getGetFileTreeQueryKey } from "@workspace/api-client-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ImportExportModalProps {
  open: boolean;
  onClose: () => void;
  currentPath?: string;
}

interface UploadResult {
  uploaded: number;
  results: { path: string; type: string; extracted?: string[] }[];
}

interface GithubResult {
  success: boolean;
  targetDir?: string;
  repoName?: string;
  stderr?: string;
  error?: string;
}

// ─── Drop zone ────────────────────────────────────────────────────────────────
function DropZone({
  onFiles,
  accept,
  multiple,
  folder,
  label,
  sublabel,
  icon: Icon,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  folder?: boolean;
  label: string;
  sublabel: string;
  icon: React.ElementType;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragging(false);
      const dropped = Array.from(e.dataTransfer.files);
      if (dropped.length) onFiles(dropped);
    },
    [onFiles]
  );

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
        dragging
          ? "border-primary bg-primary/5"
          : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Icon className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground mt-1">{sublabel}</p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        {...(folder ? { webkitdirectory: "", directory: "" } : {})}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}

// ─── File list badge ──────────────────────────────────────────────────────────
function FileList({ files }: { files: File[] }) {
  if (!files.length) return null;
  const shown = files.slice(0, 5);
  return (
    <div className="space-y-1">
      {shown.map((f, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
          <File className="h-3 w-3 shrink-0" />
          <span className="truncate">{f.webkitRelativePath || f.name}</span>
          <span className="ml-auto shrink-0 text-muted-foreground/60">
            {(f.size / 1024).toFixed(0)} KB
          </span>
        </div>
      ))}
      {files.length > 5 && (
        <p className="text-xs text-muted-foreground">
          +{files.length - 5} more files
        </p>
      )}
    </div>
  );
}

// ─── Result display ───────────────────────────────────────────────────────────
function ResultBanner({
  success,
  message,
  detail,
}: {
  success: boolean;
  message: string;
  detail?: string;
}) {
  return (
    <div
      className={`rounded-lg border p-3 flex items-start gap-2 ${
        success
          ? "border-green-500/30 bg-green-500/5"
          : "border-red-500/30 bg-red-500/5"
      }`}
    >
      {success ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
      ) : (
        <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
      )}
      <div>
        <p className={`text-sm font-medium ${success ? "text-green-400" : "text-red-400"}`}>
          {message}
        </p>
        {detail && (
          <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-all max-h-28 overflow-y-auto">
            {detail}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export function ImportExportModal({ open, onClose, currentPath }: ImportExportModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // ── Files tab
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [uploadTarget, setUploadTarget] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── GitHub tab
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<GithubResult | null>(null);

  // ── Export tab
  const [exportPath, setExportPath] = useState("");
  const [exporting, setExporting] = useState(false);

  const resetUpload = () => {
    setFilesToUpload([]);
    setUploadResult(null);
    setUploadError(null);
    setUploadProgress(0);
  };

  const invalidateTree = () => {
    queryClient.invalidateQueries({ queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }) });
  };

  // ── Upload handler
  const handleUpload = async () => {
    if (!filesToUpload.length) return;
    setUploading(true);
    setUploadResult(null);
    setUploadError(null);
    setUploadProgress(10);

    try {
      const formData = new FormData();
      for (const file of filesToUpload) {
        // Use webkitRelativePath to preserve folder structure
        const name = file.webkitRelativePath || file.name;
        formData.append("files", file, name);
      }
      if (uploadTarget) {
        formData.append("targetDir", uploadTarget);
      }

      setUploadProgress(40);
      const resp = await fetch(`${BASE}/api/files/upload`, {
        method: "POST",
        body: formData,
      });

      setUploadProgress(90);

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error || resp.statusText);
      }

      const data = (await resp.json()) as UploadResult;
      setUploadResult(data);
      setUploadProgress(100);
      invalidateTree();
      toast({ title: `Imported ${data.uploaded} file(s) successfully` });
    } catch (err) {
      setUploadError(String(err));
    } finally {
      setUploading(false);
    }
  };

  // ── GitHub clone handler
  const handleClone = async () => {
    if (!repoUrl.trim()) return;
    setCloning(true);
    setCloneResult(null);

    try {
      const resp = await fetch(`${BASE}/api/files/import-github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          repoUrl: repoUrl.trim(),
          branch: branch.trim() || undefined,
        }),
      });
      const data = (await resp.json()) as GithubResult;
      setCloneResult(data);
      if (data.success) {
        invalidateTree();
        toast({ title: `Cloned ${data.repoName} successfully` });
      }
    } catch (err) {
      setCloneResult({ success: false, error: String(err) });
    } finally {
      setCloning(false);
    }
  };

  // ── Export handler
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = exportPath ? `?path=${encodeURIComponent(exportPath)}` : "";
      const url = `${BASE}/api/files/export${params}`;
      const a = document.createElement("a");
      a.href = url;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast({ title: "Download started" });
    } catch (err) {
      toast({ title: "Export failed", description: String(err), variant: "destructive" });
    } finally {
      setTimeout(() => setExporting(false), 1500);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Import &amp; Export
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="files" className="mt-2">
          <TabsList className="w-full grid grid-cols-3">
            <TabsTrigger value="files" className="gap-1.5 text-xs">
              <Upload className="h-3.5 w-3.5" />
              Files
            </TabsTrigger>
            <TabsTrigger value="github" className="gap-1.5 text-xs">
              <Github className="h-3.5 w-3.5" />
              GitHub
            </TabsTrigger>
            <TabsTrigger value="export" className="gap-1.5 text-xs">
              <Download className="h-3.5 w-3.5" />
              Export
            </TabsTrigger>
          </TabsList>

          {/* ── FILES TAB ─────────────────────────────────────────── */}
          <TabsContent value="files" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Upload individual files, entire folders, or ZIP archives. ZIPs are extracted automatically.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <DropZone
                icon={Upload}
                label="Drop files here"
                sublabel="Any file type · ZIP auto-extracts"
                multiple
                onFiles={(f) => { resetUpload(); setFilesToUpload(f); }}
              />
              <DropZone
                icon={FolderUp}
                label="Drop a folder"
                sublabel="Preserves full folder structure"
                folder
                multiple
                onFiles={(f) => { resetUpload(); setFilesToUpload(f); }}
              />
            </div>

            {filesToUpload.length > 0 && (
              <div className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">
                    {filesToUpload.length} file{filesToUpload.length !== 1 ? "s" : ""} selected
                  </span>
                  <button
                    onClick={resetUpload}
                    className="text-xs text-muted-foreground hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
                <FileList files={filesToUpload} />
                <div className="flex items-center gap-2 pt-1">
                  <Input
                    placeholder="Target folder (optional, e.g. my-project)"
                    value={uploadTarget}
                    onChange={(e) => setUploadTarget(e.target.value)}
                    className="h-8 text-xs flex-1"
                  />
                </div>
              </div>
            )}

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Uploading &amp; extracting...
                </div>
                <Progress value={uploadProgress} className="h-1.5" />
              </div>
            )}

            {uploadResult && (
              <ResultBanner
                success
                message={`Imported ${uploadResult.uploaded} file(s)`}
                detail={uploadResult.results
                  .map((r) =>
                    r.type === "zip_extracted"
                      ? `📦 ${r.path}/ (${r.extracted?.length ?? 0} files extracted)`
                      : `📄 ${r.path}`
                  )
                  .join("\n")}
              />
            )}

            {uploadError && (
              <ResultBanner success={false} message="Upload failed" detail={uploadError} />
            )}

            <Button
              className="w-full gap-2"
              onClick={handleUpload}
              disabled={!filesToUpload.length || uploading}
            >
              {uploading ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Uploading...</>
              ) : (
                <><Upload className="h-4 w-4" />Upload &amp; Import</>
              )}
            </Button>
          </TabsContent>

          {/* ── GITHUB TAB ────────────────────────────────────────── */}
          <TabsContent value="github" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Clone any public GitHub repository into your workspace. The agent can then open,
              read, and edit those files.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Repository URL</label>
                <div className="flex items-center gap-2">
                  <Github className="h-4 w-4 text-muted-foreground shrink-0" />
                  <Input
                    placeholder="https://github.com/owner/repo"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleClone(); }}
                    className="h-9 font-mono text-sm"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium">Branch <span className="text-muted-foreground font-normal">(optional, defaults to main)</span></label>
                <Input
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="h-8 font-mono text-sm"
                />
              </div>

              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="text-xs font-medium text-muted-foreground">Examples</p>
                {[
                  "https://github.com/pallets/flask",
                  "https://github.com/fastapi/fastapi",
                  "https://github.com/tiangolo/full-stack-fastapi-template",
                ].map((url) => (
                  <button
                    key={url}
                    className="block text-xs text-primary/80 hover:text-primary font-mono truncate w-full text-left"
                    onClick={() => setRepoUrl(url)}
                  >
                    {url}
                  </button>
                ))}
              </div>
            </div>

            {cloning && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Cloning repository... (this can take up to 60s for large repos)
              </div>
            )}

            {cloneResult && (
              <ResultBanner
                success={cloneResult.success}
                message={
                  cloneResult.success
                    ? `Cloned to: ${cloneResult.targetDir}`
                    : "Clone failed"
                }
                detail={cloneResult.success ? undefined : (cloneResult.stderr || cloneResult.error)}
              />
            )}

            <Button
              className="w-full gap-2"
              onClick={handleClone}
              disabled={!repoUrl.trim() || cloning}
            >
              {cloning ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Cloning...</>
              ) : (
                <><Github className="h-4 w-4" />Clone Repository</>
              )}
            </Button>
          </TabsContent>

          {/* ── EXPORT TAB ────────────────────────────────────────── */}
          <TabsContent value="export" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Export your workspace or a specific folder as a ZIP file. Node modules, build artifacts,
              and hidden folders are excluded automatically.
            </p>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">
                  Path to export{" "}
                  <span className="text-muted-foreground font-normal">
                    (leave blank for entire workspace)
                  </span>
                </label>
                <Input
                  placeholder="e.g. my-project  or  python-backend"
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  className="h-9 font-mono text-sm"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                {["", "python-backend", "artifacts/ai-proxy", "lib"].map((p) => (
                  <button
                    key={p || "root"}
                    className={`text-xs px-3 py-2 rounded-md border text-left transition-colors ${
                      exportPath === p
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border hover:border-primary/40 text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setExportPath(p)}
                  >
                    <FolderOpen className="h-3 w-3 inline mr-1.5" />
                    {p || "Entire workspace"}
                  </button>
                ))}
              </div>

              <div className="p-3 rounded-lg bg-muted/30 space-y-1">
                <p className="text-xs text-muted-foreground">
                  <strong>Excluded automatically:</strong> node_modules, .git, __pycache__,
                  dist, build, .venv, coverage, hidden folders
                </p>
              </div>
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleExport}
              disabled={exporting}
            >
              {exporting ? (
                <><Loader2 className="h-4 w-4 animate-spin" />Preparing download...</>
              ) : (
                <><Download className="h-4 w-4" />Download ZIP</>
              )}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
