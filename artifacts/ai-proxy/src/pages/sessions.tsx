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
  AlertTriangle, Zap,
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
    <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-center justify-center z-50 p-4">
      <div className="bg-background border border-border rounded-2xl w-full max-w-lg shadow-2xl flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-lg bg-primary/15 text-primary flex items-center justify-center text-sm font-bold">
              {ai.name[0]}
            </div>
            <span className="font-semibold text-foreground">Connect {ai.name}</span>
          </div>
          <button onClick={onClose} className="h-8 w-8 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Mode toggle — only for ChatGPT/Claude (both options available) */}
        {isCloudflareBlocked && !isApiKeyOnly && !isCookiesOnly && (
          <div className="px-5 pt-4">
            <div className="flex items-center justify-between p-3 rounded-xl bg-muted/50 border border-border">
              <div className="flex items-center gap-3">
                <div className={`h-7 w-7 rounded-lg flex items-center justify-center ${useApiKey ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`}>
                  {useApiKey ? <Key size={13} /> : <Cookie size={13} />}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    {useApiKey ? "API Key" : "Browser Cookies"}
                  </p>
                  <p className="text-[10px] text-muted-foreground">
                    {useApiKey ? "Recommended — bypasses Cloudflare" : "May not work from cloud servers"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className={useApiKey ? "text-muted-foreground" : "text-foreground"}>Cookies</span>
                <Switch checked={useApiKey} onCheckedChange={setUseApiKey} />
                <span className={useApiKey ? "text-foreground font-medium" : "text-muted-foreground"}>API Key</span>
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

  const label = ai.keyLabel ?? `${ai.name} API Key`;
  const placeholder = ai.keyPrefix ? `${ai.keyPrefix}...` : "Paste your API key...";
  const note = ai.keyNote ?? `Enter your ${ai.name} API key to connect.`;

  return (
    <div className="space-y-4">
      <div className="bg-primary/5 border border-primary/15 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
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
          placeholder={placeholder}
          className="w-full bg-muted border border-border rounded-xl px-3 py-2.5 text-sm text-foreground font-mono focus:outline-none focus:border-primary transition-colors"
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
        <button
          onClick={onClose}
          className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          disabled={!apiKey.trim() || loading}
          className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed text-primary-foreground text-sm font-medium transition-colors flex items-center justify-center gap-2"
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
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {step > s ? <CheckCircle2 size={13} /> : s}
            </button>
            {i < 2 && (
              <div className={`flex-1 h-px mx-1 ${step > s + 1 ? "bg-emerald-500" : step > s ? "bg-primary/50" : "bg-border"}`} />
            )}
          </div>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">Log in to {ai.name}</p>
            <p className="text-muted-foreground text-sm">Open the site in your browser and sign in.</p>
          </div>
          <a
            href={ai.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-medium text-sm transition-colors"
          >
            <ExternalLink size={15} />
            Open {ai.name} in a new tab
          </a>
          <div className="bg-muted/50 rounded-xl p-3 text-xs text-muted-foreground space-y-1">
            <p>• Log in with your {ai.name} account as you normally would</p>
            <p>• Complete any 2FA or verification steps</p>
            <p>• Once on the main chat page, come back here and continue</p>
          </div>
          <button
            onClick={() => setStep(2)}
            className="w-full py-2.5 rounded-xl border border-primary/50 text-primary hover:bg-primary/10 text-sm font-medium transition-colors"
          >
            I'm logged in → Next
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">Export your cookies</p>
            <p className="text-muted-foreground text-sm">Use Cookie Editor to copy your session cookies as JSON.</p>
          </div>
          <div className="bg-muted/50 rounded-xl p-3 space-y-2">
            <p className="text-xs font-medium text-foreground">1. Install Cookie Editor (free, open-source)</p>
            <div className="flex gap-2">
              <a href="https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm"
                 target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs text-foreground transition-colors border border-border">
                <ExternalLink size={11} /> Chrome
              </a>
              <a href="https://addons.mozilla.org/en-US/firefox/addon/cookie-editor/"
                 target="_blank" rel="noopener noreferrer"
                 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-muted hover:bg-muted/80 text-xs text-foreground transition-colors border border-border">
                <ExternalLink size={11} /> Firefox
              </a>
            </div>
          </div>
          <div className="bg-muted/50 rounded-xl p-3 space-y-1.5 text-xs text-muted-foreground">
            <p className="text-foreground font-medium">2. Export your cookies</p>
            <p>• Go to <strong className="text-foreground">{ai.url}</strong></p>
            <p>• Click the <strong className="text-foreground">Cookie Editor</strong> icon in your toolbar</p>
            <p>• Click <strong className="text-foreground">Export → Export as JSON</strong> — copies to clipboard</p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setStep(1)} className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors">
              ← Back
            </button>
            <button onClick={() => setStep(3)} className="flex-1 py-2.5 rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-colors">
              Cookies exported → Next
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-3">
          <div>
            <p className="text-foreground font-medium mb-1">Paste & save</p>
            <p className="text-muted-foreground text-sm">Paste the JSON you copied from Cookie Editor.</p>
          </div>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); setError(null); }}
            placeholder={`[\n  {"name": "session", "value": "...", ...}\n]`}
            className="w-full h-36 bg-muted border border-border rounded-xl p-3 text-xs text-foreground font-mono resize-none focus:outline-none focus:border-primary transition-colors"
            autoFocus
          />
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-3 py-2 text-xs text-red-400">
              {error}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => setStep(2)} className="flex-1 py-2.5 rounded-xl border border-border text-muted-foreground hover:text-foreground hover:bg-muted text-sm transition-colors">
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

// ─── AI Card ─────────────────────────────────────────────────────────────────

function AiCard({
  ai,
  username,
  authMode,
  isVerifying,
  isDeleting,
  onConnect,
  onDelete,
  onVerify,
}: {
  ai: AiInfo;
  username?: string;
  authMode?: string;
  isVerifying: boolean;
  isDeleting: boolean;
  onConnect: () => void;
  onDelete: () => void;
  onVerify: () => void;
}) {
  const hasSession = !!ai.hasSession;
  const isNoAuth = ai.authMode === "none";
  const isApiKeyOnly = ai.authMode === "api_key";
  const isCloudflareBlocked = ai.authMode === "api_key_or_cookies";

  return (
    <div className={`rounded-2xl border transition-all ${
      hasSession
        ? "border-emerald-500/25 bg-emerald-500/5"
        : isNoAuth
          ? "border-emerald-500/20 bg-emerald-500/5"
          : "border-border bg-card"
    }`}>
      <div className="p-5">
        <div className="flex items-start justify-between gap-3">
          {/* Avatar + info */}
          <div className="flex items-start gap-3 flex-1 min-w-0">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0 ${
              hasSession || isNoAuth
                ? "bg-emerald-500/20 text-emerald-400"
                : "bg-muted text-muted-foreground"
            }`}>
              {ai.name[0]}
            </div>

            <div className="flex-1 min-w-0">
              {/* Name + badges */}
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">{ai.name}</span>

                {(hasSession || isNoAuth) ? (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/15 px-2 py-0.5 rounded-full border border-emerald-500/20">
                    <ShieldCheck size={9} /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                    <ShieldAlert size={9} /> Not connected
                  </span>
                )}

                {isNoAuth && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                    <Zap size={9} /> Free · No setup
                  </span>
                )}
                {isApiKeyOnly && !hasSession && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded-full">
                    <Key size={9} /> API key
                  </span>
                )}
                {isCloudflareBlocked && !hasSession && (
                  <span className="flex items-center gap-1 text-[10px] font-medium text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded-full">
                    <Key size={9} /> API key recommended
                  </span>
                )}
              </div>

              {/* URL */}
              <p className="text-xs text-muted-foreground mt-0.5 truncate">{ai.url}</p>

              {/* Key note */}
              {!hasSession && !isNoAuth && ai.keyNote && (
                <p className="text-[10px] text-muted-foreground/70 mt-1 leading-relaxed line-clamp-2">{ai.keyNote}</p>
              )}

              {/* Session info */}
              {hasSession && (
                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                  {authMode === "api_key" && (
                    <span className="flex items-center gap-1 text-[10px] text-blue-400 bg-blue-500/10 px-1.5 py-0.5 rounded-full">
                      <Key size={9} /> API key
                    </span>
                  )}
                  {authMode === "cookies" && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                      <Cookie size={9} /> Cookies
                    </span>
                  )}
                  {isVerifying ? (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 size={10} className="animate-spin" /> Verifying…
                    </span>
                  ) : username ? (
                    <span className="flex items-center gap-1 text-xs text-emerald-400">
                      <UserCircle2 size={11} /> {username}
                    </span>
                  ) : (
                    <button onClick={onVerify} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
                      <RefreshCw size={10} /> Verify
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Delete button */}
          {hasSession && !isNoAuth && (
            <button
              onClick={onDelete}
              disabled={isDeleting}
              className="h-8 w-8 flex items-center justify-center shrink-0 rounded-xl text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Remove session"
            >
              {isDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
            </button>
          )}
        </div>

        {/* Connect/Reconnect button */}
        {!isNoAuth && (
          <div className="mt-4">
            <button
              onClick={onConnect}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                hasSession
                  ? "bg-muted hover:bg-muted/80 text-muted-foreground hover:text-foreground border border-border"
                  : "bg-primary hover:bg-primary/90 text-primary-foreground"
              }`}
            >
              {hasSession ? <RotateCcw size={13} /> : <LogIn size={13} />}
              {hasSession ? "Re-connect" : "Connect"}
            </button>
          </div>
        )}
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
  const [loginAi, setLoginAi] = useState<AiInfo | null>(null);
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
  const ais: AiInfo[] = aisData?.ais ?? [];
  const connectedCount = ais.filter((ai) => ai.hasSession).length;
  const noAuthCount = ais.filter((ai) => ai.authMode === "none").length;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 size={24} className="animate-spin text-primary" />
      </div>
    );
  }

  // Group AIs: no-auth first, then api_key free tier, then api_key_or_cookies, then cookies-only
  const sortOrder: Record<string, number> = { none: 0, api_key: 1, api_key_or_cookies: 2, cookies: 3 };
  const sortedAis = [...ais].sort((a, b) =>
    (sortOrder[a.authMode] ?? 9) - (sortOrder[b.authMode] ?? 9)
  );

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Page header */}
      <div className="flex-shrink-0 border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-foreground">Sessions</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {noAuthCount} always-free · {ais.length - noAuthCount} with API key or cookies
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground font-medium">
              {connectedCount + noAuthCount}/{ais.length} ready
            </span>
            <button
              onClick={refreshAll}
              className="h-8 w-8 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw size={15} />
            </button>
          </div>
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-6 space-y-4 max-w-2xl">

          {/* How to connect banner */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2.5">
            <p className="text-sm font-semibold text-foreground">Free AI options</p>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={12} className="mt-0.5 text-emerald-400 shrink-0" />
                <span><strong className="text-emerald-400">Pollinations AI</strong> — Always free, no setup. GPT-4o, Claude 3.7, DeepSeek, Mistral.</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={12} className="mt-0.5 text-blue-400 shrink-0" />
                <span><strong className="text-blue-300">Groq</strong> — Free API key, ~1,000 req/day. Fastest Llama 3.3 70B inference.</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={12} className="mt-0.5 text-blue-400 shrink-0" />
                <span><strong className="text-blue-300">Google Gemini</strong> — Free API key from AI Studio. 1,500 req/day on Flash.</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={12} className="mt-0.5 text-blue-400 shrink-0" />
                <span><strong className="text-blue-300">OpenRouter</strong> — Free API key + many models with free quota (Llama 4, DeepSeek R1).</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={12} className="mt-0.5 text-blue-400 shrink-0" />
                <span><strong className="text-blue-300">Cerebras</strong> — Free API key. World's fastest inference (tokens/sec).</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={12} className="mt-0.5 text-blue-400 shrink-0" />
                <span><strong className="text-blue-300">Mistral, Cohere, Together, DeepSeek</strong> — Free tiers or very low cost.</span>
              </div>
              <div className="flex items-start gap-2">
                <Key size={12} className="mt-0.5 text-amber-400 shrink-0" />
                <span><strong className="text-amber-300">ChatGPT & Claude</strong> — Official API key required (Cloudflare blocks cookies).</span>
              </div>
              <div className="flex items-start gap-2">
                <Cookie size={12} className="mt-0.5 text-muted-foreground shrink-0" />
                <span><strong className="text-foreground">Grok</strong> — Export cookies from grok.com using Cookie Editor and paste JSON here.</span>
              </div>
            </div>
          </div>

          {/* AI Cards */}
          {sortedAis.map((ai) => (
            <AiCard
              key={ai.id}
              ai={ai}
              username={usernames[ai.id]}
              authMode={authModes[ai.id]}
              isVerifying={verifyingIds.has(ai.id)}
              isDeleting={deletingId === ai.id}
              onConnect={() => setLoginAi(ai)}
              onDelete={() => handleDelete(ai.id, ai.name)}
              onVerify={() => verifySession(ai.id)}
            />
          ))}
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
