import { useState, useRef, useEffect } from "react";
import { useListAis, getListAisQueryKey, useAskAi } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Send, TerminalSquare, AlertCircle, RefreshCw, PlusCircle } from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TerminalOutput } from "@/components/chat/terminal-output";

export function Home() {
  const { data: aisData, isLoading: isLoadingAis } = useListAis({
    query: { queryKey: getListAisQueryKey() }
  });

  const askAi = useAskAi();

  const [selectedAi, setSelectedAi] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant", content: string, aiId?: string, error?: boolean }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);
  
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-select first AI with session
  useEffect(() => {
    if (aisData?.ais && !selectedAi) {
      const activeAi = aisData.ais.find(a => a.hasSession);
      if (activeAi) setSelectedAi(activeAi.id);
      else if (aisData.ais.length > 0) setSelectedAi(aisData.ais[0].id);
    }
  }, [aisData, selectedAi]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, executionResult]);

  const handleSend = async () => {
    if (!prompt.trim() || !selectedAi) return;

    const userMsg = prompt;
    setPrompt("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);

    try {
      const result = await askAi.mutateAsync({
        data: {
          aiId: selectedAi,
          prompt: userMsg,
          conversationId
        }
      });

      if (result.success) {
        setConversationId(result.conversationId);
        setMessages(prev => [...prev, { role: "assistant", content: result.response, aiId: result.aiId }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: result.error || "Failed to get response", error: true }]);
      }
    } catch (err: any) {
      setMessages(prev => [...prev, { role: "assistant", content: "An unexpected error occurred.", error: true }]);
    }
  };

  const handleRegenerate = async () => {
    const lastUserMessage = [...messages].reverse().find(m => m.role === "user");
    if (!lastUserMessage || !selectedAi) return;

    try {
      const result = await askAi.mutateAsync({
        data: {
          aiId: selectedAi,
          prompt: lastUserMessage.content,
          conversationId
        }
      });

      if (result.success) {
        setConversationId(result.conversationId);
        setMessages(prev => [...prev, { role: "assistant", content: result.response, aiId: result.aiId }]);
      }
    } catch (err: any) {}
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const newChat = () => {
    setMessages([]);
    setConversationId(null);
    setExecutionResult(null);
  };

  return (
    <div className="flex h-full w-full bg-[#0a0a0a] text-gray-200">
      {/* AI Selector Sidebar */}
      <div className="w-48 border-r border-[#1a1a1a] bg-[#0d0d0d] flex flex-col shrink-0">
        <div className="p-3 border-b border-[#1a1a1a] flex items-center justify-between">
          <span className="font-mono text-xs text-gray-500 uppercase tracking-wider">Models</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 text-gray-400" onClick={newChat} title="New Chat">
            <PlusCircle className="h-4 w-4" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {isLoadingAis ? (
              <div className="p-4 text-xs text-gray-500 text-center">Loading...</div>
            ) : aisData?.ais.map(ai => (
              <button
                key={ai.id}
                onClick={() => setSelectedAi(ai.id)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2
                  ${selectedAi === ai.id ? "bg-[#1a1a1a] text-white" : "hover:bg-[#111] text-gray-400"}`}
              >
                <div className={`h-2 w-2 rounded-full ${
                  !ai.isAvailable ? "bg-red-500" :
                  ai.hasSession ? "bg-green-500" : "bg-amber-500"
                }`} />
                <span className="truncate">{ai.name}</span>
              </button>
            ))}
          </div>
        </ScrollArea>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        <div className="flex-1 overflow-auto p-4 md:p-6" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center text-gray-500 space-y-4">
              <TerminalSquare className="h-12 w-12 opacity-20" />
              <div>
                <h3 className="text-lg font-medium text-gray-300">Proxy Terminal Ready</h3>
                <p className="text-sm max-w-md mx-auto mt-2">
                  Select an AI model from the sidebar and start typing to route your prompt.
                </p>
              </div>
            </div>
          ) : (
            <div className="max-w-4xl mx-auto space-y-8 pb-10">
              {messages.map((msg, i) => (
                <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-lg p-4 ${
                    msg.role === "user" 
                      ? "bg-[#1a1a1a] text-gray-200 border border-[#2a2a2a]" 
                      : msg.error 
                        ? "bg-red-950/20 border border-red-900/50 text-red-400"
                        : "bg-transparent text-gray-300"
                  }`}>
                    {msg.role === "user" ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-xs font-mono text-primary bg-primary/10 px-2 py-0.5 rounded">
                            {aisData?.ais.find(a => a.id === msg.aiId)?.name || "Assistant"}
                          </span>
                        </div>
                        <MarkdownRenderer 
                          content={msg.content} 
                          onCodeExecuted={setExecutionResult}
                        />
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {askAi.isPending && (
                <div className="flex justify-start">
                  <div className="max-w-[85%] p-4 text-gray-500 flex items-center gap-3">
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce" />
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce [animation-delay:0.2s]" />
                    <div className="h-2 w-2 bg-primary rounded-full animate-bounce [animation-delay:0.4s]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Output panel if code was executed */}
        {executionResult && (
          <div className="shrink-0 z-10 relative shadow-[0_-10px_30px_rgba(0,0,0,0.5)]">
            <TerminalOutput result={executionResult} onClose={() => setExecutionResult(null)} />
          </div>
        )}

        {/* Input Area */}
        <div className="shrink-0 p-4 bg-[#0a0a0a] border-t border-[#1a1a1a]">
          <div className="max-w-4xl mx-auto relative">
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Enter prompt (Shift+Enter for new line)..."
              className="min-h-[80px] max-h-64 resize-none bg-[#111] border-[#222] focus-visible:ring-1 focus-visible:ring-primary text-gray-200 py-3 pr-24"
              disabled={askAi.isPending}
            />
            <div className="absolute right-3 bottom-3 flex items-center gap-2">
              {messages.length > 0 && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-gray-400 hover:text-gray-200"
                  onClick={handleRegenerate}
                  disabled={askAi.isPending}
                  title="Regenerate last response"
                >
                  <RefreshCw className={`h-4 w-4 ${askAi.isPending ? "animate-spin" : ""}`} />
                </Button>
              )}
              <Button 
                size="sm" 
                onClick={handleSend} 
                disabled={!prompt.trim() || askAi.isPending || !selectedAi}
                className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
              >
                <Send className="h-4 w-4 mr-1" /> Send
              </Button>
            </div>
            
            {/* Warning if AI selected has no session */}
            {selectedAi && aisData?.ais.find(a => a.id === selectedAi && !a.hasSession) && (
              <div className="absolute -top-8 left-0 text-xs text-amber-500 flex items-center gap-1 bg-amber-500/10 px-2 py-1 rounded">
                <AlertCircle className="h-3 w-3" />
                No active session for this AI. Sending may fail.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
