import { useState } from "react";
import {
  useListAis, getListAisQueryKey,
  useListSessions, getListSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldCheck, ShieldAlert, Trash2, Loader2,
  RefreshCw, Upload, X, ExternalLink,
  CheckCircle2, LogIn, RotateCcw, Cookie, Copy,
} from "lucide-react";

// ─── Login Guide Dialog ──────────────────────────────────────────────────────
// Guides the user to export cookies from their own browser using Cookie Editor
// and paste them here. No headless browser or screenshot proxy needed.

interface LoginGuideProps {
  ai: { id: string; name: string; url: string };
  onClose: () => void;
  onSuccess: () => void;
}

function LoginGuide({ ai, onClose, onSuccess }: LoginGuideProps) {
  const { toast } = useToast();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [jsonText, setJsonText] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleImport = async () => {
    if (!jsonText.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, stateJson: jsonText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Session saved!", description: data.message });
        onSuccess();
        onClose();
      } else {
        setError(data.message ?? "Import failed");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const STEPS = [
    {
      num: 1 as const,
      title: "Log in to " + ai.name,
      desc: "Open the site in your browser and sign in to your account.",
    },
    {
      num: 2 as const,
      title: "Export your cookies",
      desc: "Use Cookie Editor to copy your session cookies as JSON.",
    },
    {
      num: 3 as const,
      title: "Paste & save",
      desc: "Paste the JSON here to connect this AI to the proxy.",
    },
  ];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Cookie size={18} className="text-blue-400" />
            <span className="text-white font-semibold">Connect {ai.name}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-0 px-5 pt-4">
          {STEPS.map((s, i) => (
            <div key={s.num} className="flex items-center gap-0 flex-1">
              <button
                onClick={() => setStep(s.num)}
                className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors flex-shrink-0 ${
                  step === s.num
                    ? "bg-blue-500 text-white"
                    : step > s.num
                    ? "bg-green-500 text-white"
                    : "bg-gray-800 text-gray-500"
                }`}
              >
                {step > s.num ? <CheckCircle2 size={14} /> : s.num}
              </button>
              {i < STEPS.length - 1 && (
                <div className={`flex-1 h-px mx-1 ${step > s.num + 1 ? "bg-green-500" : step > s.num ? "bg-blue-500/50" : "bg-gray-700"}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="px-5 py-4 flex-1">

          {/* Step 1 — Open the site */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <p className="text-white font-medium mb-1">{STEPS[0].title}</p>
                <p className="text-gray-400 text-sm">{STEPS[0].desc}</p>
              </div>
              <a
                href={ai.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-medium text-sm transition-colors"
              >
                <ExternalLink size={15} />
                Open {ai.name} in a new tab
              </a>
              <div className="bg-gray-800/60 rounded-xl p-3 text-xs text-gray-400 space-y-1">
                <p>• Log in with your {ai.name} account as you normally would</p>
                <p>• Complete any 2FA or verification steps</p>
                <p>• Once you're on the main chat page, come back here and continue</p>
              </div>
              <button
                onClick={() => setStep(2)}
                className="w-full py-2 rounded-xl border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 text-sm font-medium transition-colors"
              >
                I'm logged in → Next
              </button>
            </div>
          )}

          {/* Step 2 — Cookie Editor */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <p className="text-white font-medium mb-1">{STEPS[1].title}</p>
                <p className="text-gray-400 text-sm">{STEPS[1].desc}</p>
              </div>

              {/* Extension install */}
              <div className="bg-gray-800/60 rounded-xl p-3 space-y-2">
                <p className="text-xs font-medium text-gray-300">1. Install Cookie Editor (free, open-source)</p>
                <div className="flex gap-2">
                  <a href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                     target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-white transition-colors">
                    <ExternalLink size={11} /> Chrome
                  </a>
                  <a href="https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/"
                     target="_blank" rel="noopener noreferrer"
                     className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gray-700 hover:bg-gray-600 text-xs text-white transition-colors">
                    <ExternalLink size={11} /> Firefox
                  </a>
                </div>
              </div>

              <div className="bg-gray-800/60 rounded-xl p-3 space-y-1.5 text-xs text-gray-400">
                <p className="text-gray-300 font-medium">2. Export your cookies</p>
                <p>• Go to <strong className="text-gray-200">{ai.url}</strong> (the tab you just logged in to)</p>
                <p>• Click the <strong className="text-gray-200">Cookie Editor</strong> icon in your browser toolbar</p>
                <p>• Click <strong className="text-gray-200">Export → Export as JSON</strong> — it copies to clipboard</p>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(1)}
                  className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium transition-colors"
                >
                  I've exported cookies → Next
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Paste & import */}
          {step === 3 && (
            <div className="space-y-3">
              <div>
                <p className="text-white font-medium mb-1">{STEPS[2].title}</p>
                <p className="text-gray-400 text-sm">Paste the JSON you copied from Cookie Editor.</p>
              </div>

              <textarea
                value={jsonText}
                onChange={e => { setJsonText(e.target.value); setError(null); }}
                placeholder={`[\n  {"name": "session", "value": "...", "domain": ".${ai.url.replace(/https?:\/\//, "")}", ...}\n]`}
                className="w-full h-36 bg-gray-800 border border-gray-700 rounded-xl p-3 text-xs text-gray-200 font-mono resize-none focus:outline-none focus:border-blue-500 transition-colors"
                autoFocus
              />

              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
                  {error}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={() => setStep(2)}
                  className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm transition-colors"
                >
                  ← Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={!jsonText.trim() || loading}
                  className="flex-1 py-2 rounded-xl bg-green-700 hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Save Session
                </button>
              </div>
            </div>
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
  const [loginAi, setLoginAi] = useState<{ id: string; name: string; url: string } | null>(null);

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
              Connect AI services using your existing accounts — no API keys needed
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

          {/* How it works */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-sm">
            <p className="font-medium text-blue-300 mb-2">How to connect an AI</p>
            <div className="flex items-start gap-6 text-blue-200/70 flex-wrap">
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0">1</span>
                <span>Click <strong className="text-blue-200">Login</strong> and open the AI site</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0">2</span>
                <span>Export cookies with <strong className="text-blue-200">Cookie Editor</strong> extension</span>
              </div>
              <div className="flex items-center gap-2 min-w-0">
                <span className="w-5 h-5 rounded-full bg-blue-500/30 text-blue-300 text-xs font-bold flex items-center justify-center flex-shrink-0">3</span>
                <span>Paste JSON and click <strong className="text-blue-200">Save Session</strong></span>
              </div>
            </div>
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
                            <ShieldCheck size={11} /> Active
                          </span>
                        ) : (
                          <span className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800 px-2 py-0.5 rounded-full">
                            <ShieldAlert size={11} /> No session
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

                <div className="mt-4">
                  <button
                    onClick={() => setLoginAi({ id: ai.id, name: ai.name, url: ai.url })}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                  >
                    {hasSession ? <RotateCcw size={14} /> : <LogIn size={14} />}
                    {hasSession ? "Re-connect" : "Login"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {loginAi && (
        <LoginGuide
          ai={loginAi}
          onClose={() => setLoginAi(null)}
          onSuccess={refreshAll}
        />
      )}
    </div>
  );
}

export { SessionsPage as Sessions };
