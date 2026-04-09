import { useState } from "react";
import {
  useListAis, getListAisQueryKey,
  useListSessions, getListSessionsQueryKey,
  useDeleteSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldCheck, ShieldAlert, Trash2, Loader2,
  RefreshCw, Zap, X, ExternalLink, Eye, EyeOff,
  Key, CheckCircle2, AlertCircle,
} from "lucide-react";

// ─── API Key Entry Dialog ─────────────────────────────────────────────────────

interface KeyDialogProps {
  ai: { id: string; name: string; url: string; keyPrefix?: string; apiDocs?: string };
  onClose: () => void;
  onSuccess: () => void;
}

function KeyDialog({ ai, onClose, onSuccess }: KeyDialogProps) {
  const { toast } = useToast();
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] = useState<boolean | null>(null);

  const handleSave = async () => {
    if (!key.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/set-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, apiKey: key.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "API key saved", description: `${ai.name} is now connected.` });
        onSuccess();
        onClose();
      } else {
        toast({ variant: "destructive", title: "Failed to save key", description: data.message });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async () => {
    if (!key.trim()) return;
    setVerifying(true);
    setVerified(null);
    try {
      await fetch("/api/sessions/set-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, apiKey: key.trim() }),
      });
      const res = await fetch(`/api/sessions/verify/${ai.id}`, { method: "POST" });
      const data = await res.json();
      setVerified(data.success);
      if (data.success) {
        toast({ title: "Key verified!", description: `${ai.name} responded successfully.` });
        onSuccess();
      } else {
        toast({ variant: "destructive", title: "Verification failed", description: data.message });
      }
    } catch (e: any) {
      setVerified(false);
      toast({ variant: "destructive", title: "Error", description: e.message });
    } finally {
      setVerifying(false);
    }
  };

  const docsUrl = ai.apiDocs || ai.url;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mb-0.5">API Key</p>
            <h2 className="text-base font-bold text-foreground">Connect {ai.name}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <div className="px-5 py-5 space-y-4">
          <div className="flex items-start gap-3 bg-primary/8 border border-primary/20 rounded-2xl px-4 py-3 text-xs">
            <Key className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p className="text-muted-foreground">
              Get your API key from{" "}
              <a href={docsUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                {docsUrl.replace(/^https?:\/\//, "")} <ExternalLink className="h-2.5 w-2.5" />
              </a>
              . Keys are stored locally and never sent anywhere except the official {ai.name} API.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              {ai.name} API Key
            </label>
            <div className="relative">
              <input
                type={show ? "text" : "password"}
                value={key}
                onChange={e => { setKey(e.target.value); setVerified(null); }}
                placeholder={ai.keyPrefix ? `${ai.keyPrefix}…` : "Paste your API key here"}
                className="w-full bg-muted border border-border rounded-xl px-4 py-3 pr-10 text-sm text-foreground placeholder:text-muted-foreground font-mono focus:outline-none focus:ring-2 focus:ring-primary/40"
                onKeyDown={e => { if (e.key === "Enter") handleSave(); }}
              />
              <button
                onClick={() => setShow(!show)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {verified === true && (
              <div className="flex items-center gap-1.5 text-xs text-emerald-500">
                <CheckCircle2 className="h-3.5 w-3.5" /> Key verified and working
              </div>
            )}
            {verified === false && (
              <div className="flex items-center gap-1.5 text-xs text-red-400">
                <AlertCircle className="h-3.5 w-3.5" /> Key is invalid or has no access
              </div>
            )}
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={handleVerify}
              disabled={!key.trim() || verifying || loading}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted hover:bg-muted/70 text-sm font-medium text-foreground transition-colors disabled:opacity-50"
            >
              {verifying ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
              Test Key
            </button>
            <button
              onClick={handleSave}
              disabled={!key.trim() || loading || verifying}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              Save Key
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── AI icon colours ──────────────────────────────────────────────────────────

const AI_ICONS: Record<string, { label: string; color: string }> = {
  chatgpt:  { label: "O",  color: "bg-emerald-500/15 text-emerald-400" },
  grok:     { label: "X",  color: "bg-blue-500/15 text-blue-400" },
  claude:   { label: "C",  color: "bg-orange-500/15 text-orange-400" },
};

// ─── Main Sessions / API Keys page ───────────────────────────────────────────

export function Sessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [addingAi, setAddingAi] = useState<{ id: string; name: string; url: string; keyPrefix?: string; apiDocs?: string } | null>(null);

  const { data: aisData, isLoading: isLoadingAis, refetch: refetchAis } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const { data: _sd, isLoading: isLoadingSessions, refetch: refetchSessions } = useListSessions({ query: { queryKey: getListSessionsQueryKey() } });
  const deleteSession = useDeleteSession();

  const ais = aisData?.ais ?? [];

  const handleRemove = async (aiId: string) => {
    try {
      await deleteSession.mutateAsync({ aiId });
      queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      toast({ title: "API key removed" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
  };

  const isLoading = isLoadingAis || isLoadingSessions;

  return (
    <>
      {addingAi && (
        <KeyDialog
          ai={addingAi}
          onClose={() => setAddingAi(null)}
          onSuccess={invalidate}
        />
      )}

      <ScrollArea className="h-full">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 pb-24 sm:pb-8">

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">API Keys</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Connect each AI with its official API key — no browser sessions needed.
              </p>
            </div>
            <button
              onClick={() => { refetchAis(); refetchSessions(); }}
              className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-start gap-3 bg-primary/8 border border-primary/20 rounded-2xl px-4 py-3.5">
            <Key className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-foreground mb-0.5">Official APIs — reliable & fast</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Each AI now uses its official REST API — no Cloudflare issues, no browser automation.
                Just paste your API key below to get started. Keys are stored locally.
              </p>
            </div>
          </div>

          {isLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : ais.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No AI services found. Check that the backend is running.
            </div>
          ) : (
            <div className="space-y-3">
              {ais.map((ai) => {
                const active = ai.hasSession;
                const busy = deleteSession.isPending;
                const icon = AI_ICONS[ai.id] ?? { label: ai.name.charAt(0), color: "bg-muted text-muted-foreground" };

                return (
                  <div key={ai.id} className={`rounded-2xl border transition-all bg-card ${active ? "border-emerald-500/30" : "border-border"}`}>
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 text-sm font-bold ${active ? icon.color : "bg-muted text-muted-foreground"}`}>
                        {icon.label}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{ai.name}</p>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${active ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
                            {active
                              ? <><ShieldCheck className="h-2.5 w-2.5" /> Connected</>
                              : <><ShieldAlert className="h-2.5 w-2.5" /> No API key</>
                            }
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">
                          {active ? "API key configured" : "Add your API key to enable"}
                        </p>
                      </div>

                      <div className="shrink-0 flex gap-2">
                        <button
                          onClick={() => setAddingAi({
                            id: ai.id,
                            name: ai.name,
                            url: ai.url,
                            keyPrefix: (ai as any).keyPrefix,
                            apiDocs: (ai as any).apiDocs,
                          })}
                          disabled={busy}
                          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors disabled:opacity-50 ${
                            active
                              ? "text-muted-foreground bg-muted hover:bg-muted/70 border border-border"
                              : "text-primary-foreground bg-primary hover:bg-primary/90 border border-primary/20"
                          }`}
                        >
                          <Key className="h-3.5 w-3.5" />
                          {active ? "Update" : "Add Key"}
                        </button>
                        {active && (
                          <button
                            onClick={() => handleRemove(ai.id)}
                            disabled={busy}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
                          >
                            {deleteSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                            Remove
                          </button>
                        )}
                      </div>
                    </div>

                    {active && (
                      <div className="mx-5 mb-4 flex items-center gap-2 bg-emerald-500/8 border border-emerald-500/15 rounded-xl px-3 py-2.5 text-xs text-emerald-500">
                        <Zap className="h-3 w-3 shrink-0" />
                        Ready — prompts are routed directly via the official {ai.name} API
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              { name: "OpenAI", url: "https://platform.openai.com/api-keys", desc: "ChatGPT keys" },
              { name: "xAI",    url: "https://console.x.ai",                  desc: "Grok keys" },
              { name: "Anthropic", url: "https://console.anthropic.com/settings/keys", desc: "Claude keys" },
            ].map(p => (
              <a
                key={p.name}
                href={p.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2.5 px-4 py-3 rounded-2xl bg-muted/40 hover:bg-muted border border-border text-xs text-muted-foreground hover:text-foreground transition-colors group"
              >
                <ExternalLink className="h-3.5 w-3.5 shrink-0 text-primary group-hover:text-primary" />
                <div>
                  <p className="font-semibold text-foreground">{p.name}</p>
                  <p>{p.desc}</p>
                </div>
              </a>
            ))}
          </div>

          <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-muted/40 border border-border text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p><strong className="text-foreground">Tip:</strong> You can also set keys as environment variables: <code className="text-foreground">OPENAI_API_KEY</code>, <code className="text-foreground">XAI_API_KEY</code>, <code className="text-foreground">ANTHROPIC_API_KEY</code>.</p>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}
