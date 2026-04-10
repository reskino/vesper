import { useState, useEffect, useRef, useCallback } from "react";
import {
  useListAis, getListAisQueryKey,
  useListSessions, getListSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldCheck, ShieldAlert, Trash2, Loader2,
  RefreshCw, Globe, Monitor, Upload, X,
  CheckCircle2, AlertCircle, LogIn, Mouse,
  Keyboard, RotateCcw,
} from "lucide-react";

// ─── Browser Viewer ─────────────────────────────────────────────────────────

interface BrowserViewerProps {
  aiId: string;
  aiName: string;
  onClose: () => void;
  onSaved: () => void;
}

function BrowserViewer({ aiId, aiName, onClose, onSaved }: BrowserViewerProps) {
  const { toast } = useToast();
  const [imgObjectUrl, setImgObjectUrl] = useState<string | null>(null);
  const [statusText, setStatusText] = useState("Starting browser…");
  const [statusColor, setStatusColor] = useState<"yellow" | "green" | "red" | "blue">("yellow");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const savedRef = useRef(false);
  const objUrlRef = useRef<string | null>(null);

  // Fetch the PNG explicitly via fetch() — avoids browser HEAD / proxy caching issues
  useEffect(() => {
    let cancelled = false;

    const fetchShot = async () => {
      if (cancelled || savedRef.current) return;
      try {
        const res = await fetch(
          `/api/sessions/browser-screenshot/${aiId}?_=${Date.now()}`,
          { cache: "no-store" }
        );
        if (cancelled) return;
        if (res.ok && res.status !== 204) {
          const blob = await res.blob();
          if (cancelled || blob.size < 100) return; // ignore empty/tiny responses
          if (blob.type.startsWith("image/")) {
            const url = URL.createObjectURL(blob);
            if (objUrlRef.current) URL.revokeObjectURL(objUrlRef.current);
            objUrlRef.current = url;
            setImgObjectUrl(url);
          }
        }
      } catch { /* retry next tick */ }
    };

    fetchShot(); // first fetch immediately
    const id = setInterval(fetchShot, 1000);

    return () => {
      cancelled = true;
      clearInterval(id);
      if (objUrlRef.current) {
        URL.revokeObjectURL(objUrlRef.current);
        objUrlRef.current = null;
      }
    };
  }, [aiId]);

  // Poll status
  useEffect(() => {
    if (savedRef.current) return;
    const id = setInterval(async () => {
      if (savedRef.current) return;
      try {
        const res = await fetch(`/api/sessions/browser-status/${aiId}`);
        const data = await res.json();
        const s = data.status ?? "starting";

        if (s === "saved") {
          savedRef.current = true;
          clearInterval(id);
          setStatusText("Session saved!");
          setStatusColor("blue");
          toast({ title: "Session saved", description: `${aiName} is now connected.` });
          onSaved();
          setTimeout(onClose, 1200);
        } else if (s === "error") {
          setError(data.error ?? "Unknown error");
          setStatusText("Error");
          setStatusColor("red");
        } else if (s === "ready") {
          setStatusText(data.url ? `Loaded: ${data.url}` : "Browser ready");
          setStatusColor("green");
        } else {
          setStatusText("Starting browser…");
          setStatusColor("yellow");
        }
      } catch { /* ignore */ }
    }, 1500);
    return () => clearInterval(id);
  }, [aiId]);

  const sendAction = useCallback(async (payload: Record<string, unknown>) => {
    try {
      await fetch(`/api/sessions/browser-action/${aiId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    } catch { /* ignore */ }
  }, [aiId]);

  const handleImgClick = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    const x = Math.round(((e.clientX - rect.left) / rect.width)  * 1280);
    const y = Math.round(((e.clientY - rect.top)  / rect.height) * 900);
    sendAction({ action: "click", x, y });
  }, [sendAction]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    e.preventDefault();
    const KEY_MAP: Record<string, string> = {
      Enter: "Enter", Backspace: "Backspace", Tab: "Tab",
      ArrowUp: "ArrowUp", ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft", ArrowRight: "ArrowRight",
      Escape: "Escape", Delete: "Delete", Home: "Home", End: "End",
    };
    if (KEY_MAP[e.key]) sendAction({ action: "key", key: KEY_MAP[e.key] });
    else if (e.key.length === 1) sendAction({ action: "type", text: e.key });
  }, [sendAction]);

  const handleSave = async () => {
    setSaving(true);
    setStatusText("Saving session…");
    await sendAction({ action: "save" });
  };

  const handleCancel = async () => {
    await sendAction({ action: "quit" });
    onClose();
  };

  const BADGE_CLS = {
    yellow: "bg-yellow-500/20 text-yellow-400",
    green:  "bg-green-500/20 text-green-400",
    red:    "bg-red-500/20 text-red-400",
    blue:   "bg-blue-500/20 text-blue-400",
  }[statusColor];

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-4xl shadow-2xl flex flex-col"
        style={{ maxHeight: "90vh" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Monitor size={16} className="text-green-400" />
            <span className="text-white font-medium text-sm">
              {aiName} — Log in, then click <strong>Save Session</strong>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs px-2 py-0.5 rounded-full ${BADGE_CLS}`}>
              {statusText}
            </span>
            <button onClick={handleCancel} className="p-1 text-gray-400 hover:text-white">
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Live browser view */}
        <div
          className="flex-1 bg-black flex items-center justify-center relative outline-none"
          style={{ minHeight: 320 }}
          tabIndex={0}
          onKeyDown={handleKeyDown}
        >
          {/* Loading spinner — shown until screenshot arrives */}
          {!imgObjectUrl && !error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center z-10 bg-black">
              <Loader2 size={40} className="text-blue-400 animate-spin mb-3" />
              <p className="text-gray-300 font-medium">Starting browser…</p>
              <p className="text-gray-500 text-sm mt-1">This takes a few seconds</p>
            </div>
          )}

          {error && (
            <div className="text-center p-8">
              <AlertCircle size={40} className="text-red-400 mx-auto mb-3" />
              <p className="text-red-300 font-medium mb-1">Browser error</p>
              <p className="text-gray-400 text-sm">{error}</p>
            </div>
          )}

          {/* Live screenshot — blob URL fetched explicitly every second via fetch() */}
          {imgObjectUrl && (
            <img
              ref={imgRef}
              src={imgObjectUrl}
              alt="Browser"
              onClick={handleImgClick}
              className="w-full h-auto object-contain"
              style={{ cursor: "pointer", maxHeight: "calc(90vh - 120px)" }}
              draggable={false}
            />
          )}

          {imgObjectUrl && (
            <div className="absolute bottom-2 left-2 flex gap-2 pointer-events-none">
              <span className="bg-black/60 text-gray-400 text-[10px] px-2 py-1 rounded flex items-center gap-1">
                <Mouse size={10} /> Click to interact
              </span>
              <span className="bg-black/60 text-gray-400 text-[10px] px-2 py-1 rounded flex items-center gap-1">
                <Keyboard size={10} /> Click viewer, then type
              </span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700 flex-shrink-0">
          <p className="text-xs text-gray-500">Log in with your account, then click Save Session</p>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              className="px-3 py-1.5 rounded-lg border border-gray-600 text-gray-400 hover:text-white text-sm transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              {saving ? <Loader2 size={13} className="animate-spin" /> : <CheckCircle2 size={13} />}
              Save Session
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Import Session Dialog ─────────────────────────────────────────────────────

interface ImportDialogProps {
  ai: { id: string; name: string };
  onClose: () => void;
  onSuccess: () => void;
}

function ImportDialog({ ai, onClose, onSuccess }: ImportDialogProps) {
  const { toast } = useToast();
  const [jsonText, setJsonText] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!jsonText.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, stateJson: jsonText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Session imported", description: `${ai.name} session is now active.` });
        onSuccess();
        onClose();
      } else {
        toast({ variant: "destructive", title: "Import failed", description: data.message });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-lg p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold text-lg flex items-center gap-2">
            <Upload size={18} className="text-blue-400" />
            Import Session — {ai.name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3 mb-4 text-sm text-blue-300">
          <p className="font-medium mb-1">How to export your cookies:</p>
          <ol className="list-decimal ml-4 space-y-1 text-blue-200/80">
            <li>Install the <strong>Cookie Editor</strong> extension (Chrome / Firefox)</li>
            <li>Go to {ai.name} and log in normally</li>
            <li>Click the Cookie Editor icon → <strong>Export → Export as JSON</strong></li>
            <li>Paste the copied JSON below — the <code className="bg-black/30 px-1 rounded">[ ... ]</code> array format is accepted directly</li>
          </ol>
        </div>

        <textarea
          value={jsonText}
          onChange={e => setJsonText(e.target.value)}
          placeholder={"Paste Cookie Editor JSON here — both [ {name, value, ...}, ... ] and Playwright storage_state formats are accepted"}
          className="w-full h-40 bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500 mb-4"
        />

        <div className="flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400 text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!jsonText.trim() || loading}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center gap-2"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            Import Session
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Sessions Page ────────────────────────────────────────────────────────

export function SessionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: aisData, isLoading: aisLoading } = useListAis();
  const { data: sessionsData, isLoading: sessionsLoading } = useListSessions();

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [importAi, setImportAi] = useState<{ id: string; name: string } | null>(null);
  const [browserAi, setBrowserAi] = useState<{ id: string; name: string; url: string } | null>(null);
  const [launchingId, setLaunchingId] = useState<string | null>(null);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
  };

  const handleLaunchBrowser = async (ai: { id: string; name: string; url: string }) => {
    setLaunchingId(ai.id);
    try {
      const res = await fetch("/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id }),
      });
      const data = await res.json();
      if (data.success) {
        setBrowserAi(ai);
      } else {
        toast({ variant: "destructive", title: "Failed to launch browser", description: data.message });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setLaunchingId(null);
    }
  };

  const handleDelete = async (aiId: string, aiName: string) => {
    setDeletingId(aiId);
    try {
      const res = await fetch(`/api/sessions/${aiId}/delete`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Session deleted", description: `${aiName} session removed.` });
        refreshAll();
      } else {
        toast({ variant: "destructive", title: "Delete failed", description: data.message });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setDeletingId(null);
    }
  };

  const isLoading = aisLoading || sessionsLoading;
  const ais = aisData?.ais ?? [];
  const sessions = sessionsData?.sessions ?? [];
  const getSession = (aiId: string) => sessions.find((s: any) => s.aiId === aiId);
  const connectedCount = ais.filter((ai: any) => ai.hasSession).length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={28} className="animate-spin text-blue-400" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-800 px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-white">Sessions</h1>
            <p className="text-sm text-gray-400 mt-0.5">
              Log in to AI services with your accounts — no API keys needed
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-400">{connectedCount}/{ais.length} connected</span>
            <button
              onClick={refreshAll}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800 transition-colors"
              title="Refresh"
            >
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4">

          {/* How it works banner */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-200/80">
            <p className="font-medium text-blue-300 mb-1">How it works</p>
            <p>
              Click <strong className="text-blue-200">Browser Login</strong> — a headless browser opens on the server
              and shows a live preview below. Log in with your account in that preview, then click
              <strong className="text-blue-200"> Save Session</strong>. Your cookies are stored locally
              and used for all future requests.
            </p>
          </div>

          {/* AI Cards */}
          {ais.map((ai: any) => {
            const session = getSession(ai.id);
            const hasSession = ai.hasSession;
            const isLaunching = launchingId === ai.id;

            return (
              <div
                key={ai.id}
                className={`rounded-xl border p-5 transition-colors ${
                  hasSession
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-gray-700 bg-gray-900"
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg font-bold ${
                      hasSession ? "bg-green-500/20 text-green-400" : "bg-gray-800 text-gray-400"
                    }`}>
                      {ai.name[0]}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold">{ai.name}</span>
                        {hasSession ? (
                          <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                            <ShieldCheck size={11} />Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                            <ShieldAlert size={11} />No session
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{ai.url}</div>
                      {hasSession && session?.lastUsed && (
                        <div className="text-xs text-gray-500 mt-0.5">
                          Saved {new Date(session.lastUsed).toLocaleDateString()}
                        </div>
                      )}
                    </div>
                  </div>

                  {hasSession && (
                    <button
                      onClick={() => handleDelete(ai.id, ai.name)}
                      disabled={deletingId === ai.id}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                      title="Remove session"
                    >
                      {deletingId === ai.id
                        ? <Loader2 size={14} className="animate-spin" />
                        : <Trash2 size={14} />}
                    </button>
                  )}
                </div>

                <div className="mt-4 flex gap-2 flex-wrap">
                  <button
                    onClick={() => handleLaunchBrowser(ai)}
                    disabled={isLaunching}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 disabled:opacity-60 text-white text-sm font-medium transition-colors"
                  >
                    {isLaunching
                      ? <Loader2 size={14} className="animate-spin" />
                      : hasSession ? <RotateCcw size={14} /> : <LogIn size={14} />}
                    {hasSession ? "Re-login" : "Browser Login"}
                  </button>
                  <button
                    onClick={() => setImportAi({ id: ai.id, name: ai.name })}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-500 text-gray-300 text-sm transition-colors"
                  >
                    <Upload size={14} />
                    Import Cookies
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {/* Dialogs */}
      {importAi && (
        <ImportDialog
          ai={importAi}
          onClose={() => setImportAi(null)}
          onSuccess={refreshAll}
        />
      )}
      {browserAi && (
        <BrowserViewer
          aiId={browserAi.id}
          aiName={browserAi.name}
          onClose={() => setBrowserAi(null)}
          onSaved={refreshAll}
        />
      )}
    </div>
  );
}

export { SessionsPage as Sessions };
