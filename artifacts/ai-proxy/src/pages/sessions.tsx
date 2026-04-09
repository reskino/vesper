import { useState, useEffect, useRef, useCallback } from "react";
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
  Monitor, MousePointer, Keyboard, Save,
} from "lucide-react";

// ─── Manual Import Dialog ─────────────────────────────────────────────────────

const JS_SNIPPET = `(function(){const s={cookies:[],origins:[{origin:location.origin,localStorage:Object.keys(localStorage).map(k=>({name:k,value:localStorage.getItem(k)}))}]};navigator.clipboard.writeText(JSON.stringify(s,null,2)).then(()=>alert('Copied!')).catch(()=>prompt('Copy this:',JSON.stringify(s)));})();`;

function ImportSheet({ ai, onClose, onSuccess }: { ai: { id: string; name: string; url: string }; onClose: () => void; onSuccess: () => void }) {
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
        toast({ title: "Session imported", description: `Logged in to ${ai.name}.` });
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-background border border-border rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden">
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
            <div className="flex items-start gap-2.5 bg-amber-500/8 border border-amber-500/20 rounded-2xl px-4 py-3 text-xs text-amber-400">
              <MonitorPlay className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p><strong>Why manual?</strong> Vesper runs on a cloud server — it can't open a browser on your phone. Copy session data from your own browser and paste it here instead.</p>
            </div>
            <div className="space-y-3">
              {/* Step 1 */}
              <button onClick={() => setStep(step === 1 ? 0 : 1)} className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${step === 1 ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${step === 1 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>1</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Open {ai.name} and log in</p>
                  {step === 1 && (
                    <div className="mt-2 space-y-2">
                      <p className="text-xs text-muted-foreground">Tap the link below to open {ai.name} in a new tab, then sign in normally.</p>
                      <a href={ai.url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-1.5 text-xs text-primary underline">Open {ai.url} <ExternalLink className="h-3 w-3" /></a>
                      <button onClick={e => { e.stopPropagation(); setStep(2); }} className="mt-1 flex items-center gap-1 text-xs text-primary font-medium">Logged in — next <ChevronRight className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
              </button>
              {/* Step 2 */}
              <button onClick={() => setStep(step === 2 ? 0 : 2)} className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${step === 2 ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${step === 2 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>2</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Copy session data</p>
                  {step === 2 && (
                    <div className="mt-2 space-y-3" onClick={e => e.stopPropagation()}>
                      <p className="text-xs text-muted-foreground"><strong className="text-foreground">Desktop</strong>: open DevTools (F12) → Console, paste the snippet below and press Enter.</p>
                      <div className="relative">
                        <pre className="text-[10px] text-muted-foreground bg-muted rounded-xl p-3 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">{JS_SNIPPET}</pre>
                        <button onClick={() => navigator.clipboard.writeText(JS_SNIPPET).then(() => toast({ title: "Snippet copied" }))} className="absolute top-2 right-2 flex items-center gap-1 text-[10px] bg-background border border-border rounded-lg px-2 py-1 text-muted-foreground hover:text-foreground transition-colors">
                          <ClipboardPaste className="h-3 w-3" /> Copy
                        </button>
                      </div>
                      <p className="text-xs text-muted-foreground"><strong className="text-foreground">iPhone</strong>: install <strong className="text-foreground">Cookie-Editor</strong> from the App Store, open {ai.url}, export cookies as JSON.</p>
                      <button onClick={() => setStep(3)} className="flex items-center gap-1 text-xs text-primary font-medium">Got it — paste now <ChevronRight className="h-3.5 w-3.5" /></button>
                    </div>
                  )}
                </div>
              </button>
              {/* Step 3 */}
              <button onClick={() => setStep(step === 3 ? 0 : 3)} className={`w-full text-left flex items-center gap-3 px-4 py-3 rounded-2xl border transition-colors ${step === 3 ? "border-primary/40 bg-primary/5" : "border-border bg-card"}`}>
                <span className={`h-6 w-6 shrink-0 rounded-full flex items-center justify-center text-xs font-bold ${step === 3 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>3</span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">Paste the session JSON</p>
                  {step === 3 && (
                    <div className="mt-2 space-y-2" onClick={e => e.stopPropagation()}>
                      <textarea value={pasted} onChange={e => setPasted(e.target.value)} placeholder={'{"cookies":[...],"origins":[...]}'} rows={6} className="w-full rounded-xl border border-border bg-muted text-xs text-foreground placeholder:text-muted-foreground p-3 font-mono resize-none focus:outline-none focus:ring-2 focus:ring-primary/40" />
                      <button onClick={handleImport} disabled={!pasted.trim() || loading} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 transition-colors disabled:opacity-50">
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

// ─── Desktop Browser Viewer ───────────────────────────────────────────────────

function BrowserViewer({ ai, onClose, onSaved }: { ai: { id: string; name: string; url: string }; onClose: () => void; onSaved: () => void }) {
  const { toast } = useToast();
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("starting");
  const [currentUrl, setCurrentUrl] = useState("");
  const [typeText, setTypeText] = useState("");
  const [saving, setSaving] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchScreenshot = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/browser-screenshot/${ai.id}`);
      if (res.ok) {
        const data = await res.json();
        if (data.screenshot) setScreenshot(data.screenshot);
      }
    } catch {}
  }, [ai.id]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/sessions/browser-status/${ai.id}`);
      if (res.ok) {
        const data = await res.json();
        setStatus(data.status || "ready");
        if (data.url) setCurrentUrl(data.url);
        if (data.status === "saved") {
          toast({ title: "Session saved!", description: `You are logged in to ${ai.name}.` });
          onSaved();
          onClose();
        }
      }
    } catch {}
  }, [ai.id, ai.name, onClose, onSaved, toast]);

  useEffect(() => {
    pollRef.current = setInterval(() => {
      fetchScreenshot();
      fetchStatus();
    }, 1500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [fetchScreenshot, fetchStatus]);

  const sendAction = async (payload: object) => {
    await fetch(`/api/sessions/browser-action/${ai.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  };

  const handleImgClick = (e: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    const rect = img.getBoundingClientRect();
    // Map click to 1280×900 coordinate space
    const x = Math.round(((e.clientX - rect.left) / rect.width) * 1280);
    const y = Math.round(((e.clientY - rect.top) / rect.height) * 900);
    sendAction({ action: "click", x, y });
  };

  const handleSave = async () => {
    setSaving(true);
    await sendAction({ action: "save" });
    // Status poller will detect "saved" and close
    setTimeout(() => setSaving(false), 5000);
  };

  const handleType = () => {
    if (!typeText) return;
    sendAction({ action: "type", text: typeText });
    setTypeText("");
  };

  const statusLabel: Record<string, string> = {
    starting: "Starting browser…",
    ready: "Ready — log in",
    saving: "Saving session…",
    saved: "Session saved!",
    error: "Error",
    idle: "Not running",
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-card shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <Monitor className="h-4 w-4 text-primary shrink-0" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground truncate">{ai.name} — Remote Browser</p>
            {currentUrl && <p className="text-xs text-muted-foreground truncate font-mono">{currentUrl}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-xs px-2 py-1 rounded-full font-medium ${
            status === "ready" ? "bg-emerald-500/15 text-emerald-500" :
            status === "error" ? "bg-red-500/15 text-red-500" :
            "bg-amber-500/10 text-amber-500"
          }`}>{statusLabel[status] ?? status}</span>
          <button onClick={onClose} className="h-8 w-8 rounded-full flex items-center justify-center hover:bg-muted transition-colors">
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* Screenshot area */}
      <div className="flex-1 overflow-auto bg-black flex items-start justify-center">
        {screenshot ? (
          <img
            ref={imgRef}
            src={screenshot}
            alt="Browser"
            onClick={handleImgClick}
            className="max-w-full cursor-crosshair"
            style={{ imageRendering: "crisp-edges" }}
          />
        ) : (
          <div className="flex flex-col items-center justify-center h-64 gap-3 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">{statusLabel[status] ?? "Loading…"}</p>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="border-t border-border bg-card px-4 py-3 space-y-2 shrink-0">
        {/* Type bar */}
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-muted rounded-xl px-3 py-2">
            <Keyboard className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              value={typeText}
              onChange={e => setTypeText(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { handleType(); } if (e.key === "Tab") { e.preventDefault(); sendAction({ action: "key", key: "Tab" }); } }}
              placeholder="Type text here, Enter to send…"
              className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <button onClick={handleType} disabled={!typeText} className="px-3 py-2 rounded-xl bg-muted hover:bg-muted/80 text-muted-foreground disabled:opacity-40 transition-colors">
            <MousePointer className="h-4 w-4" />
          </button>
        </div>
        {/* Action buttons */}
        <div className="flex gap-2">
          <button onClick={() => sendAction({ action: "key", key: "Enter" })} className="flex-1 py-2 rounded-xl text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">↵ Enter</button>
          <button onClick={() => sendAction({ action: "key", key: "Tab" })} className="flex-1 py-2 rounded-xl text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">⇥ Tab</button>
          <button onClick={() => sendAction({ action: "key", key: "Escape" })} className="flex-1 py-2 rounded-xl text-xs font-medium bg-muted hover:bg-muted/80 text-muted-foreground transition-colors">Esc</button>
          <button onClick={handleSave} disabled={saving || status !== "ready"} className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-xs font-semibold bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground text-center">Click the screenshot to interact • Type in the box above • Tap Save when logged in</p>
      </div>
    </div>
  );
}

// ─── Main Sessions page ───────────────────────────────────────────────────────

export function Sessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [importingAi, setImportingAi] = useState<{ id: string; name: string; url: string } | null>(null);
  const [desktopAi, setDesktopAi]   = useState<{ id: string; name: string; url: string } | null>(null);

  const { data: aisData, isLoading: isLoadingAis, refetch: refetchAis } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const { data: _sd, isLoading: isLoadingSessions, refetch: refetchSessions } = useListSessions({ query: { queryKey: getListSessionsQueryKey() } });

  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const ais = aisData?.ais ?? [];

  const handleDesktop = async (ai: { id: string; name: string; url: string }) => {
    try {
      await createSession.mutateAsync({ data: { aiId: ai.id } });
      setDesktopAi(ai);
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to launch browser", description: e.message });
    }
  };

  const handleDelete = async (aiId: string) => {
    try {
      await deleteSession.mutateAsync({ aiId });
      queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      toast({ title: "Session removed" });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Error", description: e.message });
    }
  };

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
  };

  return (
    <>
      {importingAi && <ImportSheet ai={importingAi} onClose={() => setImportingAi(null)} onSuccess={invalidate} />}
      {desktopAi && <BrowserViewer ai={desktopAi} onClose={() => { setDesktopAi(null); invalidate(); }} onSaved={invalidate} />}

      <ScrollArea className="h-full">
        <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 pb-24 sm:pb-8">

          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-foreground">Sessions</h1>
              <p className="text-sm text-muted-foreground mt-0.5">Log in to each AI to start routing your prompts.</p>
            </div>
            <button onClick={() => { refetchAis(); refetchSessions(); }} className="shrink-0 h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-start gap-3 bg-primary/8 border border-primary/20 rounded-2xl px-4 py-3.5">
            <MonitorPlay className="h-4 w-4 text-primary shrink-0 mt-0.5" />
            <div className="text-sm">
              <p className="font-semibold text-foreground mb-0.5">Two ways to log in</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                <strong className="text-foreground">Desktop:</strong> opens a live browser you can control inside Vesper — log in there and tap Save.<br />
                <strong className="text-foreground">Import:</strong> copy session data from your own phone/desktop browser and paste it here.
              </p>
            </div>
          </div>

          {(isLoadingAis || isLoadingSessions) ? (
            <div className="flex items-center justify-center py-16 gap-2 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /><span className="text-sm">Loading…</span>
            </div>
          ) : ais.length === 0 ? (
            <div className="text-center py-16 text-muted-foreground text-sm">No AI services found. Check that the backend is running.</div>
          ) : (
            <div className="space-y-3">
              {ais.map((ai) => {
                const active = ai.hasSession;
                const busy = createSession.isPending || deleteSession.isPending;
                return (
                  <div key={ai.id} className={`rounded-2xl border transition-all bg-card ${active ? "border-emerald-500/30" : "border-border"}`}>
                    <div className="flex items-center gap-4 px-5 py-4">
                      <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 text-lg font-bold ${active ? "bg-emerald-500/15 text-emerald-500" : "bg-muted text-muted-foreground"}`}>
                        {ai.name.charAt(0)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-semibold text-foreground">{ai.name}</p>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${active ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/10 text-amber-500"}`}>
                            {active ? <><ShieldCheck className="h-2.5 w-2.5" /> Active</> : <><ShieldAlert className="h-2.5 w-2.5" /> Not logged in</>}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5 truncate font-mono">{ai.url}</p>
                      </div>
                      {active ? (
                        <button onClick={() => handleDelete(ai.id)} disabled={busy} className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50">
                          {deleteSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                          Remove
                        </button>
                      ) : (
                        <div className="shrink-0 flex flex-col gap-1.5">
                          <button onClick={() => handleDesktop({ id: ai.id, name: ai.name, url: ai.url })} disabled={busy} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-primary-foreground bg-primary hover:bg-primary/90 border border-primary/20 transition-colors disabled:opacity-50">
                            {createSession.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Monitor className="h-3.5 w-3.5" />}
                            Desktop
                          </button>
                          <button onClick={() => setImportingAi({ id: ai.id, name: ai.name, url: ai.url })} className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/80 border border-border transition-colors">
                            <ClipboardPaste className="h-3.5 w-3.5" />
                            Import
                          </button>
                        </div>
                      )}
                    </div>
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

          <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-muted/40 border border-border text-xs text-muted-foreground">
            <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
            <p><strong className="text-foreground">Tip:</strong> Sessions are saved until you remove them. If an AI stops responding, remove and re-import its session.</p>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}
