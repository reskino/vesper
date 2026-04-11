import { useListHistory, getListHistoryQueryKey, useGetHistoryStats, getGetHistoryStatsQueryKey, useClearHistory, useGetHistory, getGetHistoryQueryKey } from "@workspace/api-client-react";
import { format } from "date-fns";
import { MessageSquare, Clock, BarChart3, Trash2, ChevronDown, ChevronUp, Loader2, Hash } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { ScrollArea } from "@/components/ui/scroll-area";

// ── Expanded conversation detail ──────────────────────────────────────────────
function ConversationDetail({ aiId, isOpen }: { aiId: string; isOpen: boolean }) {
  const { data: history } = useGetHistory(aiId, {
    query: { enabled: isOpen, queryKey: getGetHistoryQueryKey(aiId) }
  });

  if (!isOpen) return null;
  if (!history) return (
    <div className="pt-4 pb-2 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading messages…
    </div>
  );
  if (history.messages.length === 0) return (
    <div className="pt-4 pb-2 text-sm text-muted-foreground">No messages in history.</div>
  );

  return (
    <div className="mt-4 pt-4 border-t border-border/50 space-y-4">
      {history.messages.map((msg) => (
        <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[88%] text-sm rounded-xl px-3.5 py-2.5 ${
            msg.role === "user"
              ? "bg-muted text-foreground"
              : "text-foreground"
          }`}>
            <div className="text-[10px] text-muted-foreground mb-1.5 font-mono">
              {format(new Date(msg.timestamp), "HH:mm:ss")} · {msg.role}
            </div>
            {msg.role === "user" ? (
              <div className="whitespace-pre-wrap leading-relaxed">{msg.content}</div>
            ) : (
              <MarkdownRenderer content={msg.content} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, accent }: {
  icon: React.ElementType; label: string; value: string | number; accent?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex items-center gap-4">
      <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${
        accent ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"
      }`}>
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${accent ? "text-primary" : "text-foreground"}`}>{value}</p>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function History() {
  const { data: historyData, isLoading } = useListHistory({
    query: { queryKey: getListHistoryQueryKey() }
  });
  const { data: statsData } = useGetHistoryStats({
    query: { queryKey: getGetHistoryStatsQueryKey() }
  });
  const clearHistory = useClearHistory();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [filterAi, setFilterAi] = useState<string | null>(null);
  const [expandedAi, setExpandedAi] = useState<string | null>(null);

  const handleClear = async (aiId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await clearHistory.mutateAsync({ aiId });
      queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetHistoryStatsQueryKey() });
      toast({ title: "History cleared" });
      if (expandedAi === aiId) setExpandedAi(null);
    } catch {
      toast({ variant: "destructive", title: "Failed to clear history" });
    }
  };

  const conversations = historyData?.conversations || [];
  const filtered = filterAi ? conversations.filter(c => c.aiId === filterAi) : conversations;
  const aiFilters = Object.keys(statsData?.messagesByAi || {});

  return (
    <ScrollArea className="h-full">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-8 space-y-8 pb-24 sm:pb-10">

        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">History</h1>
          <p className="text-sm text-muted-foreground mt-1">Past conversations and usage statistics</p>
        </div>

        {/* Stats */}
        {statsData && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={MessageSquare} label="Total Messages" value={statsData.totalMessages} />
            <StatCard icon={Clock} label="Sessions Active" value={statsData.totalSessions} />
            <StatCard icon={BarChart3} label="Most Used AI" value={statsData.mostUsedAi || "None"} accent />
          </div>
        )}

        {/* Filter pills */}
        {aiFilters.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFilterAi(null)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                filterAi === null
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
              }`}
            >
              All
            </button>
            {aiFilters.map(aiId => (
              <button
                key={aiId}
                onClick={() => setFilterAi(aiId === filterAi ? null : aiId)}
                className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors flex items-center gap-1.5 ${
                  filterAi === aiId
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground"
                }`}
              >
                {aiId}
                <span className="opacity-70">({statsData?.messagesByAi[aiId]})</span>
              </button>
            ))}
          </div>
        )}

        {/* Conversation list */}
        <div className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 border border-dashed border-border rounded-2xl">
              <MessageSquare className="h-8 w-8 text-muted-foreground/70 mx-auto mb-3" />
              <p className="text-sm text-muted-foreground">No history found</p>
              <p className="text-xs text-muted-foreground/85 mt-1">Start a conversation to see it here</p>
            </div>
          ) : (
            filtered.map((conv, i) => {
              const isOpen = expandedAi === conv.aiId;
              return (
                <div
                  key={i}
                  className="rounded-2xl border border-border bg-card overflow-hidden transition-all"
                >
                  <div
                    className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedAi(isOpen ? null : conv.aiId)}
                  >
                    {/* AI badge */}
                    <span className="shrink-0 text-[10px] font-mono font-semibold bg-primary/10 text-primary px-2 py-0.5 rounded-full">
                      {conv.aiName}
                    </span>

                    {/* Preview */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate leading-relaxed">
                        {conv.lastMessage || "No message content"}
                      </p>
                    </div>

                    {/* Meta */}
                    <div className="flex items-center gap-3 shrink-0">
                      <div className="hidden sm:flex items-center gap-1 text-xs text-muted-foreground">
                        <Hash className="h-3 w-3" />
                        {conv.messageCount}
                      </div>
                      <p className="text-xs text-muted-foreground hidden md:block">
                        {format(new Date(conv.lastUpdated), "MMM d, HH:mm")}
                      </p>
                      <button
                        onClick={(e) => handleClear(conv.aiId, e)}
                        className="h-7 w-7 flex items-center justify-center rounded-lg text-muted-foreground hover:text-red-400 hover:bg-red-950/30 transition-colors"
                        title="Clear this AI's history"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                      <div className="text-muted-foreground">
                        {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </div>
                    </div>
                  </div>

                  {isOpen && (
                    <div className="px-5 pb-5">
                      <ConversationDetail aiId={conv.aiId} isOpen={isOpen} />
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </ScrollArea>
  );
}
