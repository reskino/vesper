import { useState, useRef, useEffect } from "react";
import {
  useListAis, getListAisQueryKey,
  useAskAi, useAskAiWithContext, useSetModel,
  useGetFileTree, getGetFileTreeQueryKey,
  useReadFile, getReadFileQueryKey,
  FileNode,
} from "@workspace/api-client-react";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Send, PlusCircle, Paperclip, X, Folder, FileIcon, FileCode,
  FileText, FileJson, ChevronRight, ChevronDown, Loader2,
  ChevronUp, RefreshCw, AlertCircle, Check, Plus, Upload, FolderOpen,
} from "lucide-react";
import { VesperLogo } from "@/components/vesper-logo";
import { useQueryClient } from "@tanstack/react-query";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TerminalOutput } from "@/components/chat/terminal-output";

// ── File icon helper ──────────────────────────────────────────────────────────
const getFileIcon = (name: string) => {
  if (/\.(js|ts|jsx|tsx)$/.test(name)) return <FileCode className="h-4 w-4 text-blue-400" />;
  if (/\.json$/.test(name)) return <FileJson className="h-4 w-4 text-yellow-400" />;
  if (/\.md$/.test(name)) return <FileText className="h-4 w-4 text-muted-foreground" />;
  return <FileIcon className="h-4 w-4 text-muted-foreground" />;
};

// ── Mini file tree ────────────────────────────────────────────────────────────
function MiniFileTreeItem({ node, depth = 0, onSelect }: { node: FileNode; depth?: number; onSelect: (p: string) => void }) {
  const [expanded, setExpanded] = useState(depth === 0);
  if (node.name.startsWith(".")) return null;
  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-1.5 px-2 hover:bg-muted/50 cursor-pointer text-sm rounded-md group"
          style={{ paddingLeft: `${depth * 14 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />}
          <Folder className="h-4 w-4 mr-2 text-blue-400" />
          <span className="truncate">{node.name}</span>
        </div>
        {expanded && node.children?.map(c => (
          <MiniFileTreeItem key={c.path} node={c} depth={depth + 1} onSelect={onSelect} />
        ))}
      </div>
    );
  }
  return (
    <div
      className="flex items-center py-1.5 px-2 hover:bg-muted/50 cursor-pointer text-sm rounded-md"
      style={{ paddingLeft: `${depth * 14 + 24}px` }}
      onClick={() => onSelect(node.path)}
    >
      {getFileIcon(node.name)}
      <span className="truncate ml-2">{node.name}</span>
    </div>
  );
}

// ── AI status dot ─────────────────────────────────────────────────────────────
function StatusDot({ ai }: { ai: { isAvailable: boolean; hasSession: boolean } }) {
  return (
    <span className={`h-2 w-2 rounded-full shrink-0 ${
      !ai.isAvailable ? "bg-red-500" : ai.hasSession ? "bg-emerald-500" : "bg-amber-500"
    }`} />
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: aisData, isLoading: isLoadingAis } = useListAis({ query: { queryKey: getListAisQueryKey() } });

  const askAi = useAskAi();
  const askAiWithContext = useAskAiWithContext();
  const setModelMutation = useSetModel();

  const [selectedAi, setSelectedAi] = useState<string | null>(null);
  const [expandedModelPicker, setExpandedModelPicker] = useState<string | null>(null);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string; aiId?: string; error?: boolean }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);

  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const [showMobileAiPicker, setShowMobileAiPicker] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: treeData, isLoading: treeLoading } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }), enabled: isFilePickerOpen } }
  );
  const { data: attachedFileData } = useReadFile(
    { path: attachedFile || "" },
    { query: { enabled: !!attachedFile, queryKey: getReadFileQueryKey({ path: attachedFile || "" }) } }
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (aisData?.ais && !selectedAi) {
      const active = aisData.ais.find(a => a.hasSession);
      setSelectedAi((active ?? aisData.ais[0])?.id ?? null);
    }
  }, [aisData, selectedAi]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, executionResult]);

  const isPending = askAi.isPending || askAiWithContext.isPending;
  const currentAi = aisData?.ais.find(a => a.id === selectedAi);
  const activeModel = currentAi?.models?.find(m => m.id === currentAi.currentModel) ?? currentAi?.models?.[0];

  const clearAttachment = () => { setAttachedFile(null); setUploadedFile(null); };

  useEffect(() => {
    if (!showAttachMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-attach-menu]")) setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showAttachMenu]);

  const send = async (text: string) => {
    if (!text.trim() || !selectedAi || isPending) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    try {
      const payload = {
        aiId: selectedAi,
        prompt: text,
        conversationId: conversationId ?? undefined,
      };
      const fileContent = uploadedFile?.content ?? attachedFileData?.content;
      const filePath = uploadedFile?.name ?? attachedFile ?? "file";
      const result = fileContent
        ? await askAiWithContext.mutateAsync({ data: { ...payload, files: [{ path: filePath, content: fileContent }] } })
        : await askAi.mutateAsync({ data: payload });
      if (result.success) {
        setConversationId(result.conversationId);
        setMessages(prev => [...prev, { role: "assistant", content: result.response, aiId: result.aiId }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: result.error || "Failed", error: true }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Unexpected error.", error: true }]);
    }
  };

  const handleSend = () => { send(prompt); setPrompt(""); };

  const handleRegenerate = () => {
    const last = [...messages].reverse().find(m => m.role === "user");
    if (last) send(last.content);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const newChat = () => { setMessages([]); setConversationId(null); setExecutionResult(null); };

  return (
    <div className="flex h-full w-full overflow-hidden bg-background">

      {/* ── Desktop AI sidebar ──────────────────────────────────────────── */}
      <div className="hidden sm:flex w-56 shrink-0 flex-col border-r border-border bg-sidebar">
        <div className="px-3 py-3 border-b border-border/50 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-widest">Models</span>
          <button onClick={newChat} className="h-6 w-6 flex items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors" title="New chat">
            <PlusCircle className="h-4 w-4" />
          </button>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {isLoadingAis ? (
              <div className="py-6 text-center text-xs text-muted-foreground flex items-center justify-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />Loading
              </div>
            ) : aisData?.ais.map(ai => {
              const isSel = selectedAi === ai.id;
              const isExp = expandedModelPicker === ai.id;
              const mdl = ai.models?.find(m => m.id === ai.currentModel) ?? ai.models?.[0];
              return (
                <div key={ai.id} className="space-y-0.5">
                  <div className={`flex items-center gap-1 rounded-xl transition-all ${isSel ? "bg-primary/10" : "hover:bg-muted/50"}`}>
                    <button
                      className="flex items-center gap-2.5 flex-1 min-w-0 px-3 py-2.5 text-left"
                      onClick={() => setSelectedAi(ai.id)}
                    >
                      <StatusDot ai={ai} />
                      <p className={`text-sm font-medium truncate ${isSel ? "text-primary" : "text-foreground"}`}>{ai.name}</p>
                    </button>
                    {ai.models && ai.models.length > 0 && (
                      <button
                        className={`shrink-0 flex items-center gap-1 mr-2 px-2 py-1 rounded-lg text-[10px] font-mono font-medium transition-all border
                          ${isExp
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-muted/60 text-muted-foreground border-border hover:bg-muted hover:text-foreground"}`}
                        title="Switch model"
                        onClick={(e) => { e.stopPropagation(); setExpandedModelPicker(isExp ? null : ai.id); }}
                      >
                        <span className="max-w-[60px] truncate">{mdl?.name ?? "Model"}</span>
                        {isExp ? <ChevronUp className="h-2.5 w-2.5 shrink-0" /> : <ChevronDown className="h-2.5 w-2.5 shrink-0" />}
                      </button>
                    )}
                  </div>

                  {isExp && ai.models && (
                    <div className="mx-2 rounded-xl border border-border overflow-hidden bg-card shadow-sm">
                      {ai.models.map(m => (
                        <button
                          key={m.id}
                          className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs font-medium transition-colors
                            ${ai.currentModel === m.id
                              ? "bg-primary/10 text-primary"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModelMutation.mutate(
                              { data: { aiId: ai.id, modelId: m.id } },
                              {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
                                  setExpandedModelPicker(null);
                                  toast({ title: "Model updated", description: `Switched to ${m.name}` });
                                },
                                onError: () => {
                                  toast({ title: "Failed to switch model", description: "Could not update model on the server.", variant: "destructive" });
                                }
                              }
                            );
                          }}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ai.currentModel === m.id ? "bg-primary" : "bg-border"}`} />
                          {m.name}
                          {ai.currentModel === m.id && <Check className="h-3 w-3 ml-auto shrink-0" />}
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

      {/* ── Main chat area ──────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Mobile header */}
        <div className="sm:hidden flex items-center justify-between px-4 py-3 border-b border-border bg-background/80 backdrop-blur-sm shrink-0">
          <div className="flex items-center gap-2.5">
            <VesperLogo size={32} />
            <div>
              <p className="font-bold text-sm tracking-tight">Vesper</p>
              {currentAi && <p className="text-[10px] text-muted-foreground">{currentAi.name}{activeModel ? ` · ${activeModel.name}` : ""}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setShowMobileAiPicker(true)}
              className="flex items-center gap-1.5 bg-muted rounded-xl px-3 py-1.5 text-xs font-medium text-foreground"
            >
              {currentAi && <StatusDot ai={currentAi} />}
              {currentAi?.name ?? "Select AI"}
              <ChevronDown className="h-3 w-3" />
            </button>
            <button onClick={newChat} className="h-8 w-8 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted transition-colors">
              <PlusCircle className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto" ref={scrollRef}>
          {messages.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-center px-4 py-12">
              <VesperLogo size={64} />
              <h2 className="text-xl font-bold mt-5 mb-1 tracking-tight">Vesper</h2>
              <p className="text-xs text-muted-foreground mb-3 font-medium">by Skinopro Tech Solutions</p>
              <p className="text-sm text-muted-foreground max-w-xs">
                Route your coding prompts to ChatGPT, Grok, or Claude — pick a model and start chatting.
              </p>
              {currentAi && !currentAi.hasSession && (
                <div className="mt-5 flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs px-4 py-2.5 rounded-xl">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  No active session — go to Sessions to log in
                </div>
              )}
            </div>
          ) : (
            <div className="max-w-3xl mx-auto px-4 py-6 space-y-6 pb-4">
              {messages.map((msg, i) => (
                <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                  {msg.role === "assistant" && (
                    <div className="mt-0.5 shrink-0">
                      <VesperLogo size={32} />
                    </div>
                  )}
                  <div className={`max-w-[85%] sm:max-w-[80%] ${
                    msg.role === "user"
                      ? "bg-primary text-primary-foreground rounded-2xl rounded-tr-sm px-4 py-3"
                      : msg.error
                        ? "bg-red-950/30 border border-red-500/30 text-red-400 rounded-2xl rounded-tl-sm px-4 py-3"
                        : "text-foreground"
                  }`}>
                    {msg.role === "user" ? (
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                    ) : (
                      <div className="space-y-3">
                        {msg.aiId && (
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                              {aisData?.ais.find(a => a.id === msg.aiId)?.name ?? "AI"}
                            </span>
                          </div>
                        )}
                        <MarkdownRenderer content={msg.content} onCodeExecuted={setExecutionResult} />
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {isPending && (
                <div className="flex gap-3 justify-start">
                  <div className="shrink-0">
                    <VesperLogo size={32} />
                  </div>
                  <div className="bg-muted/50 rounded-2xl rounded-tl-sm px-4 py-3.5 flex items-center gap-1.5">
                    <span className="h-2 w-2 bg-primary rounded-full animate-bounce" />
                    <span className="h-2 w-2 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
                    <span className="h-2 w-2 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Code execution output */}
        {executionResult && (
          <div className="shrink-0 border-t border-border">
            <TerminalOutput result={executionResult} onClose={() => setExecutionResult(null)} />
          </div>
        )}

        {/* Input bar */}
        <div className="shrink-0 border-t border-border bg-background/80 backdrop-blur-sm px-3 sm:px-4 pt-3 pb-3">
          <div className="max-w-3xl mx-auto space-y-2">
            {/* Attachment badge */}
            {(attachedFile || uploadedFile) && (
              <div className="flex items-center gap-2 bg-primary/10 text-primary text-xs px-3 py-1.5 rounded-xl w-max max-w-full">
                <Paperclip className="h-3 w-3 shrink-0" />
                <span className="truncate max-w-[200px]">{uploadedFile?.name ?? attachedFile}</span>
                <button onClick={clearAttachment} className="ml-1 hover:text-foreground transition-colors">
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              className="hidden"
              accept=".txt,.md,.js,.ts,.tsx,.jsx,.py,.json,.yaml,.yml,.html,.css,.sh,.rs,.go,.java,.cpp,.c,.cs,.rb,.php,.swift,.kt,.sql,.toml,.env,.gitignore"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = (ev) => {
                  const content = ev.target?.result as string;
                  setUploadedFile({ name: file.name, content });
                  setAttachedFile(null);
                  setShowAttachMenu(false);
                };
                reader.readAsText(file);
                e.target.value = "";
              }}
            />

            <div className="flex items-end gap-2">
              {/* + Attach menu */}
              <div className="relative shrink-0" data-attach-menu>
                <button
                  onClick={() => setShowAttachMenu(prev => !prev)}
                  className={`h-10 w-10 flex items-center justify-center rounded-xl transition-colors ${showAttachMenu ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  title="Add attachment"
                >
                  <Plus className="h-5 w-5" />
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-12 left-0 z-50 min-w-[220px] rounded-2xl border border-border bg-popover shadow-lg p-1.5 space-y-0.5">
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition-colors text-left"
                      onClick={() => { fileInputRef.current?.click(); }}
                    >
                      <Upload className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium">Upload a file</p>
                        <p className="text-[11px] text-muted-foreground">From your device</p>
                      </div>
                    </button>
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition-colors text-left"
                      onClick={() => { setIsFilePickerOpen(true); setShowAttachMenu(false); }}
                    >
                      <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                      <div>
                        <p className="font-medium">From workspace</p>
                        <p className="text-[11px] text-muted-foreground">Attach a project file</p>
                      </div>
                    </button>
                  </div>
                )}
              </div>

              {/* Textarea */}
              <div className="flex-1 relative">
                <Textarea
                  ref={textareaRef}
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder={selectedAi ? "Message the AI... (Enter to send)" : "Select a model first..."}
                  className="min-h-[44px] max-h-48 resize-none bg-muted/40 border-border/50 focus-visible:ring-1 focus-visible:ring-primary rounded-xl text-sm py-3 pr-3"
                  disabled={isPending}
                  rows={1}
                />
              </div>

              {/* Regen + Send */}
              <div className="flex items-center gap-1 shrink-0">
                {messages.length > 0 && (
                  <button
                    onClick={handleRegenerate}
                    disabled={isPending}
                    className="h-10 w-10 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
                    title="Regenerate"
                  >
                    <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
                  </button>
                )}
                <button
                  onClick={handleSend}
                  disabled={!prompt.trim() || isPending || !selectedAi}
                  className="h-10 w-10 flex items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40 hover:bg-primary/90 transition-all shadow-sm"
                >
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>

            {currentAi && !currentAi.hasSession && (
              <p className="text-[11px] text-amber-500 flex items-center gap-1.5">
                <AlertCircle className="h-3 w-3" />
                No session — messages may fail. Add a session first.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Mobile AI picker sheet ──────────────────────────────────────── */}
      <Dialog open={showMobileAiPicker} onOpenChange={setShowMobileAiPicker}>
        <DialogContent className="sm:hidden max-w-sm">
          <DialogHeader>
            <DialogTitle>Select AI & Model</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {aisData?.ais.map(ai => {
              const isSel = selectedAi === ai.id;
              const isExp = expandedModelPicker === ai.id;
              const mdl = ai.models?.find(m => m.id === ai.currentModel) ?? ai.models?.[0];
              return (
                <div key={ai.id} className="space-y-1">
                  <div className={`flex items-center gap-2 rounded-xl border transition-all ${
                    isSel ? "bg-primary/10 border-primary/20" : "border-transparent hover:bg-muted"
                  }`}>
                    <button
                      className="flex items-center gap-3 flex-1 min-w-0 px-3 py-3 text-left"
                      onClick={() => { setSelectedAi(ai.id); setShowMobileAiPicker(false); setExpandedModelPicker(null); }}
                    >
                      <StatusDot ai={ai} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isSel ? "text-primary" : ""}`}>{ai.name}</p>
                        {mdl && <p className="text-xs text-muted-foreground font-mono">{mdl.name}</p>}
                      </div>
                      {isSel && <Check className="h-4 w-4 text-primary shrink-0" />}
                    </button>
                    {ai.models && ai.models.length > 1 && (
                      <button
                        className="shrink-0 pr-3 py-3 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => { e.stopPropagation(); setExpandedModelPicker(isExp ? null : ai.id); }}
                      >
                        {isExp ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                  {isExp && ai.models && (
                    <div className="ml-4 rounded-xl border border-border overflow-hidden bg-card">
                      {ai.models.map(m => (
                        <button
                          key={m.id}
                          className={`w-full flex items-center gap-2 px-3 py-2.5 text-sm transition-colors ${
                            ai.currentModel === m.id ? "bg-primary/10 text-primary font-medium" : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setModelMutation.mutate(
                              { data: { aiId: ai.id, modelId: m.id } },
                              {
                                onSuccess: () => {
                                  queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
                                  setExpandedModelPicker(null);
                                  toast({ title: "Model updated", description: `Switched to ${m.name}` });
                                },
                                onError: () => {
                                  toast({ title: "Failed to switch model", description: "Could not update model on the server.", variant: "destructive" });
                                }
                              }
                            );
                          }}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ai.currentModel === m.id ? "bg-primary" : "bg-border"}`} />
                          {m.name}
                          {ai.currentModel === m.id && <Check className="h-3 w-3 ml-auto shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── File picker dialog ──────────────────────────────────────────── */}
      <Dialog open={isFilePickerOpen} onOpenChange={setIsFilePickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Attach a File</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-72 border border-border rounded-xl bg-muted/20">
            <div className="p-2">
              {treeLoading ? (
                <div className="flex justify-center p-6"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
              ) : treeData?.tree ? (
                <MiniFileTreeItem node={treeData.tree} onSelect={p => { setAttachedFile(p); setUploadedFile(null); setIsFilePickerOpen(false); }} />
              ) : (
                <p className="text-xs text-muted-foreground text-center p-6">No files found</p>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
