import { useState, useRef, useEffect } from "react";
import { 
  useListAis, 
  getListAisQueryKey, 
  useAskAi, 
  useAskAiWithContext,
  useSetModel,
  useGetFileTree,
  getGetFileTreeQueryKey,
  useReadFile,
  getReadFileQueryKey,
  FileNode
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { 
  Send, TerminalSquare, AlertCircle, RefreshCw, PlusCircle, 
  Paperclip, X, Folder, FileIcon, FileCode, FileText, FileJson, ChevronRight, ChevronDown, Loader2,
  ChevronUp, Cpu
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TerminalOutput } from "@/components/chat/terminal-output";

const getFileIcon = (filename: string) => {
  if (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.jsx') || filename.endsWith('.tsx')) return <FileCode className="h-4 w-4 text-blue-400" />;
  if (filename.endsWith('.json')) return <FileJson className="h-4 w-4 text-yellow-400" />;
  if (filename.endsWith('.md')) return <FileText className="h-4 w-4 text-gray-400" />;
  return <FileIcon className="h-4 w-4 text-gray-500" />;
};

function MiniFileTreeItem({ 
  node, 
  depth = 0, 
  onSelect
}: { 
  node: FileNode; 
  depth?: number; 
  onSelect: (path: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);

  if (node.name.startsWith('.')) return null;

  if (node.type === 'directory') {
    return (
      <div>
        <div 
          className="flex items-center py-1 px-2 hover:bg-[#1a1a1a] cursor-pointer text-sm text-gray-300 group"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 mr-1 text-gray-500" /> : <ChevronRight className="h-3.5 w-3.5 mr-1 text-gray-500" />}
          <Folder className="h-4 w-4 mr-2 text-blue-500" />
          <span className="truncate">{node.name}</span>
        </div>
        {expanded && node.children && (
          <div>
            {node.children.map(child => (
              <MiniFileTreeItem 
                key={child.path} 
                node={child} 
                depth={depth + 1} 
                onSelect={onSelect}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className={`flex items-center justify-between py-1 px-2 cursor-pointer text-sm text-gray-300 hover:bg-[#1a1a1a]`}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
      onClick={() => onSelect(node.path)}
    >
      <div className="flex items-center flex-1 min-w-0">
        {getFileIcon(node.name)}
        <span className="truncate ml-2">{node.name}</span>
      </div>
    </div>
  );
}

export function Home() {
  const queryClient = useQueryClient();
  const { data: aisData, isLoading: isLoadingAis } = useListAis({
    query: { queryKey: getListAisQueryKey() }
  });

  const askAi = useAskAi();
  const askAiWithContext = useAskAiWithContext();
  const setModelMutation = useSetModel();

  const [selectedAi, setSelectedAi] = useState<string | null>(null);
  const [expandedModelPicker, setExpandedModelPicker] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant", content: string, aiId?: string, error?: boolean }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);
  
  // Attach file state
  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);

  const { data: treeData, isLoading: treeLoading } = useGetFileTree({ path: "", depth: 10 }, {
    query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }), enabled: isFilePickerOpen }
  });

  const { data: attachedFileData } = useReadFile(
    { path: attachedFile || "" },
    { 
      query: { 
        enabled: !!attachedFile,
        queryKey: getReadFileQueryKey({ path: attachedFile || "" }),
      } 
    }
  );
  
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

  const isPending = askAi.isPending || askAiWithContext.isPending;

  const handleSend = async () => {
    if (!prompt.trim() || !selectedAi || isPending) return;

    const userMsg = prompt;
    setPrompt("");
    setMessages(prev => [...prev, { role: "user", content: userMsg }]);

    try {
      let result;
      if (attachedFile && attachedFileData?.content) {
        result = await askAiWithContext.mutateAsync({
          data: {
            aiId: selectedAi,
            prompt: userMsg,
            conversationId,
            files: [{ path: attachedFile, content: attachedFileData.content }]
          }
        });
      } else {
        result = await askAi.mutateAsync({
          data: {
            aiId: selectedAi,
            prompt: userMsg,
            conversationId
          }
        });
      }

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
    if (!lastUserMessage || !selectedAi || isPending) return;

    try {
      let result;
      if (attachedFile && attachedFileData?.content) {
        result = await askAiWithContext.mutateAsync({
          data: {
            aiId: selectedAi,
            prompt: lastUserMessage.content,
            conversationId,
            files: [{ path: attachedFile, content: attachedFileData.content }]
          }
        });
      } else {
        result = await askAi.mutateAsync({
          data: {
            aiId: selectedAi,
            prompt: lastUserMessage.content,
            conversationId
          }
        });
      }

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
      <div className="w-52 border-r border-[#1a1a1a] bg-[#0d0d0d] flex flex-col shrink-0">
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
            ) : aisData?.ais.map(ai => {
              const isSelected = selectedAi === ai.id;
              const isExpanded = expandedModelPicker === ai.id;
              const activeModel = ai.models?.find(m => m.id === ai.currentModel) ?? ai.models?.[0];
              return (
                <div key={ai.id}>
                  <div className={`flex items-center rounded-md text-sm transition-colors
                    ${isSelected ? "bg-[#1a1a1a] text-white" : "hover:bg-[#111] text-gray-400"}`}
                  >
                    <button
                      className="flex items-center gap-2 flex-1 min-w-0 px-3 py-2 text-left"
                      onClick={() => setSelectedAi(ai.id)}
                    >
                      <div className={`h-2 w-2 rounded-full shrink-0 ${
                        !ai.isAvailable ? "bg-red-500" :
                        ai.hasSession ? "bg-green-500" : "bg-amber-500"
                      }`} />
                      <span className="truncate flex-1">{ai.name}</span>
                    </button>
                    {ai.models && ai.models.length > 0 && (
                      <button
                        className="shrink-0 opacity-40 hover:opacity-100 transition-opacity p-2 rounded"
                        title="Switch model"
                        onClick={() => setExpandedModelPicker(isExpanded ? null : ai.id)}
                      >
                        {isExpanded ? <ChevronUp className="h-3 w-3" /> : <Cpu className="h-3 w-3" />}
                      </button>
                    )}
                  </div>

                  {/* Active model label */}
                  {isSelected && activeModel && (
                    <div className="px-3 pb-1">
                      <span className="text-[10px] text-gray-600 font-mono">{activeModel.name}</span>
                    </div>
                  )}

                  {/* Model picker dropdown */}
                  {isExpanded && ai.models && ai.models.length > 0 && (
                    <div className="mx-2 mb-1 border border-[#2a2a2a] rounded-md overflow-hidden bg-[#0a0a0a]">
                      {ai.models.map(model => (
                        <button
                          key={model.id}
                          className={`w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-2
                            ${ai.currentModel === model.id
                              ? "bg-primary/20 text-primary"
                              : "text-gray-400 hover:bg-[#1a1a1a] hover:text-gray-200"}`}
                          onClick={() => {
                            setModelMutation.mutate(
                              { data: { aiId: ai.id, modelId: model.id } },
                              {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
                                  setExpandedModelPicker(null);
                                }
                              }
                            );
                          }}
                        >
                          <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                            ai.currentModel === model.id ? "bg-primary" : "bg-transparent border border-gray-600"
                          }`} />
                          <span className="truncate">{model.name}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
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
          <div className="max-w-4xl mx-auto relative flex flex-col gap-2">
            
            {/* Attached file chip */}
            {attachedFile && (
              <div className="flex items-center gap-2 bg-[#1a1a1a] text-gray-300 text-xs px-3 py-1.5 rounded-full w-max border border-[#333]">
                <Paperclip className="h-3 w-3 text-primary" />
                <span className="max-w-[200px] truncate">{attachedFile}</span>
                <button 
                  className="hover:bg-[#333] rounded-full p-0.5 ml-1"
                  onClick={() => setAttachedFile(null)}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="relative">
              <Textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Enter prompt (Shift+Enter for new line)..."
                className="min-h-[80px] max-h-64 resize-none bg-[#111] border-[#222] focus-visible:ring-1 focus-visible:ring-primary text-gray-200 py-3 pr-24 pl-12"
                disabled={askAi.isPending || askAiWithContext.isPending}
              />
              
              {/* Attach button */}
              <Dialog open={isFilePickerOpen} onOpenChange={setIsFilePickerOpen}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute left-3 top-3 h-6 w-6 text-gray-400 hover:text-gray-200"
                  onClick={() => setIsFilePickerOpen(true)}
                  title="Attach file context"
                >
                  <Paperclip className="h-4 w-4" />
                </Button>
                <DialogContent className="bg-[#0d0d0d] border-[#1a1a1a] text-gray-200 max-w-md">
                  <DialogHeader>
                    <DialogTitle>Select File</DialogTitle>
                  </DialogHeader>
                  <ScrollArea className="h-[300px] border border-[#1a1a1a] rounded-md bg-[#0a0a0a]">
                    <div className="p-2">
                      {treeLoading ? (
                        <div className="flex items-center justify-center p-4 text-gray-500"><Loader2 className="h-4 w-4 animate-spin" /></div>
                      ) : treeData?.tree ? (
                        <MiniFileTreeItem 
                          node={treeData.tree} 
                          onSelect={(path) => {
                            setAttachedFile(path);
                            setIsFilePickerOpen(false);
                          }} 
                        />
                      ) : (
                        <div className="p-4 text-xs text-gray-500 text-center">No files found</div>
                      )}
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              <div className="absolute right-3 bottom-3 flex items-center gap-2">
                {messages.length > 0 && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 text-gray-400 hover:text-gray-200"
                    onClick={handleRegenerate}
                    disabled={isPending}
                    title="Regenerate last response"
                  >
                    <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
                  </Button>
                )}
                <Button 
                  size="sm" 
                  onClick={handleSend} 
                  disabled={!prompt.trim() || isPending || !selectedAi}
                  className="h-8 bg-primary text-primary-foreground hover:bg-primary/90"
                >
                  <Send className="h-4 w-4 mr-1" /> Send
                </Button>
              </div>
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
