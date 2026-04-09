import { useState } from "react";
import {
  useListAis, getListAisQueryKey,
  useListSessions, getListSessionsQueryKey,
  useCreateSession, useDeleteSession,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ShieldCheck, ShieldAlert, LogIn, Trash2,
  Loader2, MonitorPlay, RefreshCw, Zap,
  X, ClipboardPaste, ExternalLink, ChevronRight,
} from "lucide-react";

// ─── Manual import dialog ────────────────────────────────────────────────────

interface ImportSheetProps {
  ai: { id: string; name: string; url: string };
  onClose: () => void;
  onSuccess: () => void;
}

const JS_SNIPPET = `(function(){
  const s={cookies:[],origins:[{origin:location.origin,localStorage:Object.keys(localStorage).map(k=>({name:k,value:localStorage.getItem(k)}))}]};
  navigator.clipboard.writeText(JSON.stringify(s,null,2)).then(()=>alert('Copied to clipboard!')).catch(()=>{const t=prompt('Copy this:',JSON.stringify(s));});
})();`;

function ImportSheet({ ai, onClose, onSuccess }: ImportSheetProps) {
  const { toast } = useToast();
  const [pasted, setPasted] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(1);

  const handleImport = async () => {
    if (!pasted.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/sessions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiId: ai.id, stateJson: pasted.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ title: "Session imported", description: `You are now logged in to ${ai.name}.` });
        onSuccess();
        onClose();
      } else {
        toast({ variant: "destructive", title: "Import failed", description: data.message });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Network error", description: e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-widest mb-0.5">Manual Login</p>
            <h2 className="text-base font-bold text-foreground">Connect {ai.name}</h2>
          </div>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        <ScrollArea className="max-h-[70vh]">
          <div className="px-5 py-4 space-y-4">
            {/* Why */}
            <div className="flex items-start gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-2xl px-4 py-3 text-xs text-amber-400">
              <MonitorPlay className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                <strong>Why manual?</strong> Vesper runs on a cloud server — it can't open a browser on your device. Instead, you'll copy session data from your own browser and paste it here.
              </p>
            </div>

            {/* Steps */}
            <div className="space-y-3">
              {/* Step 1 */}
              <button
                onClick={() => setStep(step === 1 ? 0 : 1)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${step === 1 ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
              >
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${step === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>1</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Open {ai.name} and log in</p>
                  {step === 1 && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-muted-foreground">Tap the link below to open {ai.name} in a new tab, then sign in to your account normally.</p>
                      <a
                        href={ai.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1.5 text-xs text-primary underline"
                      >
                        Open {ai.url} <ExternalLink className="h-3 w-3" />
                      </a>
                      <button
                        onClick={(e) => { e.stopPropagation(); setStep(2); }}
                        className="mt-1 flex items-center gap-1 text-xs text-primary font-medium"
                      >
                        Logged in — next step <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </button>

              {/* Step 2 */}
              <button
                onClick={() => setStep(step === 2 ? 0 : 2)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${step === 2 ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
              >
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Copy session data</p>
                  {step === 2 && (
                    <div className="mt-2 space-y-3">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        On <strong className="text-foreground">desktop</strong>: open DevTools (F12) → Console tab, paste the snippet below and press Enter. It will copy your session data automatically.
                      </p>
                      <div className="relative">
                        <pre className="text-[10px] text-muted-foreground bg-muted rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">{JS_SNIPPET}</pre>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            navigator.clipboard.writeText(JS_SNIPPET).then(() =>
                              toast({ title: "Snippet copied", description: "Paste it in the browser console on the AI website." })
                            );
                          }}
                          className="absolute top-2 right-2 flex items-center gap-1 text-[10px] bg-background border border-border rounded-lg px-2 py-1 text-muted-foreground hover:text-foreground transition-colors"
                        >
                          <ClipboardPaste className="h-3 w-3" /> Copy
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        On <strong className="text-foreground">iPhone/Safari</strong>: install <strong className="text-foreground">Cookie-Editor</strong> from the App Store, open {ai.url}, tap the extension and export cookies as JSON.
                      </p>
                      <button
                        onClick={(e) => { e.stopPropagation(); setStep(3); }}
                        className="flex items-center gap-1 text-xs text-primary font-medium"
                      >
                        Got it, pasting now <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
                </div>
              </button>

              {/* Step 3 */}
              <button
                onClick={() => setStep(step === 3 ? 0 : 3)}
                className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${step === 3 ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}
              >
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${step === 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>3</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Paste the session JSON here</p>
                  {step === 3 && (
                    <div className="mt-2 space-y-2" onClick={(e) => e.stopPropagation()}>
                      <textarea
                        value={pasted}
                        onChange={(e) => setPasted(e.target.value)}
                        placeholder={'{"cookies":[...],"origins":[...]}'}
                        rows={6}
                        className="w-full rounded-xl border border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground p-3 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/40"
                      />
                      <button
                        onClick={handleImport}
                        disabled={!pasted.trim() || loading}
                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                        Save Session
                      </button>
                    </div>
                  )}
                </div>
              </button>
            </div>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}

// ─── Main Sessions page ───────────────────────────────────────────────────────

export function Sessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [importingAi, setImportingAi] = useState<{ id: string; name: string; url: string } | null>(null);

  const { data: aisData, isLoading: isLoadingAis, refetch: refetchAis } = useListAis({
    query: { queryKey: getListAisQueryKey() },
  });
  const { data: _sessionsData, isLoading: isLoadingSessions, refetch: refetchSessions } = useListSessions({
    query: { queryKey: getListSessionsQueryKey() },
  });

  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const isLoading = isLoadingAis || isLoadingSessions;
  const ais = aisData?.ais ?? [];

  const handleCreate = async (aiId: string) => {
    try {
      const result = await createSession.mutateAsync({ data: { aiId } });
      if (result.success) {
        toast({
          title: "Browser opened on server",
          description: "If you're using the desktop Replit environment, log in there. Otherwise use the Import option.",
        });
      }
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to open browser", description: e.message });
    }
  };

  const handleDelete = async (aiId: string) => {
    try {
      await deleteSession.mutateAsync({ aiId });
      queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      toast({ title: "Session removed" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to remove session", description: e.message });
    }
  };

  const handleRefresh = () => {
    refetchAis();
    refetchSessions();
  };

  const handleImportSuccess = () => {
    queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
  };

  return (
    <>
      {importingAi && (
        <ImportSheet
          ai={importingAi}
          onClose={() => setImportingAi(null)}
          onSuccess={handleImportSuccess}
        />
      )}

      <ScrollArea className="h-full">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 pb-24 sm:pb-8">

          {/* Header */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Sessions</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Log in to each AI to start routing your prompts.
              </p>
            </div>
            <button
              onClick={handleRefresh}
              className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
              title="Refresh"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          {/* How it works banner */}
          <div className="flex items-start gap-3 bg-primary/8 border border-primary/20 rounded-2xl px-4 py-3.5">
            <MonitorPlay className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-foreground mb-0.5">Two ways to log in</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                <strong className="text-foreground">Desktop Replit:</strong> "Log in" opens a browser on the server — sign in there and close it.<br />
                <strong className="text-foreground">Mobile / deployed:</strong> use <strong className="text-foreground">"Import"</strong> to copy session data from your own browser.
              </p>
            </div>
          </div>

          {/* AI session cards */}
          {isLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Loading sessions…</span>
            </div>
          ) : ais.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">
              No AI services found. Check that the backend is running.
            </div>
          ) : (
            <div className="space-y-3">
              {ais.map((ai) => {
                const active = ai.hasSession;
                const busy = createSession.isPending || deleteSession.isPending;
                return (
                  <div
                    key={ai.id}
                    className={`rounded-2xl border transition-all bg-card ${
                      active ? "border-emerald-500/30" : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-4 px-5 py-4">
                      {/* Avatar */}
                      <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 text-lg font-bold ${
                        active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"
                      }`}>
                        {ai.name.charAt(0)}
                      </div>

                      {/* Info */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{ai.name}</p>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            active
                              ? "bg-emerald-500/15 text-emerald-500"
                              : "bg-amber-500/10 text-amber-500"
                          }`}>
                            {active
                              ? <><ShieldCheck className="h-2.5 w-2.5" /> Active</>
                              : <><ShieldAlert className="h-2.5 w-2.5" /> Not logged in</>}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{ai.url}</p>
                      </div>

                      {/* Actions */}
                      {active ? (
                        <button
                          onClick={() => handleDelete(ai.id)}
                          disabled={busy}
                          className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
                        >
                          {deleteSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Remove
                        </button>
                      ) : (
                        <div className="shrink-0 flex flex-col gap-1.5">
                          <button
                            onClick={() => setImportingAi({ id: ai.id, name: ai.name, url: ai.url })}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 border border-primary/20 transition-colors"
                          >
                            <ClipboardPaste className="h-3.5 w-3.5" />
                            Import
                          </button>
                          <button
                            onClick={() => handleCreate(ai.id)}
                            disabled={busy || !ai.isAvailable}
                            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 border border-border transition-colors disabled:opacity-50"
                            title="Opens a browser on the server (desktop only)"
                          >
                            {createSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                            Desktop
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Active bar */}
                    {active && (
                      <div className="mx-5 mb-4 flex items-center gap-2 bg-emerald-500/8 border border-emerald-500/15 rounded-xl px-3 py-2.5 text-xs text-emerald-500">
                        <Zap className="h-3 w-3 shrink-0" />
                        Session active — ready to receive prompts from Chat
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tip */}
          <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-muted/40 border border-border text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p>
              <strong className="text-foreground">Tip:</strong> Sessions are saved until you remove them. If an AI stops responding, remove and re-import its session.
            </p>
          </div>

        </div>
      </ScrollArea>
    </>
  );
}
