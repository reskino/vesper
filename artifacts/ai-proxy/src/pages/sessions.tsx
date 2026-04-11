import { useState, useEffect, useCallback } from "react";
import {
  useListAis, getListAisQueryKey,
  useListSessions, getListSessionsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import {
  ShieldCheck, ShieldAlert, Trash2, Loader2,
  RefreshCw, X, ExternalLink,
  CheckCircle2, LogIn, RotateCcw, Cookie, UserCircle2, Key,
  AlertTriangle, Zap, Search, XCircle, Plus, FlaskConical,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AiInfo {
  id: string;
  name: string;
  url: string;
  authMode: "none" | "api_key" | "api_key_or_cookies" | "cookies";
  keyLabel?: string;
  keyPrefix?: string;
  keyUrl?: string;
  keyUrlLabel?: string;
  keyNote?: string;
  hasSession?: boolean;
  models?: Array<{ id: string; name: string; tier: string }>;
  currentModel?: string;
}

type Mode = "api_key" | "cookies";

// ─── Login Guide Dialog ──────────────────────────────────────────────────────

interface LoginGuideProps {
  ai: AiInfo;
  onClose: () => void;
  onSuccess: () => void;
}

function LoginGuide({ ai, onClose, onSuccess }: LoginGuideProps) {
  const isApiKeyOnly = ai.authMode === "api_key";
  const isCookiesOnly = ai.authMode === "cookies";
  const isCloudflareBlocked = ai.authMode === "api_key_or_cookies";

  const defaultToApiKey = isApiKeyOnly || isCloudflareBlocked;
  const [useApiKey, setUseApiKey] = useState(defaultToApiKey);
  const mode: Mode = useApiKey ? "api_key" : "cookies";

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-[#0d0d12] border border-[#1e1e2e] rounded-2xl w-full max-w-lg shadow-[0_24px_80px_rgba(0,0,0,0.8)] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#131318]">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary/15 text-primary flex items-center justify-center text-sm font-bold shrink-0">
              {ai.name[0]}
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Connect {ai.name}</p>
              <p className="text-[10px] text-[#52526e]">{ai.url}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center rounded-xl text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors"
          >
            <X size={15} />
          </button>
        </div>

        {/* Mode toggle */}
        {isCloudflareBlocked && !isApiKeyOnly && !isCookiesOnly && (
          <div className="px-5 pt-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-[#111118] border border-[#1e1e2e]">
              <div className="flex items-center gap-3">
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${useApiKey ? "bg-primary/15 text-primary" : "bg-[#1a1a24] text-[#52526e]"}`}>
                  {useApiKey ? <Key size={13} /> : <Cookie size={13} />}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {useApiKey ? "API Key" : "Browser Cookies"}
                  </p>
                  <p className="text-[10px] text-[#52526e]">
                    {useApiKey ? "Recommended — bypasses Cloudflare" : "May not work from cloud servers"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-[#52526e]">
                <span className={useApiKey ? "text-[#52526e]" : "text-foreground"}>Cookies</span>
                <Switch checked={useApiKey} onCheckedChange={setUseApiKey} />
                <span className={useApiKey ? "text-foreground font-medium" : "text-[#52526e]"}>API Key</span>
              </div>
            </div>
          </div>
        )}

        {/* Form content */}
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

  const alreadySaved = !!ai.hasSession;

  const handleSave = async () => {
    if (!apiKey.trim()) {
      if (alreadySaved) { onClose(); return; }
      return;
    }
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

  const label = ai.keyLabel ?? `${ai.name} API Key`;
  const placeholder = ai.keyPrefix ? `${ai.keyPrefix}...` : "Paste your API key...";
  const note = ai.keyNote ?? `Enter your ${ai.name} API key to connect.`;

  return (
    <div className="space-y-4">
      {alreadySaved && (
        <div className="bg-emerald-500/10 border border-emerald-500/25 rounded-xl p-3 text-xs flex items-start gap-2">
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-emerald-400">API key saved &amp; persisted</p>
            <p className="text-[#52526e] mt-0.5">Your key is stored and will survive server restarts. Enter a new key below only if you want to replace it.</p>
          </div>
        </div>
      )}

      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 text-xs text-[#52526e] space-y-1">
        <p className="font-medium text-foreground flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-primary" />
          {ai.authMode === "api_key_or_cookies" ? "Why API key?" : "API Key"}
        </p>
        <p>{note}</p>
      </div>

      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">{label}</label>
        <input
          type="password"
          value={apiKey}
          onChange={e => { setApiKey(e.target.value); setError(null); }}
          onKeyDown={e => e.key === "Enter" && handleSave()}
          placeholder={alreadySaved ? "Leave blank to keep saved key, or paste new key…" : placeholder}
          className="w-full bg-[#111118] border border-[#1e1e2e] rounded-xl px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:border-primary/50 transition-colors"
          autoFocus
        />
        {ai.keyUrl && ai.keyUrlLabel && (
          <a
            href={ai.keyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors"
          >
            <ExternalLink size={11} /> {ai.keyUrlLabel}
          </a>
        )}
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        {!alreadySaved && (
          <button
            onClick={onClose}
            className="flex-1 py-2.5 rounded-xl border border-[#1e1e2e] text-[#52526e] hover:text-foreground hover:bg-[#111118] text-sm transition-colors"
          >
            Cancel
          </button>
        )}
        <button
          onClick={handleSave}
          disabled={(!alreadySaved && !apiKey.trim()) || loading}
          className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground text-sm font-medium transition-colors flex items-center justify-center gap-2"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <Key size={14} />}
          {alreadySaved && !apiKey.trim() ? "Done" : "Save API Key"}
        </button>
      </div>
    </div>
  );
}

// ─── Cookie Form ──────────────────────────────────────────────────────────────

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
        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/25 rounded-xl px-3 py-2.5 text-xs text-amber-400">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <p>
            <strong>Note:</strong> {ai.name} uses Cloudflare protection that blocks cloud server IPs.
            Cookie sessions likely won't work — <strong>API Key mode is recommended</strong>.
          </p>
        </div>
      )}

      {/* Step indicators */}
      <div className="flex items-center gap-0">
        {([1, 2, 3] as const).map((s, i) => (
          <div key={s} className="flex items-center gap-0 flex-1">
            <button
              onClick={() => s < step && setStep(s)}
              className={`flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold transition-colors flex-shrink-0 ${
                step === s
                  ? "bg-primary text-primary-foreground"
                  : step > s
                  ? "bg-emerald-500 text-white"
                  : "bg-[#1a1a24] text-[#52526e]"
              }`}
            >
              {step > s ? <CheckCircle2 size={13} /> : s}
            </button>
            {i < 2 && (
              <div className={`flex-1 h-px mx-1 ${step > s + 1 ? "bg-emerald-500" : step > s ? "bg-primary/50" : "bg-[#1e1e2e]"}`} />
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">Log in to {ai.name}</p>
            <p className="text-[#52526e] text-sm">Open the site in your browser and sign in.</p>
          </div>
          <a
            href={ai.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm transition-colors"
          >
            <ExternalLink size={15} />
            Open {ai.name}
          </a>
          <div className="bg-[#111118] rounded-xl p-3 text-xs text-[#52526e] space-y-1">
            <p>• Log in with your {ai.name} account</p>
            <p>• Complete any 2FA or verification steps</p>
            <p>• Once on the main chat page, come back here</p>
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full py-2.5 rounded-xl border border-primary/40 text-primary hover:bg-primary/10 text-sm font-medium transition-colors"
          >
            I'm logged in → Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">Export your cookies</p>
            <p className="text-[#52526e] text-sm">Use Cookie Editor to copy your session cookies as JSON.</p>
          </div>
          <div className="bg-[#111118] rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">1. Install Cookie Editor (free, open-source)</p>
            <div className="flex gap-2">
              <a href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                 target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a24] hover:bg-[#1e1e2e] text-xs text-foreground transition-colors border border-[#1e1e2e]">
                <ExternalLink size={11} /> Chrome
              </a>
              <a href="https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/"
                 target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#1a1a24] hover:bg-[#1e1e2e] text-xs text-foreground transition-colors border border-[#1e1e2e]">
                <ExternalLink size={11} /> Firefox
              </a>
            </div>
          </div>
          <div className="bg-[#111118] rounded-xl p-3 space-y-1.5 text-xs text-[#52526e]">
            <p className="text-foreground font-medium">2. Export your cookies</p>
            <p>• Go to <strong className="text-foreground">{ai.url}</strong></p>
            <p>• Click <strong className="text-foreground">Cookie Editor</strong> in your toolbar</p>
            <p>• Click <strong className="text-foreground">Export → Export as JSON</strong></p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 rounded-xl border border-[#1e1e2e] text-[#52526e] hover:text-foreground hover:bg-[#111118] text-sm transition-colors">
              ← Back
            </button>
            <button onClick={() => setStep(3)} className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors">
              Exported → Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">Paste & save</p>
            <p className="text-[#52526e] text-sm">Paste the JSON you copied from Cookie Editor.</p>
          </div>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setError(null); }}
            placeholder={`[\n  {"name": "session", "value": "...", ...}\n]`}
            className="w-full h-32 bg-[#111118] border border-[#1e1e2e] rounded-xl p-3 text-xs text-foreground font-mono resize-none focus:outline-none focus:border-primary/50 transition-colors"
            autoFocus
          />
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-xl border border-[#1e1e2e] text-[#52526e] hover:text-foreground hover:bg-[#111118] text-sm transition-colors">
              ← Back
            </button>
            <button
              onClick={handleImport}
              disabled={!jsonText.trim() || loading}
              className="flex-1 py-2.5 rounded-xl bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
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

// ─── Compact AI Row ───────────────────────────────────────────────────────────

function AiRow({
  ai,
  username,
  isVerifying,
  isDeleting,
  onConnect,
  onDelete,
}: {
  ai: AiInfo;
  username?: string;
  isVerifying: boolean;
  isDeleting: boolean;
  onConnect: () => void;
  onDelete: () => void;
}) {
  const hasSession = !!ai.hasSession;
  const isNoAuth = ai.authMode === "none";
  const ready = hasSession || isNoAuth;

  return (
    <div
      className={`group flex items-center gap-2.5 mx-2 px-2.5 py-2 rounded-xl transition-all
        ${ready
          ? "hover:bg-emerald-500/5 cursor-default"
          : "hover:bg-[#111118] cursor-pointer"
        }`}
      onClick={() => !isNoAuth && !hasSession && onConnect()}
    >
      {/* Status dot */}
      <span className={`h-2 w-2 rounded-full shrink-0 ring-2 ring-[#0a0a0c] transition-colors
        ${ready ? "bg-emerald-400" : "bg-[#2a2a3c] group-hover:bg-[#3a3a5c]"}`}
      />

      {/* Avatar letter */}
      <span className={`h-6 w-6 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0
        ${ready ? "bg-emerald-500/15 text-emerald-400" : "bg-[#141420] text-[#52526e]"}`}>
        {ai.name[0]}
      </span>

      {/* Name */}
      <span className={`flex-1 text-[13px] font-medium truncate ${ready ? "text-foreground" : "text-[#a0a0c0]"}`}>
        {ai.name}
      </span>

      {/* Right action */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isNoAuth && (
          <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">
            FREE
          </span>
        )}

        {hasSession && !isNoAuth && (
          <>
            {isVerifying ? (
              <Loader2 className="h-3 w-3 text-[#52526e] animate-spin" />
            ) : username ? (
              <span className="text-[10px] text-[#52526e] truncate max-w-[52px]" title={username}>
                {username}
              </span>
            ) : null}
            <span className="text-[9px] font-bold text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded-md">
              Active
            </span>
            <button
              onClick={e => { e.stopPropagation(); onDelete(); }}
              disabled={isDeleting}
              className="h-5 w-5 flex items-center justify-center rounded-md text-[#3a3a5c] hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
              title="Remove session"
            >
              {isDeleting ? <Loader2 size={10} className="animate-spin" /> : <Trash2 size={10} />}
            </button>
          </>
        )}

        {!isNoAuth && !hasSession && (
          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-md border transition-colors
            ${ai.authMode === "api_key" || ai.authMode === "api_key_or_cookies"
              ? "text-blue-400 bg-blue-500/10 border-blue-500/20 group-hover:bg-blue-500/15"
              : "text-[#52526e] bg-[#141420] border-[#1a1a24] group-hover:bg-[#1a1a24]"
            }`}>
            {ai.authMode === "cookies" ? "Cookies" : "API Key"}
          </span>
        )}

        {hasSession && !isNoAuth && (
          <button
            onClick={e => { e.stopPropagation(); onConnect(); }}
            className="h-5 w-5 flex items-center justify-center rounded-md text-[#3a3a5c] hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
            title="Re-connect"
          >
            <RotateCcw size={10} />
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ icon: Icon, label, color, count }: {
  icon: React.ElementType; label: string; color: string; count: number;
}) {
  return (
    <div className="flex items-center gap-1.5 px-4 pt-3 pb-1.5">
      <Icon className={`h-2.5 w-2.5 ${color}`} />
      <span className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest flex-1">{label}</span>
      <span className="text-[9px] font-bold text-[#2a2a44] bg-[#111118] px-1.5 py-0.5 rounded-md">{count}</span>
    </div>
  );
}

// ─── Main Sessions Page ────────────────────────────────────────────────────────

export function SessionsPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: aisData, isLoading: aisLoading } = useListAis();
  const { data: sessionsData, isLoading: sessionsLoading } = useListSessions();

  const [deletingId, setDeletingId]     = useState<string | null>(null);
  const [loginAi, setLoginAi]           = useState<AiInfo | null>(null);
  const [usernames, setUsernames]       = useState<Record<string, string>>({});
  const [verifyingIds, setVerifyingIds] = useState<Set<string>>(new Set());
  const [search, setSearch]             = useState("");
  const [validating, setValidating]     = useState(false);
  const [validateResults, setValidateResults] = useState<Record<string, any> | null>(null);
  const [showValidation, setShowValidation]   = useState(false);

  const verifySession = useCallback(async (aiId: string) => {
    setVerifyingIds(prev => new Set([...prev, aiId]));
    try {
      const res = await fetch(`/api/sessions/verify/${aiId}`);
      const data = await res.json();
      if (data.success && data.username) {
        setUsernames(prev => ({ ...prev, [aiId]: data.username }));
      } else {
        setUsernames(prev => { const n = { ...prev }; delete n[aiId]; return n; });
      }
    } catch { }
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

  const handleValidateModels = async () => {
    setValidating(true);
    setValidateResults(null);
    setShowValidation(true);
    try {
      const res = await fetch("/api/proxy/validate-models", { method: "POST" });
      const data = await res.json();
      setValidateResults(data.results ?? {});
    } catch (e: any) {
      toast({ variant: "destructive", title: "Validation failed", description: e.message });
      setShowValidation(false);
    } finally {
      setValidating(false);
    }
  };

  const handleDelete = async (aiId: string, aiName: string) => {
    setDeletingId(aiId);
    try {
      const res = await fetch(`/api/sessions/${aiId}/delete`, { method: "DELETE" });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Session deleted", description: `${aiName} removed.` });
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
  const ais: AiInfo[] = aisData?.ais ?? [];
  const noAuthCount    = ais.filter(ai => ai.authMode === "none").length;
  const connectedCount = ais.filter(ai => ai.hasSession && ai.authMode !== "none").length;
  const readyCount     = connectedCount + noAuthCount;

  const q = search.toLowerCase();
  const filtered = ais.filter(ai => !q || ai.name.toLowerCase().includes(q));

  const sortOrder: Record<string, number> = { none: 0, api_key: 1, api_key_or_cookies: 2, cookies: 3 };
  const sortedFiltered = [...filtered].sort((a, b) =>
    (sortOrder[a.authMode] ?? 9) - (sortOrder[b.authMode] ?? 9)
  );

  const freeAis   = sortedFiltered.filter(ai => ai.authMode === "none");
  const keyAis    = sortedFiltered.filter(ai => ai.authMode === "api_key" || ai.authMode === "api_key_or_cookies");
  const cookieAis = sortedFiltered.filter(ai => ai.authMode === "cookies");

  const makeRowProps = (ai: AiInfo) => ({
    ai,
    username:    usernames[ai.id],
    isVerifying: verifyingIds.has(ai.id),
    isDeleting:  deletingId === ai.id,
    onConnect:   () => setLoginAi(ai),
    onDelete:    () => handleDelete(ai.id, ai.name),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={18} className="animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#131318] bg-[#080809]">
        <div className="flex items-center gap-1.5 flex-1 min-w-0">
          <span className="text-[11px] font-bold text-[#3a3a5c] uppercase tracking-widest">Providers</span>
        </div>

        {/* Ready chip */}
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md shrink-0
          ${readyCount === ais.length
            ? "text-emerald-400 bg-emerald-500/10 border border-emerald-500/20"
            : "text-amber-400 bg-amber-500/10 border border-amber-500/20"
          }`}>
          {readyCount}/{ais.length} ready
        </span>

        {/* Validate models button */}
        <button
          onClick={showValidation ? () => setShowValidation(false) : handleValidateModels}
          disabled={validating}
          className={`h-6 w-6 flex items-center justify-center rounded-lg transition-colors shrink-0
            ${showValidation
              ? "text-primary bg-primary/15 hover:bg-primary/25"
              : "text-[#3a3a5c] hover:text-foreground hover:bg-[#141420]"
            }`}
          title="Validate model IDs against live provider APIs"
        >
          {validating ? <Loader2 size={12} className="animate-spin" /> : <FlaskConical size={12} />}
        </button>

        <button
          onClick={refreshAll}
          className="h-6 w-6 flex items-center justify-center rounded-lg text-[#3a3a5c] hover:text-foreground hover:bg-[#141420] transition-colors shrink-0"
          title="Refresh"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      {/* ── Model Validation Panel ───────────────────────────────────────── */}
      {showValidation && (
        <div className="shrink-0 border-b border-[#131318] bg-[#080810]">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#0f0f1a]">
            <div className="flex items-center gap-1.5">
              <FlaskConical className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-bold text-[#a0a0c0] uppercase tracking-widest">Model Validation</span>
            </div>
            <button onClick={() => setShowValidation(false)} className="text-[#3a3a5c] hover:text-foreground transition-colors">
              <X size={11} />
            </button>
          </div>

          {validating && (
            <div className="flex items-center gap-2 px-3 py-3 text-xs text-[#52526e]">
              <Loader2 size={12} className="animate-spin text-primary" />
              Checking live provider APIs…
            </div>
          )}

          {validateResults && !validating && (
            <ScrollArea className="max-h-52">
              <div className="p-2 space-y-1">
                {Object.entries(validateResults).map(([aiId, result]: [string, any]) => {
                  if (result.status === "no_key") return null;
                  const aiName = ais.find(a => a.id === aiId)?.name ?? aiId;
                  const hasStale = result.stale?.length > 0;
                  const hasNew = result.live_only?.length > 0;
                  const isError = result.status === "error";
                  const isSkipped = result.status === "skipped";

                  return (
                    <div key={aiId} className={`rounded-lg border px-2.5 py-2 text-[10px] ${
                      isError ? "border-red-500/20 bg-red-500/5"
                      : hasStale ? "border-amber-500/20 bg-amber-500/5"
                      : "border-[#1a1a24] bg-[#111118]"
                    }`}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className={`font-semibold ${isError ? "text-red-400" : hasStale ? "text-amber-400" : "text-foreground"}`}>
                          {aiName}
                        </span>
                        {isError && <XCircle className="h-2.5 w-2.5 text-red-400" />}
                        {!isError && !hasStale && !isSkipped && <CheckCircle2 className="h-2.5 w-2.5 text-emerald-400" />}
                        {hasStale && <AlertTriangle className="h-2.5 w-2.5 text-amber-400" />}
                      </div>

                      {isError && (
                        <p className="text-red-400/80">{result.error}</p>
                      )}
                      {isSkipped && (
                        <p className="text-[#52526e]">No models endpoint available</p>
                      )}
                      {!isError && !isSkipped && (
                        <div className="space-y-0.5">
                          {hasStale && (
                            <div className="flex flex-wrap gap-1 items-center">
                              <span className="text-amber-500 font-medium">Stale:</span>
                              {result.stale.map((id: string) => (
                                <span key={id} className="font-mono text-[9px] bg-amber-500/10 text-amber-400 border border-amber-500/20 px-1 py-0.5 rounded">{id}</span>
                              ))}
                            </div>
                          )}
                          {hasNew && (
                            <div className="flex flex-wrap gap-1 items-center mt-0.5">
                              <span className="text-blue-400 font-medium">New available:</span>
                              {result.live_only.slice(0, 5).map((id: string) => (
                                <span key={id} className="font-mono text-[9px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-1 py-0.5 rounded">{id}</span>
                              ))}
                              {result.live_only.length > 5 && (
                                <span className="text-[#52526e]">+{result.live_only.length - 5} more</span>
                              )}
                            </div>
                          )}
                          {!hasStale && !hasNew && (
                            <p className="text-emerald-400/70">All {result.valid?.length ?? 0} model IDs are current</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {Object.values(validateResults).every((r: any) => r.status === "no_key") && (
                  <p className="text-center text-[#52526e] py-3 text-[10px]">
                    No API keys stored yet — add a key to validate its models
                  </p>
                )}
              </div>
            </ScrollArea>
          )}
        </div>
      )}

      {/* ── Search ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 py-2 border-b border-[#131318]">
        <div className="flex items-center gap-2 bg-[#111118] border border-[#1a1a24] rounded-xl px-2.5 py-1.5
          focus-within:border-primary/30 transition-colors">
          <Search className="h-3 w-3 text-[#3a3a5c] shrink-0" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search providers…"
            className="flex-1 bg-transparent text-[12px] text-foreground placeholder:text-[#3a3a5c] focus:outline-none"
          />
          {search && (
            <button onClick={() => setSearch("")} className="text-[#3a3a5c] hover:text-foreground transition-colors">
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      {/* ── Provider list ───────────────────────────────────────────────── */}
      <ScrollArea className="flex-1">
        <div className="pb-4">

          {/* Empty search result */}
          {sortedFiltered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <ShieldAlert className="h-6 w-6 text-[#3a3a5c] mb-2" />
              <p className="text-sm text-[#52526e]">No providers match "{search}"</p>
            </div>
          )}

          {/* Always Free */}
          {freeAis.length > 0 && (
            <div>
              <SectionHeader icon={Zap} label="Always Free" color="text-emerald-400" count={freeAis.length} />
              {freeAis.map(ai => <AiRow key={ai.id} {...makeRowProps(ai)} />)}
            </div>
          )}

          {/* API Key */}
          {keyAis.length > 0 && (
            <div className="mt-1">
              <SectionHeader icon={Key} label="API Key" color="text-blue-400" count={keyAis.length} />
              {keyAis.map(ai => <AiRow key={ai.id} {...makeRowProps(ai)} />)}
            </div>
          )}

          {/* Cookies */}
          {cookieAis.length > 0 && (
            <div className="mt-1">
              <SectionHeader icon={Cookie} label="Cookies" color="text-[#52526e]" count={cookieAis.length} />
              {cookieAis.map(ai => <AiRow key={ai.id} {...makeRowProps(ai)} />)}
            </div>
          )}

          {/* Tips footer */}
          <div className="mx-3 mt-4 p-3 rounded-xl bg-[#111118] border border-[#1a1a24]">
            <p className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest mb-2">Quick start</p>
            <div className="space-y-1.5 text-[10px] text-[#52526e] leading-relaxed">
              <div className="flex items-start gap-1.5">
                <ShieldCheck className="h-2.5 w-2.5 text-emerald-400 mt-0.5 shrink-0" />
                <span><strong className="text-[#a0a0c0]">Pollinations</strong> — always free, no setup</span>
              </div>
              <div className="flex items-start gap-1.5">
                <Key className="h-2.5 w-2.5 text-blue-400 mt-0.5 shrink-0" />
                <span><strong className="text-[#a0a0c0]">Groq, Gemini, OpenRouter</strong> — free API keys</span>
              </div>
              <div className="flex items-start gap-1.5">
                <Key className="h-2.5 w-2.5 text-amber-400 mt-0.5 shrink-0" />
                <span><strong className="text-[#a0a0c0]">ChatGPT, Claude</strong> — official API key needed</span>
              </div>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* ── Connect dialog ──────────────────────────────────────────────── */}
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
