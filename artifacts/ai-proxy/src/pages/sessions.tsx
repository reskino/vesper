import { useState, useEffect, useRef } from "react";
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
  CheckCircle2, AlertCircle, LogIn,
} from "lucide-react";

// ─── Import Session Dialog ─────────────────────────────────────────────────────

interface ImportDialogProps {
  ai: { id: string; name: string };
  onClose: () => void;
  onSuccess: () => void;
}

function ImportDialog({ ai, onClose, onSuccess }: ImportDialogProps) {
  const { toast } = useToast();
  const [json, setJson] = useState("");
  const [loading, setLoading] = useState(false);

  const handleImport = async () => {
    if (!json.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, stateJson: json.trim() }),
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
          <p className="font-medium mb-1">How to export your browser session:</p>
          <ol className="list-decimal ml-4 space-y-1 text-blue-200/80">
            <li>Open {ai.name} in Chrome and log in</li>
            <li>Install the <strong>EditThisCookie</strong> or <strong>Cookie-Editor</strong> extension</li>
            <li>Export cookies as JSON and paste below</li>
          </ol>
          <p className="mt-2 text-xs text-blue-200/60">
            Or use the Live Browser Login below for a guided experience.
          </p>
        </div>

        <textarea
          value={json}
          onChange={e => setJson(e.target.value)}
          placeholder='Paste Playwright storage_state JSON here ({"cookies": [...], "origins": [...]})'
          className="w-full h-40 bg-gray-800 border border-gray-600 rounded-lg p-3 text-sm text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500 mb-4"
        />

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400 text-sm transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={!json.trim() || loading}
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

// ─── Browser Login Dialog ─────────────────────────────────────────────────────

interface BrowserLoginDialogProps {
  ai: { id: string; name: string; url: string };
  onClose: () => void;
  onSuccess: () => void;
}

function BrowserLoginDialog({ ai, onClose, onSuccess }: BrowserLoginDialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState<"idle" | "launching" | "waiting" | "saving" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleLaunch = async () => {
    setStatus("launching");
    setMessage("Launching browser...");
    try {
      const res = await fetch("/api/sessions/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id }),
      });
      const data = await res.json();
      if (data.success) {
        setStatus("waiting");
        setMessage("Browser opened. Log into " + ai.name + " and then click Save Session.");
        // Poll for session completion
        pollRef.current = setInterval(async () => {
          try {
            const statusRes = await fetch(`/api/sessions/browser-status/${ai.id}`);
            const statusData = await statusRes.json();
            if (statusData.status === "saved") {
              clearInterval(pollRef.current!);
              setStatus("done");
              setMessage("Session saved successfully!");
              toast({ title: "Session created", description: `${ai.name} session is now active.` });
              onSuccess();
              setTimeout(onClose, 1500);
            } else if (statusData.status === "error") {
              clearInterval(pollRef.current!);
              setStatus("error");
              setMessage(statusData.error || "An error occurred.");
            }
          } catch {
            // ignore poll errors
          }
        }, 2000);
      } else {
        setStatus("error");
        setMessage(data.message || "Failed to launch browser.");
      }
    } catch (e: any) {
      setStatus("error");
      setMessage(e.message);
    }
  };

  const handleSave = async () => {
    setStatus("saving");
    setMessage("Saving session...");
    try {
      await fetch(`/api/sessions/browser-action/${ai.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "save" }),
      });
      setMessage("Session saved! Closing browser...");
    } catch (e: any) {
      setStatus("error");
      setMessage(e.message);
    }
  };

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-white font-semibold text-lg flex items-center gap-2">
            <Monitor size={18} className="text-green-400" />
            Browser Login — {ai.name}
          </h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="bg-gray-800 rounded-lg p-4 mb-4 text-sm text-gray-300 space-y-2">
          <p>A browser window will open on the server and navigate to:</p>
          <p className="font-mono text-blue-400 text-xs bg-gray-700 px-2 py-1 rounded">{ai.url}</p>
          <p>Log in with your account, then click <strong className="text-white">Save Session</strong> below.</p>
        </div>

        {message && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${
            status === "error" ? "bg-red-500/10 border border-red-500/30 text-red-300" :
            status === "done" ? "bg-green-500/10 border border-green-500/30 text-green-300" :
            "bg-blue-500/10 border border-blue-500/30 text-blue-300"
          }`}>
            {status === "launching" || status === "saving" ? (
              <Loader2 size={14} className="animate-spin flex-shrink-0" />
            ) : status === "done" ? (
              <CheckCircle2 size={14} className="flex-shrink-0" />
            ) : status === "error" ? (
              <AlertCircle size={14} className="flex-shrink-0" />
            ) : (
              <Monitor size={14} className="flex-shrink-0" />
            )}
            {message}
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg border border-gray-600 text-gray-300 hover:border-gray-400 text-sm transition-colors"
          >
            Cancel
          </button>
          {status === "idle" && (
            <button
              onClick={handleLaunch}
              className="px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <Globe size={14} />
              Open Browser
            </button>
          )}
          {status === "waiting" && (
            <button
              onClick={handleSave}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors flex items-center gap-2"
            >
              <CheckCircle2 size={14} />
              Save Session
            </button>
          )}
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

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
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
        toast({ variant: "destructive", title: "Failed to delete", description: data.message });
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

  const getSession = (aiId: string) =>
    sessions.find((s: any) => s.aiId === aiId);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={28} className="animate-spin text-blue-400" />
      </div>
    );
  }

  const connectedCount = ais.filter((ai: any) => ai.hasSession).length;

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
            <span className="text-sm text-gray-400">
              {connectedCount}/{ais.length} connected
            </span>
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

          {/* How it works */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-sm text-blue-200/80">
            <p className="font-medium text-blue-300 mb-2">How this works</p>
            <ul className="space-y-1 list-disc ml-4 text-blue-200/70">
              <li>Click <strong className="text-blue-200">Browser Login</strong> to open a browser and log in with your account</li>
              <li>Your session cookies are saved locally — no API keys or payments required</li>
              <li>Prompts are sent via each service's internal API using those cookies</li>
              <li>Cloudflare is bypassed using browser-grade TLS fingerprinting</li>
            </ul>
          </div>

          {/* AI Cards */}
          {ais.map((ai: any) => {
            const session = getSession(ai.id);
            const hasSession = ai.hasSession;

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
                            <ShieldCheck size={11} />
                            Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                            <ShieldAlert size={11} />
                            No session
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

                  <div className="flex items-center gap-2">
                    {hasSession && (
                      <button
                        onClick={() => handleDelete(ai.id, ai.name)}
                        disabled={deletingId === ai.id}
                        className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-400/10 transition-colors"
                        title="Remove session"
                      >
                        {deletingId === ai.id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    )}
                  </div>
                </div>

                {!hasSession && (
                  <div className="mt-4 flex gap-2">
                    <button
                      onClick={() => setBrowserAi({ id: ai.id, name: ai.name, url: ai.url })}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 hover:bg-green-600 text-white text-sm font-medium transition-colors"
                    >
                      <LogIn size={14} />
                      Browser Login
                    </button>
                    <button
                      onClick={() => setImportAi({ id: ai.id, name: ai.name })}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-500 text-gray-300 text-sm transition-colors"
                    >
                      <Upload size={14} />
                      Import Cookies
                    </button>
                  </div>
                )}

                {hasSession && (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => setBrowserAi({ id: ai.id, name: ai.name, url: ai.url })}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-400 text-xs transition-colors"
                    >
                      <RefreshCw size={12} />
                      Re-login
                    </button>
                    <button
                      onClick={() => setImportAi({ id: ai.id, name: ai.name })}
                      className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-700 hover:border-gray-600 text-gray-400 text-xs transition-colors"
                    >
                      <Upload size={12} />
                      Replace Cookies
                    </button>
                  </div>
                )}
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
        <BrowserLoginDialog
          ai={browserAi}
          onClose={() => setBrowserAi(null)}
          onSuccess={refreshAll}
        />
      )}
    </div>
  );
}

export { SessionsPage as Sessions };
