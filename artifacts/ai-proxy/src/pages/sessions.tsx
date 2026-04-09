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
} from "lucide-react";

export function Sessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: aisData, isLoading: isLoadingAis, refetch: refetchAis } = useListAis({
    query: { queryKey: getListAisQueryKey() },
  });
  const { data: sessionsData, isLoading: isLoadingSessions, refetch: refetchSessions } = useListSessions({
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
          title: "Browser opened",
          description: "Log in to the AI service, then close the window to save your session.",
        });
        setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
        }, 3000);
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
      toast({ title: "Session removed", description: "You will need to log in again to use this AI." });
    } catch (e: any) {
      toast({ variant: "destructive", title: "Failed to remove session", description: e.message });
    }
  };

  const handleRefresh = () => {
    refetchAis();
    refetchSessions();
  };

  return (
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
            <p className="font-semibold text-foreground mb-0.5">How it works</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Tapping "Log in" opens a browser window to the AI website. Sign in as normal, then close
              the window. Vesper saves your session so it can send prompts on your behalf — no password
              is ever stored.
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
                    {/* Status ring */}
                    <div className={`h-11 w-11 rounded-2xl flex items-center justify-center shrink-0 text-lg font-bold ${
                      active
                        ? "bg-emerald-500/15 text-emerald-500"
                        : "bg-muted text-muted-foreground"
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

                    {/* Action button */}
                    {active ? (
                      <button
                        onClick={() => handleDelete(ai.id)}
                        disabled={busy}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition-colors disabled:opacity-50"
                      >
                        {deleteSession.isPending
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                        Remove
                      </button>
                    ) : (
                      <button
                        onClick={() => handleCreate(ai.id)}
                        disabled={busy || !ai.isAvailable}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-primary-foreground bg-primary hover:bg-primary/90 border border-primary/20 transition-colors disabled:opacity-50"
                      >
                        {createSession.isPending
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <LogIn className="h-3.5 w-3.5" />}
                        Log in
                      </button>
                    )}
                  </div>

                  {/* Active session detail bar */}
                  {active && (
                    <div className="mx-5 mb-4 flex items-center gap-2 bg-emerald-500/8 border border-emerald-500/15 rounded-xl px-3 py-2.5 text-xs text-emerald-500">
                      <Zap className="h-3 w-3 shrink-0" />
                      Session active — ready to receive prompts from Chat
                    </div>
                  )}

                  {/* No session hint */}
                  {!active && !ai.isAvailable && (
                    <div className="mx-5 mb-4 text-xs text-red-400 bg-red-500/8 border border-red-500/15 rounded-xl px-3 py-2.5">
                      This service is currently unreachable. Check your network connection.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Quick tip */}
        <div className="flex items-start gap-2 px-4 py-3 rounded-2xl bg-muted/40 border border-border text-xs text-muted-foreground">
          <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
          <p>
            <strong className="text-foreground">Tip:</strong> You only need to log in once. Sessions are saved automatically and survive restarts. If an AI stops responding, remove and recreate its session.
          </p>
        </div>

      </div>
    </ScrollArea>
  );
}
