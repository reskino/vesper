import { useState, useRef, useEffect, useCallback } from "react";
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
  ChevronDown as Caret, Zap, Cpu,
} from "lucide-react";
import { VesperLogo } from "@/components/vesper-logo";
import { useQueryClient } from "@tanstack/react-query";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TerminalOutput } from "@/components/chat/terminal-output";

// ── Model tier badge ──────────────────────────────────────────────────────────
function ModelTierBadge({ tier }: { tier?: string }) {
  if (!tier || tier === "free") {
    return (
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
        Free
      </span>
    );
  }
  if (tier === "pro") {
    return (
      <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20">
        Pro
      </span>
    );
  }
  return (
    <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-400 border border-violet-500/20">
      Plus
    </span>
  );
}

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

// ── Typewriter ────────────────────────────────────────────────────────────────
const TYPEWRITER_PHRASES = [
  "Design anything using Vesper.",
  "Create an app seamlessly with Vesper.",
  "Debug your code in seconds with Vesper.",
  "Build full-stack apps with AI assistance.",
  "Write, review and ship code faster.",
  "Explore any codebase with Vesper.",
  "Automate your coding workflow with Vesper.",
  "Generate beautiful UI components effortlessly.",
  "Solve bugs instantly using Vesper.",
  "Turn ideas into working code with Vesper.",
  "Collaborate with ChatGPT, Grok and Claude at once.",
  "Build your dream project — one prompt at a time.",
];

function TypewriterText() {
  const [displayed, setDisplayed] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [typing, setTyping] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const phrase = TYPEWRITER_PHRASES[phraseIdx];
    if (paused) {
      const t = setTimeout(() => { setPaused(false); setTyping(false); }, 1800);
      return () => clearTimeout(t);
    }
    if (typing) {
      if (displayed.length < phrase.length) {
        const t = setTimeout(() => setDisplayed(phrase.slice(0, displayed.length + 1)), 45);
        return () => clearTimeout(t);
      } else { setPaused(true); }
    } else {
      if (displayed.length > 0) {
        const t = setTimeout(() => setDisplayed(d => d.slice(0, -1)), 22);
        return () => clearTimeout(t);
      } else { setPhraseIdx(i => (i + 1) % TYPEWRITER_PHRASES.length); setTyping(true); }
    }
  }, [displayed, typing, paused, phraseIdx]);

  return (
    <p className="text-muted-foreground max-w-xs min-h-[1.5rem] text-base">
      {displayed}
      <span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 align-middle animate-pulse" />
    </p>
  );
}

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ ai }: { ai: { isAvailable: boolean; hasSession: boolean } }) {
  return (
    <span className={`h-2 w-2 rounded-full shrink-0 ${
      !ai.isAvailable ? "bg-red-500" : ai.hasSession ? "bg-emerald-500" : "bg-amber-500"
    }`} />
  );
}

const AUTO_AI_ID = "__auto__";

// ── AI + Model selector dropdown ─────────────────────────────────────────────
function ModelSelectorDropdown({
  ais,
  selectedAi,
  usernames,
  onSelectAi,
  onSelectModel,
}: {
  ais: any[];
  selectedAi: string;
  usernames: Record<string, string>;
  onSelectAi: (id: string) => void;
  onSelectModel: (aiId: string, modelId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [expandedAi, setExpandedAi] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const isAuto = selectedAi === AUTO_AI_ID;
  const currentAi = isAuto ? null : ais.find(a => a.id === selectedAi);
  const activeModel = currentAi?.models?.find((m: any) => m.id === currentAi.currentModel) ?? currentAi?.models?.[0];
  const anyConnected = ais.some(a => a.hasSession);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-xl hover:bg-muted transition-colors text-sm font-semibold text-foreground"
      >
        {isAuto ? (
          <>
            <span className={`h-2 w-2 rounded-full shrink-0 ${anyConnected ? "bg-emerald-500" : "bg-primary animate-pulse"}`} />
            <span>Auto</span>
            <span className="text-xs font-normal text-muted-foreground hidden sm:inline">· Best available</span>
          </>
        ) : (
          <>
            {currentAi && <StatusDot ai={currentAi} />}
            <span>{currentAi?.name ?? "Select AI"}</span>
            {activeModel && (
              <span className="text-xs font-normal text-muted-foreground hidden sm:inline">
                · {activeModel.name}
              </span>
            )}
          </>
        )}
        <Caret className="h-3.5 w-3.5 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-72 z-50 rounded-2xl border border-border bg-popover shadow-xl overflow-hidden">
          <div className="p-1.5 space-y-0.5">

            {/* Auto option */}
            <div
              className={`flex items-center gap-2.5 rounded-xl transition-colors cursor-pointer ${
                isAuto ? "bg-primary/10" : "hover:bg-muted/60"
              }`}
              onClick={() => { onSelectAi(AUTO_AI_ID); setOpen(false); setExpandedAi(null); }}
            >
              <div className="flex items-center gap-2.5 flex-1 px-3 py-2.5">
                <Zap className={`h-3.5 w-3.5 shrink-0 ${isAuto ? "text-primary" : "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isAuto ? "text-primary" : "text-foreground"}`}>Auto</p>
                  <p className="text-[10px] text-muted-foreground">Uses best available AI with fallback</p>
                </div>
                {isAuto && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
              </div>
            </div>

            {/* Divider */}
            <div className="mx-2 border-t border-border my-1" />
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Direct — no fallback</p>

            {ais.map(ai => {
              const isSel = !isAuto && selectedAi === ai.id;
              const isExp = expandedAi === ai.id;
              const mdl = ai.models?.find((m: any) => m.id === ai.currentModel) ?? ai.models?.[0];

              return (
                <div key={ai.id}>
                  <div
                    className={`flex items-center gap-2.5 rounded-xl transition-colors ${
                      isSel ? "bg-primary/10" : "hover:bg-muted/60"
                    }`}
                  >
                    <button
                      className="flex items-center gap-2.5 flex-1 px-3 py-2.5 text-left"
                      onClick={() => { onSelectAi(ai.id); setOpen(false); setExpandedAi(null); }}
                    >
                      <StatusDot ai={ai} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isSel ? "text-primary" : "text-foreground"}`}>{ai.name}</p>
                        {ai.hasSession && usernames[ai.id] ? (
                          <p className="text-[10px] text-emerald-500 truncate">{usernames[ai.id]}</p>
                        ) : mdl ? (
                          <p className="text-[10px] text-muted-foreground font-mono truncate">{mdl.name}</p>
                        ) : (
                          <p className="text-[10px] text-amber-500/80 truncate">Not connected</p>
                        )}
                      </div>
                      {isSel && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                    </button>

                    {ai.models && ai.models.length > 1 && (
                      <button
                        className="pr-3 py-3 text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => { e.stopPropagation(); setExpandedAi(isExp ? null : ai.id); }}
                      >
                        {isExp ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>

                  {isExp && ai.models && (
                    <div className="ml-3 mr-2 mb-1 rounded-xl border border-border overflow-hidden bg-card">
                      {ai.models.map((m: any) => (
                        <button
                          key={m.id}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                            ai.currentModel === m.id
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                          }`}
                          onClick={(e) => {
                            e.stopPropagation();
                            onSelectModel(ai.id, m.id);
                            setOpen(false);
                            setExpandedAi(null);
                          }}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${ai.currentModel === m.id ? "bg-primary" : "bg-border"}`} />
                          <span className="flex-1 text-left">{m.name}</span>
                          <ModelTierBadge tier={(m as any).tier} />
                          {ai.currentModel === m.id && <Check className="h-3 w-3 ml-1 shrink-0" />}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export function Home() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: aisData, isLoading: isLoadingAis } = useListAis({
    query: {
      queryKey: getListAisQueryKey(),
      refetchOnWindowFocus: true,
      refetchOnMount: true,
      staleTime: 15_000,
      refetchInterval: 30_000,
    },
  });

  const askAi = useAskAi();
  const askAiWithContext = useAskAiWithContext();
  const setModelMutation = useSetModel();

  const [selectedAi, setSelectedAi] = useState<string>(AUTO_AI_ID);
  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string; aiId?: string; error?: boolean }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);

  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [usernames, setUsernames] = useState<Record<string, string>>({});

  const verifySession = useCallback(async (aiId: string) => {
    try {
      const res = await fetch(`/api/sessions/verify/${aiId}`);
      const data = await res.json();
      if (data.success && data.username) {
        setUsernames(prev => ({ ...prev, [aiId]: data.username }));
      }
    } catch { }
  }, []);

  useEffect(() => {
    const ais = aisData?.ais ?? [];
    ais.filter((ai: any) => ai.hasSession).forEach((ai: any) => verifySession(ai.id));
  }, [aisData, verifySession]);

  const { data: treeData } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }), enabled: isFilePickerOpen } }
  );
  const { data: attachedFileData } = useReadFile(
    { path: attachedFile || "" },
    { query: { enabled: !!attachedFile, queryKey: getReadFileQueryKey({ path: attachedFile || "" }) } }
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // No longer auto-selecting — default is Auto mode

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, executionResult]);

  const isPending = askAi.isPending || askAiWithContext.isPending;
  const isAutoMode = selectedAi === AUTO_AI_ID;
  const currentAi = isAutoMode ? null : aisData?.ais?.find((a: any) => a.id === selectedAi);
  const connectedAis = aisData?.ais?.filter((a: any) => a.hasSession) ?? [];
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
    if (!text.trim() || isPending) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    try {
      const isAutoMode = selectedAi === AUTO_AI_ID;
      // In Auto mode, start from first connected AI (or pollinations), allow fallback.
      // In Direct mode, use exactly the selected AI, no fallback.
      const effectiveAiId = isAutoMode
        ? (aisData?.ais?.find((a: any) => a.hasSession)?.id ?? "pollinations")
        : selectedAi;
      const payload = {
        aiId: effectiveAiId,
        prompt: text,
        conversationId: conversationId ?? undefined,
        fallback: isAutoMode,
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

  const handleSend = () => { send(prompt); setPrompt(""); clearAttachment(); };
  const handleRegenerate = () => {
    const last = [...messages].reverse().find(m => m.role === "user");
    if (last) send(last.content);
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };
  const newChat = () => { setMessages([]); setConversationId(null); setExecutionResult(null); };

  const handleSelectModel = (aiId: string, modelId: string) => {
    setModelMutation.mutate(
      { data: { aiId, modelId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
          const ai = aisData?.ais?.find((a: any) => a.id === aiId);
          const m = ai?.models?.find((m: any) => m.id === modelId);
          toast({ title: "Model updated", description: `Switched to ${m?.name ?? modelId}` });
        },
        onError: () => {
          toast({ title: "Failed to switch model", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="flex flex-col h-full w-full overflow-hidden bg-background">

      {/* ── Top bar ──────────────────────────────────────────────────────── */}
      <header className="shrink-0 flex items-center justify-between px-4 h-14 border-b border-border bg-background/80 backdrop-blur-sm">
        {/* Left: new chat */}
        <button
          onClick={newChat}
          className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
          title="New chat"
        >
          <PlusCircle className="h-5 w-5" />
          <span className="text-sm hidden sm:inline">New chat</span>
        </button>

        {/* Center: model selector */}
        <div className="flex items-center justify-center">
          {isLoadingAis ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading…
            </div>
          ) : (
            <ModelSelectorDropdown
              ais={aisData?.ais ?? []}
              selectedAi={selectedAi}
              usernames={usernames}
              onSelectAi={setSelectedAi}
              onSelectModel={handleSelectModel}
            />
          )}
        </div>

        {/* Right: regen */}
        <div className="flex items-center gap-1">
          {messages.length > 0 && (
            <button
              onClick={handleRegenerate}
              disabled={isPending}
              className="h-9 w-9 flex items-center justify-center rounded-xl text-muted-foreground hover:text-foreground hover:bg-muted transition-colors disabled:opacity-40"
              title="Regenerate last response"
            >
              <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
            </button>
          )}
        </div>
      </header>

      {/* ── Messages ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        {messages.length === 0 ? (
          /* Empty state */
          <div className="h-full flex flex-col items-center justify-center text-center px-4 py-12 gap-4">
            <VesperLogo size={60} />
            <div>
              <h2 className="text-2xl font-bold tracking-tight">Vesper</h2>
              <p className="text-xs text-muted-foreground mt-1">by Skinopro Tech Solutions</p>
            </div>
            <TypewriterText />

            {/* Session status card */}
            {isAutoMode && connectedAis.length > 0 && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-4 py-2.5 rounded-xl">
                <Zap className="h-3.5 w-3.5 shrink-0" />
                Auto mode · {connectedAis.length} AI{connectedAis.length > 1 ? "s" : ""} ready ({connectedAis.map((a: any) => a.name).join(", ")})
              </div>
            )}
            {isAutoMode && connectedAis.length === 0 && (
              <div className="flex items-center gap-2 bg-primary/10 border border-primary/20 text-primary text-xs px-4 py-2.5 rounded-xl">
                <Zap className="h-3.5 w-3.5 shrink-0" />
                Auto mode · Using Pollinations (free, no key needed)
              </div>
            )}
            {!isAutoMode && currentAi && currentAi.hasSession && usernames[currentAi.id] && (
              <div className="flex items-center gap-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs px-4 py-2.5 rounded-xl">
                <svg className="h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                </svg>
                {currentAi.name} · signed in as <strong className="font-semibold ml-1">{usernames[currentAi.id]}</strong>
              </div>
            )}
            {!isAutoMode && currentAi && !currentAi.hasSession && (
              <div className="flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 text-amber-500 text-xs px-4 py-2.5 rounded-xl">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {currentAi.name} not connected — add your API key in Sessions
              </div>
            )}

            {/* Quick suggestion chips */}
            <div className="flex flex-wrap justify-center gap-2 mt-2 max-w-md">
              {["Explain this code", "Write a Python script", "Fix this bug", "Create a React component"].map(s => (
                <button
                  key={s}
                  onClick={() => { setPrompt(s); textareaRef.current?.focus(); }}
                  className="px-3 py-1.5 rounded-full border border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="max-w-3xl mx-auto px-4 pt-6 pb-4 space-y-6">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="mt-1 shrink-0">
                    <VesperLogo size={28} />
                  </div>
                )}
                <div className={`max-w-[88%] sm:max-w-[82%] ${
                  msg.role === "user"
                    ? "bg-muted text-foreground rounded-2xl rounded-br-md px-4 py-3"
                    : msg.error
                      ? "bg-red-950/30 border border-red-500/30 text-red-400 rounded-2xl rounded-tl-md px-4 py-3"
                      : "text-foreground"
                }`}>
                  {msg.role === "user" ? (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{msg.content}</p>
                  ) : (
                    <div className="space-y-2">
                      {msg.aiId && (
                        <span className="text-[10px] font-mono font-semibold text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                          {aisData?.ais?.find((a: any) => a.id === msg.aiId)?.name ?? "AI"}
                        </span>
                      )}
                      <MarkdownRenderer content={msg.content} onCodeExecuted={setExecutionResult} />
                    </div>
                  )}
                </div>
              </div>
            ))}

            {isPending && (
              <div className="flex gap-3 justify-start">
                <div className="shrink-0 mt-1"><VesperLogo size={28} /></div>
                <div className="flex items-center gap-1.5 py-3">
                  <span className="h-2 w-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                  <span className="h-2 w-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                  <span className="h-2 w-2 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Code execution output ─────────────────────────────────────────── */}
      {executionResult && (
        <div className="shrink-0 border-t border-border">
          <TerminalOutput result={executionResult} onClose={() => setExecutionResult(null)} />
        </div>
      )}

      {/* ── Input area ───────────────────────────────────────────────────── */}
      <div className="shrink-0 px-3 sm:px-4 pt-3 pb-4 bg-background/80 backdrop-blur-sm">
        <div className="max-w-3xl mx-auto">
          {/* Attachment badge */}
          {(attachedFile || uploadedFile) && (
            <div className="flex items-center gap-2 bg-primary/10 text-primary text-xs px-3 py-1.5 rounded-xl w-max max-w-full mb-2">
              <Paperclip className="h-3 w-3 shrink-0" />
              <span className="truncate max-w-[200px]">{uploadedFile?.name ?? attachedFile}</span>
              <button onClick={clearAttachment} className="ml-1 hover:text-foreground transition-colors">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Main input box */}
          <div className="relative rounded-2xl border border-border bg-muted/30 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/20 transition-all shadow-sm">
            <Textarea
              ref={textareaRef}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isAutoMode ? "Message any AI…" : `Message ${currentAi?.name ?? "AI"} directly…`}
              className="min-h-[52px] max-h-52 resize-none bg-transparent border-none shadow-none focus-visible:ring-0 text-sm py-4 px-4 pr-14 rounded-2xl"
              disabled={isPending}
              rows={1}
            />

            {/* Send button — inside input, bottom-right */}
            <button
              onClick={handleSend}
              disabled={!prompt.trim() || isPending}
              className="absolute right-3 bottom-3 h-8 w-8 flex items-center justify-center rounded-lg bg-primary text-primary-foreground disabled:opacity-30 hover:bg-primary/90 transition-all shadow-sm"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>

            {/* Bottom toolbar inside box */}
            <div className="flex items-center gap-1 px-3 pb-2.5 pt-0">
              {/* Attach menu */}
              <div className="relative" data-attach-menu>
                <button
                  onClick={() => setShowAttachMenu(prev => !prev)}
                  className={`h-7 w-7 flex items-center justify-center rounded-lg transition-colors ${showAttachMenu ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                  title="Add attachment"
                >
                  <Plus className="h-4 w-4" />
                </button>
                {showAttachMenu && (
                  <div className="absolute bottom-9 left-0 z-50 min-w-[210px] rounded-2xl border border-border bg-popover shadow-lg p-1.5 space-y-0.5">
                    <button
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-foreground hover:bg-muted transition-colors text-left"
                      onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
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

              {/* Session status hint */}
              <div className="flex-1 px-1">
                {isAutoMode && connectedAis.length > 0 && (
                  <p className="text-[10px] text-emerald-500/80 flex items-center gap-1">
                    <Zap className="h-3 w-3 shrink-0" />
                    Auto · {connectedAis.map((a: any) => a.name).join(", ")}
                  </p>
                )}
                {isAutoMode && connectedAis.length === 0 && (
                  <p className="text-[10px] text-primary/70 flex items-center gap-1">
                    <Zap className="h-3 w-3 shrink-0" />
                    Auto · Pollinations (free)
                  </p>
                )}
                {!isAutoMode && currentAi && !currentAi.hasSession && (
                  <p className="text-[10px] text-amber-500 flex items-center gap-1">
                    <AlertCircle className="h-3 w-3 shrink-0" />
                    {currentAi.name} not connected — will return error
                  </p>
                )}
                {!isAutoMode && currentAi && currentAi.hasSession && usernames[currentAi.id] && (
                  <p className="text-[10px] text-emerald-500/80 flex items-center gap-1">
                    <svg className="h-3 w-3 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" />
                    </svg>
                    {currentAi.name} · {usernames[currentAi.id]}
                  </p>
                )}
              </div>

              <span className="text-[10px] text-muted-foreground/50 hidden sm:inline">Enter to send · Shift+Enter for newline</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Hidden file input ────────────────────────────────────────────── */}
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
            setUploadedFile({ name: file.name, content: ev.target?.result as string });
            setAttachedFile(null);
            setShowAttachMenu(false);
          };
          reader.readAsText(file);
          e.target.value = "";
        }}
      />

      {/* ── File picker dialog ───────────────────────────────────────────── */}
      <Dialog open={isFilePickerOpen} onOpenChange={setIsFilePickerOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Attach a File</DialogTitle>
          </DialogHeader>
          <ScrollArea className="h-72 border border-border rounded-xl bg-muted/20">
            <div className="p-2">
              {treeData?.tree ? (
                <MiniFileTreeItem
                  node={treeData.tree}
                  onSelect={(p) => {
                    setAttachedFile(p);
                    setUploadedFile(null);
                    setIsFilePickerOpen(false);
                  }}
                />
              ) : (
                <div className="py-8 text-center text-sm text-muted-foreground">Loading file tree…</div>
              )}
            </div>
          </ScrollArea>
        </DialogContent>
      </Dialog>
    </div>
  );
}
