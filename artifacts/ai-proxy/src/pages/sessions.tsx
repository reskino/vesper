import { useState, useEffect, useCallback } from "react";
import {
  useListAis, getListAisQueryKey,
  useListSessions, getListSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldCheck, ShieldAlert, Trash2, Loader2,
  RefreshCw, X, ExternalLink,
  CheckCircle2, LogIn, RotateCcw, Cookie, UserCircle2, Key,
  AlertTriangle,
} from "lucide-react";

// ─── Constants ───────────────────────────────────────────────────────────────

// AIs that are Cloudflare-blocked and recommend API keys over cookies
const CLOUDFLARE_BLOCKED = new Set(["chatgpt", "claude"]);
// AIs that ONLY support API key (no cookies at all)
const API_KEY_ONLY = new Set(["groq"]);
// AIs that need no setup at all
const NO_AUTH = new Set(["pollinations"]);

const API_KEY_LINKS: Record<string, { label: string; url: string }> = {
  chatgpt: { label: "Get OpenAI API key", url: "https://platform.openai.com/api-keys" },
  claude:  { label: "Get Anthropic API key", url: "https://console.anthropic.com/settings/keys" },
  groq:    { label: "Get free Groq API key (no credit card)", url: "https://console.groq.com/keys" },
};

// ─── Login Guide Dialog ──────────────────────────────────────────────────────

interface LoginGuideProps {
  ai: { id: string; name: string; url: string };
  onClose: () => void;
  onSuccess: () => void;
}

type Mode = "api_key" | "cookies";

function LoginGuide({ ai, onClose, onSuccess }: LoginGuideProps) {
  const { toast } = useToast();
  const isCloudflareBlocked = CLOUDFLARE_BLOCKED.has(ai.id);
  const isApiKeyOnly = API_KEY_ONLY.has(ai.id);
  const [mode, setMode] = useState<Mode>(isCloudflareBlocked || isApiKeyOnly ? "api_key" : "cookies");

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-700 rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <span className="text-white font-semibold">Connect {ai.name}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Mode tabs — shown for ChatGPT/Claude (both modes) but not Groq (API key only) */}
        {isCloudflareBlocked && !isApiKeyOnly && (
          <div className="flex gap-1 px-5 pt-4">
            <button
              onClick={() => setMode("api_key")}
              className={`flex items-center gap-1.5 flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === "api_key"
                  ? "bg-blue-600 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              <Key size={13} className="mx-auto" />
              <span>API Key</span>
              <span className="text-[10px] ml-1 opacity-70">(recommended)</span>
            </button>
            <button
              onClick={() => setMode("cookies")}
              className={`flex items-center gap-1.5 flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                mode === "cookies"
                  ? "bg-gray-700 text-white"
                  : "bg-gray-800 text-gray-400 hover:text-white"
              }`}
            >
              <Cookie size={13} className="mx-auto" />
              <span>Browser Cookies</span>
            </button>
          </div>
        )}

        <div className="px-5 py-4 flex-1">
          {mode === "api_key" ? (
            <ApiKeyForm ai={ai} onClose={onClose} onSuccess={onSuccess} />
          ) : (
            <CookieForm ai={ai} onClose={onClose} onSuccess={onSuccess} cloudflareBlocked={isCloudflareBlocked} />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── API Key Form ─────────────────────────────────────────────────────────────

function ApiKeyForm({ ai, onClose, onSuccess }: LoginGuideProps) {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = API_KEY_LINKS[ai.id];

  const handleSave = async () => {
    if (!apiKey.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sessions/import-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, apiKey: apiKey.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "API key saved!", description: data.message });
        onSuccess();
        onClose();
      } else {
        setError(data.message ?? "Failed to save API key");
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-500/8 border border-blue-500/20 rounded-xl p-3 text-xs text-blue-200/80 space-y-1">
        <p className="font-medium text-blue-300">Why API key?</p>
        <p>
          {ai.name} protects its web interface with Cloudflare, which blocks cloud server IPs regardless
          of cookies. An official API key bypasses this and connects directly.
        </p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-300">
          {ai.id === "chatgpt" ? "OpenAI API Key" : "Anthropic API Key"}
        </label>
        <input
          type="password"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(null); }}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder={ai.id === "chatgpt" ? "sk-..." : "sk-ant-..."}
          className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-gray-200 font-mono focus:outline-none focus:border-blue-500 transition-colors"
          autoFocus
        />
        {link && (
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
          >
            <ExternalLink size={11} /> {link.label}
          </a>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 py-2 rounded-xl border border-gray-700 text-gray-400 hover:text-white text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || loading}
          className="flex-1 py-2 rounded-xl bg-blue-700 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
          Save API Key
        </button>
      </div>
    </div>
  );
}

// ─── Cookie Form (3-step wizard) ──────────────────────────────────────────────

function CookieForm({ ai, onClose, onSuccess, cloudflareBlocked }: LoginGuideProps & { cloudflareBlocked: boolean }) {
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

  return (
    <div className="space-y-4">
      {cloudflareBlocked && (
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2.5 text-xs text-amber-300">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <p>
            <strong>Note:</strong> {ai.name} uses Cloudflare bot protection that blocks cloud server IPs.
            Cookie sessions likely won't work from here — <strong>API Key mode is recommended</strong>.
          </p>
        </div>
      )}

      {/* Step indicators */}
      <div className="flex items-center gap-0">
        {([1, 2, 3] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-0 flex-1">
            <button
              onClick={() => setStep(s)}
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors flex-shrink-0 ${
                step === s
                  ? "bg-blue-500 text-white"
                  : step > s
                  ? "bg-green-500 text-white"
                  : "bg-gray-800 text-gray-500"
              }`}
            >
              {step > s ? <CheckCircle2 size={14} /> : s}
            </button>
            {i < 2 && (
              <div className={`flex-1 h-px mx-1 ${step > s + 1 ? "bg-green-500" : step > s ? "bg-blue-500/50" : "bg-gray-700"}`} />
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <p className="text-white font-medium mb-1">Log in to {ai.name}</p>
            <p className="text-gray-400 text-sm">Open the site in your browser and sign in.</p>
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
            <p>• Once on the main chat page, come back here and continue</p>
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full py-2 rounded-xl border border-blue-500/50 text-blue-400 hover:bg-blue-500/10 text-sm font-medium transition-colors"
          >
            I'm logged in → Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="text-white font-medium mb-1">Export your cookies</p>
            <p className="text-gray-400 text-sm">Use Cookie Editor to copy your session cookies as JSON.</p>
          </div>
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
            <p>• Go to <strong className="text-gray-200">{ai.url}</strong></p>
            <p>• Click the <strong className="text-gray-200">Cookie Editor</strong> icon in your toolbar</p>
            <p>• Click <strong className="text-gray-200">Export → Export as JSON</strong> — copies to clipboard</p>
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

      {step === 3 && (
        <div className="space-y-3">
          <div>
            <p className="text-white font-medium mb-1">Paste & save</p>
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
  const [usernames, setUsernames] = useState<Record<string, string>>({});
  const [authModes, setAuthModes] = useState<Record<string, string>>({});
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());

  const verifySession = useCallback(async (aiId: string) => {
    setVerifyingIds(prev => new Set([...prev, aiId]));
    try {
      const res = await fetch(`/api/sessions/verify/${aiId}`);
      const data = await res.json();
      if (data.success && data.username) {
        setUsernames(prev => ({ ...prev, [aiId]: data.username }));
        setAuthModes(prev => ({ ...prev, [aiId]: data.authMode ?? "cookies" }));
      } else {
        setUsernames(prev => { const n = { ...prev }; delete n[aiId]; return n; });
      }
    } catch { /* ignore */ }
    setVerifyingIds(prev => { const s = new Set(prev); s.delete(aiId); return s; });
  }, []);

  useEffect(() => {
    const ais = aisData?.ais ?? [];
    ais.filter((ai: any) => ai.hasSession).forEach((ai: any) => verifySession(ai.id));
  }, [aisData, verifySession]);

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
              Connect AI services via API key or browser cookies
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

          {/* Info banner */}
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-xl p-4 text-sm space-y-2">
            <p className="font-medium text-blue-300">How to connect</p>
            <div className="grid grid-cols-1 gap-1.5 text-blue-200/70 text-xs">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={13} className="flex-shrink-0 mt-0.5 text-green-400" />
                <span><strong className="text-green-300">Pollinations AI</strong> — Always available, no setup needed. Uses GPT-4o, Claude 3.7, DeepSeek for free.</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={13} className="flex-shrink-0 mt-0.5 text-blue-400" />
                <span><strong className="text-blue-200">Groq</strong> — Free API key from console.groq.com (no credit card). Llama 3.3 70B, 1000 req/day.</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={13} className="flex-shrink-0 mt-0.5 text-blue-400" />
                <span><strong className="text-blue-200">ChatGPT & Claude</strong> — Use an official API key. Cookies are blocked by Cloudflare from cloud servers.</span>
              </div>
              <div className="flex items-start gap-2">
                <Cookie size={13} className="flex-shrink-0 mt-0.5 text-blue-400" />
                <span><strong className="text-blue-200">Grok</strong> — Export cookies from grok.com with Cookie Editor and paste the JSON here.</span>
              </div>
            </div>
          </div>

          {/* AI Cards */}
          {ais.map((ai: any) => {
            const hasSession = ai.hasSession;
            const isBlocked = CLOUDFLARE_BLOCKED.has(ai.id);
            const isNoAuth = NO_AUTH.has(ai.id);
            const isApiKeyOnlyAi = API_KEY_ONLY.has(ai.id);
            const mode = authModes[ai.id];

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
                      <div className="flex items-center gap-2 flex-wrap">
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
                        {isNoAuth && (
                          <span className="flex items-center gap-1 text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
                            <CheckCircle2 size={10} /> Free, no setup
                          </span>
                        )}
                        {isApiKeyOnlyAi && !hasSession && (
                          <span className="flex items-center gap-1 text-xs text-blue-400/80 bg-blue-500/10 px-2 py-0.5 rounded-full">
                            <Key size={10} /> Free API key
                          </span>
                        )}
                        {isBlocked && !hasSession && !isNoAuth && (
                          <span className="flex items-center gap-1 text-xs text-amber-500/80 bg-amber-500/10 px-2 py-0.5 rounded-full">
                            <Key size={10} /> API key recommended
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{ai.url}</div>
                      {hasSession && (
                        <div className="flex items-center gap-2 mt-1 flex-wrap">
                          {mode === "api_key" && (
                            <span className="flex items-center gap-1 text-xs text-blue-400/80 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                              <Key size={10} /> API key
                            </span>
                          )}
                          {verifyingIds.has(ai.id) ? (
                            <span className="flex items-center gap-1.5 text-xs text-blue-400">
                              <Loader2 size={11} className="animate-spin" /> Verifying…
                            </span>
                          ) : usernames[ai.id] ? (
                            <span className="flex items-center gap-1.5 text-xs text-green-400">
                              <UserCircle2 size={12} /> {usernames[ai.id]}
                            </span>
                          ) : (
                            <button
                              onClick={() => verifySession(ai.id)}
                              className="flex items-center gap-1 text-xs text-gray-500 hover:text-blue-400 transition-colors"
                            >
                              <RefreshCw size={10} /> Verify session
                            </button>
                          )}
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

                {!isNoAuth && (
                  <div className="mt-4">
                    <button
                      onClick={() => setLoginAi({ id: ai.id, name: ai.name, url: ai.url })}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-blue-700 hover:bg-blue-600 text-white text-sm font-medium transition-colors"
                    >
                      {hasSession ? <RotateCcw size={14} /> : <LogIn size={14} />}
                      {hasSession ? "Re-connect" : "Connect"}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>

      {loginAi && (
        <LoginGuide
          ai={loginAi}
          onClose={() => setLoginAi(null)}
          onSuccess={() => {
            refreshAll();
            setTimeout(() => verifySession(loginAi.id), 800);
          }}
        />
      )}
    </div>
  );
}

export { SessionsPage as Sessions };
