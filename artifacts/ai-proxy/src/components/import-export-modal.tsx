import { useState, useRef, useCallback, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import {
  Upload, FolderUp, Github, Download, CheckCircle2, XCircle,
  Loader2, File, FolderOpen, Package, GitPullRequest,
  GitBranch, Send, Trash2, Key, RefreshCw, Lock, Unlock,
  GitCommit,
} from "lucide-react";
import { toast } from "sonner";
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

interface GitOpResult {
  success: boolean;
  stdout?: string;
  stderr?: string;
  error?: string;
  steps?: { step: string; stdout: string; stderr: string }[];
}

interface GitStatusResult {
  isRepo: boolean;
  branch: string | null;
  status: string | null;
  remote: string | null;
}

interface TokenStatus {
  set: boolean;
  masked: string | null;
}

// ─── Drop zone ────────────────────────────────────────────────────────────────
function DropZone({
  onFiles, multiple, folder, label, sublabel, icon: Icon,
}: {
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  folder?: boolean;
  label: string;
  sublabel: string;
  icon: React.ElementType;
}) {
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const dropped = Array.from(e.dataTransfer.files);
    if (dropped.length) onFiles(dropped);
  }, [onFiles]);

  return (
    <div
      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
      }`}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <Icon className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
      <p className="text-sm font-medium">{label}</p>
      <p className="text-xs text-muted-foreground mt-0.5">{sublabel}</p>
      <input
        ref={inputRef}
        type="file"
        multiple={multiple}
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

// ─── File list ────────────────────────────────────────────────────────────────
function FileList({ files }: { files: File[] }) {
  if (!files.length) return null;
  const shown = files.slice(0, 5);
  return (
    <div className="space-y-1">
      {shown.map((f, i) => (
        <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
          <File className="h-3 w-3 shrink-0" />
          <span className="truncate">{f.webkitRelativePath || f.name}</span>
          <span className="ml-auto shrink-0">{(f.size / 1024).toFixed(0)} KB</span>
        </div>
      ))}
      {files.length > 5 && (
        <p className="text-xs text-muted-foreground">+{files.length - 5} more files</p>
      )}
    </div>
  );
}

// ─── Result banner ────────────────────────────────────────────────────────────
function ResultBanner({ success, message, detail }: { success: boolean; message: string; detail?: string }) {
  return (
    <div className={`rounded-lg border p-3 flex items-start gap-2 ${
      success ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
    }`}>
      {success
        ? <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0 mt-0.5" />
        : <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />}
      <div className="min-w-0">
        <p className={`text-sm font-medium ${success ? "text-green-400" : "text-red-400"}`}>{message}</p>
        {detail && (
          <pre className="text-xs text-muted-foreground mt-1 whitespace-pre-wrap break-all max-h-28 overflow-y-auto font-mono">
            {detail}
          </pre>
        )}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{children}</p>;
}

// ─── Main modal ───────────────────────────────────────────────────────────────
export function ImportExportModal({ open, onClose }: ImportExportModalProps) {
  const queryClient = useQueryClient();

  // ── Files tab
  const [filesToUpload, setFilesToUpload] = useState<File[]>([]);
  const [uploadTarget, setUploadTarget] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // ── GitHub tab – token
  const [tokenInput, setTokenInput] = useState("");
  const [tokenStatus, setTokenStatus] = useState<TokenStatus | null>(null);
  const [savingToken, setSavingToken] = useState(false);

  // ── GitHub tab – clone
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [cloning, setCloning] = useState(false);
  const [cloneResult, setCloneResult] = useState<GithubResult | null>(null);

  // ── GitHub tab – pull
  const [pullPath, setPullPath] = useState("");
  const [pulling, setPulling] = useState(false);
  const [pullResult, setPullResult] = useState<GitOpResult | null>(null);

  // ── GitHub tab – push
  const [pushPath, setPushPath] = useState("");
  const [pushBranch, setPushBranch] = useState("");
  const [commitMsg, setCommitMsg] = useState("");
  const [pushing, setPushing] = useState(false);
  const [pushResult, setPushResult] = useState<GitOpResult | null>(null);

  // ── GitHub tab – status
  const [statusPath, setStatusPath] = useState("");
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusResult, setStatusResult] = useState<GitStatusResult | null>(null);

  // ── GitHub sub-tab
  const [ghTab, setGhTab] = useState<"token" | "clone" | "pull" | "push" | "status">("clone");

  // ── Export tab
  const [exportPath, setExportPath] = useState("");
  const [exporting, setExporting] = useState(false);

  const invalidateTree = () => {
    queryClient.invalidateQueries({ queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }) });
  };

  // Load token status on open
  useEffect(() => {
    if (!open) return;
    fetch(`${BASE}/api/files/git-token/status`)
      .then(r => r.json())
      .then(d => setTokenStatus(d))
      .catch(() => {});
  }, [open]);

  // ── Upload handler
  const resetUpload = () => { setFilesToUpload([]); setUploadResult(null); setUploadError(null); setUploadProgress(0); };

  const handleUpload = async () => {
    if (!filesToUpload.length) return;
    setUploading(true); setUploadResult(null); setUploadError(null); setUploadProgress(10);
    try {
      const formData = new FormData();
      for (const file of filesToUpload) {
        formData.append("files", file, file.webkitRelativePath || file.name);
      }
      if (uploadTarget) formData.append("targetDir", uploadTarget);
      setUploadProgress(40);
      const resp = await fetch(`${BASE}/api/files/upload`, { method: "POST", body: formData });
      setUploadProgress(90);
      if (!resp.ok) { const e = await resp.json().catch(() => ({ error: resp.statusText })); throw new Error(e.error); }
      const data = await resp.json() as UploadResult;
      setUploadResult(data); setUploadProgress(100); invalidateTree();
      toast.success(`Imported ${data.uploaded} file(s)`);
    } catch (err) { setUploadError(String(err)); }
    finally { setUploading(false); }
  };

  // ── Token handlers
  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    setSavingToken(true);
    try {
      const resp = await fetch(`${BASE}/api/files/git-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: tokenInput.trim() }),
      });
      const data = await resp.json();
      if (data.success) {
        setTokenStatus({ set: true, masked: data.masked });
        setTokenInput("");
        toast.success("GitHub token saved");
      } else {
        toast.error("Failed to save token", { description: data.error });
      }
    } catch (err) {
      toast.error("Error", { description: String(err) });
    } finally {
      setSavingToken(false);
    }
  };

  const handleClearToken = async () => {
    await fetch(`${BASE}/api/files/git-token`, { method: "DELETE" });
    setTokenStatus({ set: false, masked: null });
    toast.success("GitHub token removed");
  };

  // ── Clone handler
  const handleClone = async () => {
    if (!repoUrl.trim()) return;
    setCloning(true); setCloneResult(null);
    try {
      const resp = await fetch(`${BASE}/api/files/import-github`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoUrl.trim(), branch: branch.trim() || undefined }),
      });
      const data = await resp.json() as GithubResult;
      setCloneResult(data);
      if (data.success) { invalidateTree(); toast.success(`Cloned ${data.repoName}`); }
    } catch (err) {
      setCloneResult({ success: false, error: String(err) });
    } finally { setCloning(false); }
  };

  // ── Pull handler
  const handlePull = async () => {
    setPulling(true); setPullResult(null);
    try {
      const resp = await fetch(`${BASE}/api/files/git-pull`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: pullPath.trim() || undefined }),
      });
      const data = await resp.json() as GitOpResult;
      setPullResult(data);
      if (data.success) { invalidateTree(); toast.success("Pull complete"); }
    } catch (err) {
      setPullResult({ success: false, error: String(err) });
    } finally { setPulling(false); }
  };

  // ── Push handler
  const handlePush = async () => {
    setPushing(true); setPushResult(null);
    try {
      const resp = await fetch(`${BASE}/api/files/git-push`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: pushPath.trim() || undefined,
          message: commitMsg.trim() || undefined,
          branch: pushBranch.trim() || undefined,
        }),
      });
      const data = await resp.json() as GitOpResult;
      setPushResult(data);
      if (data.success) toast.success("Push complete");
    } catch (err) {
      setPushResult({ success: false, error: String(err) });
    } finally { setPushing(false); }
  };

  // ── Git status handler
  const handleStatus = async () => {
    setStatusLoading(true); setStatusResult(null);
    try {
      const params = statusPath.trim() ? `?path=${encodeURIComponent(statusPath.trim())}` : "";
      const resp = await fetch(`${BASE}/api/files/git-status${params}`);
      const data = await resp.json() as GitStatusResult;
      setStatusResult(data);
    } catch (err) {
      toast.error("Error", { description: String(err) });
    } finally { setStatusLoading(false); }
  };

  // ── Export handler
  const handleExport = async () => {
    setExporting(true);
    try {
      const params = exportPath ? `?path=${encodeURIComponent(exportPath)}` : "";
      const a = document.createElement("a");
      a.href = `${BASE}/api/files/export${params}`;
      a.download = "";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      toast.success("Download started");
    } catch (err) {
      toast.error("Export failed", { description: String(err) });
    } finally {
      setTimeout(() => setExporting(false), 1500);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
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

          {/* ── FILES TAB ──────────────────────────────────────────────────── */}
          <TabsContent value="files" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Upload individual files, entire folders, or ZIP archives. ZIPs are extracted automatically.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <DropZone
                icon={Upload}
                label="Drop files here"
                sublabel="Any file · ZIP auto-extracts"
                multiple
                onFiles={(f) => { resetUpload(); setFilesToUpload(f); }}
              />
              <DropZone
                icon={FolderUp}
                label="Drop a folder"
                sublabel="Preserves folder structure"
                folder
                multiple
                onFiles={(f) => { resetUpload(); setFilesToUpload(f); }}
              />
            </div>

            {filesToUpload.length > 0 && (
              <div className="border border-border rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{filesToUpload.length} file{filesToUpload.length !== 1 ? "s" : ""} selected</span>
                  <button onClick={resetUpload} className="text-xs text-muted-foreground hover:text-foreground">Clear</button>
                </div>
                <FileList files={filesToUpload} />
                <Input
                  placeholder="Target folder (optional)"
                  value={uploadTarget}
                  onChange={(e) => setUploadTarget(e.target.value)}
                  className="h-8 text-xs"
                />
              </div>
            )}

            {uploading && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />Uploading &amp; extracting...
                </div>
                <Progress value={uploadProgress} className="h-1.5" />
              </div>
            )}

            {uploadResult && (
              <ResultBanner
                success
                message={`Imported ${uploadResult.uploaded} file(s)`}
                detail={uploadResult.results.map(r =>
                  r.type === "zip_extracted"
                    ? `📦 ${r.path}/ (${r.extracted?.length ?? 0} files)`
                    : `📄 ${r.path}`
                ).join("\n")}
              />
            )}

            {uploadError && <ResultBanner success={false} message="Upload failed" detail={uploadError} />}

            <Button className="w-full gap-2" onClick={handleUpload} disabled={!filesToUpload.length || uploading}>
              {uploading ? <><Loader2 className="h-4 w-4 animate-spin" />Uploading...</> : <><Upload className="h-4 w-4" />Upload &amp; Import</>}
            </Button>
          </TabsContent>

          {/* ── GITHUB TAB ─────────────────────────────────────────────────── */}
          <TabsContent value="github" className="space-y-0 mt-4">

            {/* ── Auth token banner */}
            <div className={`flex items-center gap-2 p-2.5 rounded-lg mb-3 ${
              tokenStatus?.set ? "bg-green-500/10 border border-green-500/20" : "bg-amber-500/10 border border-amber-500/20"
            }`}>
              {tokenStatus?.set
                ? <Lock className="h-3.5 w-3.5 text-green-500 shrink-0" />
                : <Unlock className="h-3.5 w-3.5 text-amber-500 shrink-0" />}
              <span className="text-xs flex-1">
                {tokenStatus?.set
                  ? <><span className="text-green-400 font-medium">Token saved</span> <span className="text-muted-foreground font-mono">{tokenStatus.masked}</span> — push/pull enabled</>
                  : <><span className="text-amber-400 font-medium">No token</span> — push/pull to private repos requires a GitHub PAT</>}
              </span>
              <button
                className="text-xs text-muted-foreground hover:text-foreground shrink-0"
                onClick={() => setGhTab("token")}
              >
                {tokenStatus?.set ? "Update" : "Add token"}
              </button>
            </div>

            {/* ── Sub-tab bar */}
            <div className="flex border-b border-border mb-3 gap-0 -mx-1">
              {(["clone", "pull", "push", "status", "token"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setGhTab(t)}
                  className={`px-3 py-1.5 text-xs capitalize transition-colors border-b-2 -mb-px ${
                    ghTab === t
                      ? "border-primary text-foreground font-medium"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {t === "clone" && "Clone"}
                  {t === "pull" && "Pull"}
                  {t === "push" && "Push"}
                  {t === "status" && "Status"}
                  {t === "token" && <span className="flex items-center gap-1"><Key className="h-3 w-3" />Token</span>}
                </button>
              ))}
            </div>

            {/* ── TOKEN sub-tab */}
            {ghTab === "token" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Enter a GitHub Personal Access Token (PAT) with <strong>repo</strong> scope. It's stored
                  server-side only — never sent to the browser after saving.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Personal Access Token</label>
                  <Input
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="h-9 font-mono text-sm"
                  />
                </div>
                <div className="flex gap-2">
                  <Button className="flex-1 gap-2" onClick={handleSaveToken} disabled={!tokenInput.trim() || savingToken}>
                    {savingToken ? <Loader2 className="h-4 w-4 animate-spin" /> : <Key className="h-4 w-4" />}
                    Save Token
                  </Button>
                  {tokenStatus?.set && (
                    <Button variant="outline" className="gap-2 text-red-400 hover:text-red-400" onClick={handleClearToken}>
                      <Trash2 className="h-4 w-4" />
                      Clear
                    </Button>
                  )}
                </div>
                <div className="p-3 rounded-lg bg-muted/30 text-xs text-muted-foreground space-y-1">
                  <p>Generate a token at <strong>GitHub → Settings → Developer settings → Personal access tokens</strong></p>
                  <p>Required scope: <code className="bg-muted px-1 rounded">repo</code></p>
                </div>
              </div>
            )}

            {/* ── CLONE sub-tab */}
            {ghTab === "clone" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Clone a repository into your workspace. If a GitHub token is saved, private repos work too.</p>
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
                  <label className="text-xs font-medium">Branch <span className="text-muted-foreground font-normal">(optional)</span></label>
                  <Input
                    placeholder="main"
                    value={branch}
                    onChange={(e) => setBranch(e.target.value)}
                    className="h-8 font-mono text-sm"
                  />
                </div>
                <div className="p-2.5 rounded-lg bg-muted/30 space-y-1">
                  <p className="text-xs font-medium text-muted-foreground mb-1">Examples</p>
                  {["https://github.com/pallets/flask", "https://github.com/fastapi/fastapi"].map(url => (
                    <button key={url} className="block text-xs text-primary/80 hover:text-primary font-mono truncate w-full text-left" onClick={() => setRepoUrl(url)}>{url}</button>
                  ))}
                </div>
                {cloning && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />Cloning... (large repos can take up to 60s)
                  </div>
                )}
                {cloneResult && (
                  <ResultBanner
                    success={cloneResult.success}
                    message={cloneResult.success ? `Cloned to: ${cloneResult.targetDir}` : "Clone failed"}
                    detail={cloneResult.success ? undefined : (cloneResult.stderr || cloneResult.error)}
                  />
                )}
                <Button className="w-full gap-2" onClick={handleClone} disabled={!repoUrl.trim() || cloning}>
                  {cloning ? <><Loader2 className="h-4 w-4 animate-spin" />Cloning...</> : <><Github className="h-4 w-4" />Clone Repository</>}
                </Button>
              </div>
            )}

            {/* ── PULL sub-tab */}
            {ghTab === "pull" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Pull the latest changes from the remote into an existing git repo in your workspace.
                  The saved GitHub token is used automatically for private repos.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Workspace path to pull in</label>
                  <Input
                    placeholder="e.g. my-project  (blank = workspace root)"
                    value={pullPath}
                    onChange={(e) => setPullPath(e.target.value)}
                    className="h-9 font-mono text-sm"
                  />
                </div>
                {pulling && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />Pulling...
                  </div>
                )}
                {pullResult && (
                  <ResultBanner
                    success={pullResult.success}
                    message={pullResult.success ? "Pull complete" : "Pull failed"}
                    detail={pullResult.success
                      ? (pullResult.stdout || pullResult.stderr || "").trim()
                      : (pullResult.stderr || pullResult.error)}
                  />
                )}
                <Button className="w-full gap-2" onClick={handlePull} disabled={pulling}>
                  {pulling ? <><Loader2 className="h-4 w-4 animate-spin" />Pulling...</> : <><GitPullRequest className="h-4 w-4" />Git Pull</>}
                </Button>
              </div>
            )}

            {/* ── PUSH sub-tab */}
            {ghTab === "push" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Stage all changes, commit, and push to the remote. Requires a saved GitHub token for auth.
                </p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Workspace path</label>
                  <Input
                    placeholder="e.g. my-project  (blank = workspace root)"
                    value={pushPath}
                    onChange={(e) => setPushPath(e.target.value)}
                    className="h-9 font-mono text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Commit message</label>
                  <Textarea
                    placeholder="Update: describe your changes"
                    value={commitMsg}
                    onChange={(e) => setCommitMsg(e.target.value)}
                    className="min-h-[60px] text-sm font-mono resize-none"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Branch <span className="text-muted-foreground font-normal">(optional, defaults to current branch)</span></label>
                  <Input
                    placeholder="main"
                    value={pushBranch}
                    onChange={(e) => setPushBranch(e.target.value)}
                    className="h-8 font-mono text-sm"
                  />
                </div>
                {!tokenStatus?.set && (
                  <div className="flex items-center gap-2 p-2.5 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <Unlock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                    <p className="text-xs text-amber-400">No token saved — push to private repos will fail. <button className="underline" onClick={() => setGhTab("token")}>Add token</button></p>
                  </div>
                )}
                {pushing && (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />Committing and pushing...
                  </div>
                )}
                {pushResult && (
                  <ResultBanner
                    success={pushResult.success}
                    message={pushResult.success ? "Push complete" : "Push failed"}
                    detail={pushResult.success
                      ? pushResult.steps?.map(s => `$ ${s.step}\n${(s.stdout + s.stderr).trim()}`).join("\n\n") || ""
                      : (pushResult.stderr || pushResult.error)}
                  />
                )}
                <Button className="w-full gap-2" onClick={handlePush} disabled={pushing}>
                  {pushing ? <><Loader2 className="h-4 w-4 animate-spin" />Pushing...</> : <><Send className="h-4 w-4" />Commit &amp; Push</>}
                </Button>
              </div>
            )}

            {/* ── STATUS sub-tab */}
            {ghTab === "status" && (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">Check if a workspace folder is a git repo and view its current branch, status, and remote.</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">Workspace path</label>
                  <div className="flex gap-2">
                    <Input
                      placeholder="e.g. my-project  (blank = workspace root)"
                      value={statusPath}
                      onChange={(e) => setStatusPath(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") handleStatus(); }}
                      className="h-9 font-mono text-sm flex-1"
                    />
                    <Button variant="outline" size="icon" className="h-9 w-9 shrink-0" onClick={handleStatus} disabled={statusLoading}>
                      {statusLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    </Button>
                  </div>
                </div>
                {statusResult && (
                  statusResult.isRepo ? (
                    <div className="rounded-lg border border-border p-3 space-y-2 font-mono text-xs">
                      <div className="flex items-center gap-2">
                        <GitBranch className="h-3.5 w-3.5 text-primary" />
                        <span className="text-muted-foreground">Branch:</span>
                        <span className="text-foreground">{statusResult.branch ?? "(detached)"}</span>
                      </div>
                      {statusResult.remote && (
                        <div className="flex items-center gap-2">
                          <Github className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-muted-foreground">Remote:</span>
                          <span className="text-foreground truncate">{statusResult.remote}</span>
                        </div>
                      )}
                      {statusResult.status !== null && (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">Changes:</span>
                          </div>
                          <pre className="bg-muted/40 rounded p-2 whitespace-pre-wrap text-[11px] max-h-32 overflow-y-auto">
                            {statusResult.status.trim() || "Working tree clean"}
                          </pre>
                        </div>
                      )}
                    </div>
                  ) : (
                    <ResultBanner success={false} message="Not a git repository" detail="Run git init or clone a repo first." />
                  )
                )}
                <Button className="w-full gap-2" onClick={handleStatus} disabled={statusLoading}>
                  {statusLoading ? <><Loader2 className="h-4 w-4 animate-spin" />Checking...</> : <><GitBranch className="h-4 w-4" />Check Status</>}
                </Button>
              </div>
            )}
          </TabsContent>

          {/* ── EXPORT TAB ─────────────────────────────────────────────────── */}
          <TabsContent value="export" className="space-y-4 mt-4">
            <p className="text-xs text-muted-foreground">
              Download your workspace or a specific folder as a ZIP. node_modules, .git, build artifacts are excluded.
            </p>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Path to export <span className="text-muted-foreground font-normal">(blank = entire workspace)</span></label>
                <Input
                  placeholder="e.g. my-project"
                  value={exportPath}
                  onChange={(e) => setExportPath(e.target.value)}
                  className="h-9 font-mono text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {["", "python-backend", "artifacts/ai-proxy", "lib"].map(p => (
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
              <div className="p-2.5 rounded-lg bg-muted/30 text-xs text-muted-foreground">
                Excluded: node_modules, .git, __pycache__, dist, build, .venv, hidden folders
              </div>
            </div>
            <Button className="w-full gap-2" onClick={handleExport} disabled={exporting}>
              {exporting ? <><Loader2 className="h-4 w-4 animate-spin" />Preparing...</> : <><Download className="h-4 w-4" />Download ZIP</>}
            </Button>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
