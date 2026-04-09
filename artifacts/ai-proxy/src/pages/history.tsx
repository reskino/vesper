import { useListHistory, getListHistoryQueryKey, useGetHistoryStats, getGetHistoryStatsQueryKey, useClearHistory, useGetHistory, getGetHistoryQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format } from "date-fns";
import { MessageSquare, Clock, BarChart3, Trash, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";

function ConversationDetail({ aiId, isOpen }: { aiId: string, isOpen: boolean }) {
  const { data: history } = useGetHistory(aiId, {
    query: {
      enabled: isOpen,
      queryKey: getGetHistoryQueryKey(aiId)
    }
  });

  if (!isOpen) return null;
  if (!history) return <div className="p-4 text-center text-sm text-gray-500">Loading messages...</div>;
  if (history.messages.length === 0) return <div className="p-4 text-center text-sm text-gray-500">No messages in history.</div>;

  return (
    <div className="mt-4 border-t border-[#222] pt-4 space-y-4">
      {history.messages.map((msg) => (
        <div key={msg.id} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
          <div className={`max-w-[85%] rounded-md p-3 text-sm ${
            msg.role === "user" 
              ? "bg-[#1a1a1a] text-gray-200 border border-[#2a2a2a]" 
              : "bg-transparent text-gray-300"
          }`}>
            <div className="text-xs text-gray-500 mb-1">{format(new Date(msg.timestamp), "HH:mm:ss")}</div>
            {msg.role === "user" ? (
              <div className="whitespace-pre-wrap">{msg.content}</div>
            ) : (
              <MarkdownRenderer content={msg.content} />
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

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

  const handleClear = async (aiId: string) => {
    try {
      await clearHistory.mutateAsync({ aiId });
      queryClient.invalidateQueries({ queryKey: getListHistoryQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetHistoryStatsQueryKey() });
      toast({ title: "History cleared" });
      if (expandedAi === aiId) setExpandedAi(null);
    } catch (e) {
      toast({ variant: "destructive", title: "Failed to clear history" });
    }
  };

  const conversations = historyData?.conversations || [];
  const filteredConversations = filterAi ? conversations.filter(c => c.aiId === filterAi) : conversations;

  return (
    <div className="flex-1 overflow-auto p-6 lg:p-10 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-100">Conversation History</h1>
          <p className="text-muted-foreground mt-2">
            Review past interactions and prompt routing statistics.
          </p>
        </div>

        {statsData && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-[#111] border-[#222]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Total Messages</CardTitle>
                <MessageSquare className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-200">{statsData.totalMessages}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#111] border-[#222]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Total Sessions Active</CardTitle>
                <Clock className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-gray-200">{statsData.totalSessions}</div>
              </CardContent>
            </Card>
            <Card className="bg-[#111] border-[#222]">
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium text-gray-400">Most Used AI</CardTitle>
                <BarChart3 className="h-4 w-4 text-primary" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-primary">{statsData.mostUsedAi || "None"}</div>
              </CardContent>
            </Card>
          </div>
        )}

        <div className="space-y-4">
          <div className="flex gap-2">
            <Button 
              variant={filterAi === null ? "default" : "outline"} 
              size="sm"
              className={filterAi === null ? "bg-[#333] text-white hover:bg-[#444]" : "border-[#333] text-gray-400"}
              onClick={() => setFilterAi(null)}
            >
              All
            </Button>
            {Object.keys(statsData?.messagesByAi || {}).map(aiId => (
              <Button
                key={aiId}
                variant={filterAi === aiId ? "default" : "outline"}
                size="sm"
                className={filterAi === aiId ? "bg-primary text-primary-foreground border-primary" : "border-[#333] text-gray-400"}
                onClick={() => setFilterAi(aiId)}
              >
                {aiId} ({statsData?.messagesByAi[aiId]})
              </Button>
            ))}
          </div>

          <div className="space-y-4 pb-10">
            {isLoading ? (
              <div className="text-gray-500">Loading history...</div>
            ) : filteredConversations.length === 0 ? (
              <div className="text-gray-500 p-8 text-center border border-dashed border-[#222] rounded-lg">
                No history found.
              </div>
            ) : (
              filteredConversations.map((conv, i) => {
                const isOpen = expandedAi === conv.aiId;
                return (
                  <div key={i} className="p-4 rounded-lg bg-[#111] border border-[#222]">
                    <div className="flex justify-between items-start cursor-pointer" onClick={() => setExpandedAi(isOpen ? null : conv.aiId)}>
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono bg-primary/20 text-primary px-2 py-0.5 rounded">
                            {conv.aiName}
                          </span>
                          <span className="text-xs text-gray-500">
                            {format(new Date(conv.lastUpdated), "MMM d, yyyy HH:mm")}
                          </span>
                        </div>
                        <div className="text-sm text-gray-300 line-clamp-2 max-w-3xl pr-4">
                          {conv.lastMessage || "No message content"}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-500 mr-2">{conv.messageCount} msgs</span>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-gray-400 hover:text-white"
                          onClick={(e) => { e.stopPropagation(); setExpandedAi(isOpen ? null : conv.aiId); }}
                        >
                          {isOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                        </Button>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-red-400 hover:bg-red-950/30 hover:text-red-300"
                          onClick={(e) => { e.stopPropagation(); handleClear(conv.aiId); }}
                          title="Clear history for this AI"
                        >
                          <Trash className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                    
                    <ConversationDetail aiId={conv.aiId} isOpen={isOpen} />
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
