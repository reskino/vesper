import { useState, useRef, useEffect, useCallback } from "react";
import {
  useListAis, getListAisQueryKey,
  useAskAi, useAskAiWithContext,
  useGetFileTree, getGetFileTreeQueryKey,
  useReadFile, getReadFileQueryKey,
  FileNode,
} from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import {
  Send, PlusCircle, Paperclip, X, Folder, FileIcon, FileCode,
  FileText, FileJson, ChevronRight, ChevronDown, Loader2,
  RefreshCw, AlertCircle, Upload, Zap, Copy, Check, MessageSquare,
} from "lucide-react";
import { VesperLogo } from "@/components/vesper-logo";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TerminalOutput } from "@/components/chat/terminal-output";
import { useIDE } from "@/contexts/ide-context";

// ── File icon helper ──────────────────────────────────────────────────────────
const getFileIcon = (name: string) => {
  if (/\.(js|ts|jsx|tsx)$/.test(name)) return <FileCode className="h-3.5 w-3.5 text-blue-400" />;
  if (/\.json$/.test(name)) return <FileJson className="h-3.5 w-3.5 text-yellow-400" />;
  if (/\.md$/.test(name)) return <FileText className="h-3.5 w-3.5 text-[#52526e]" />;
  return <FileIcon className="h-3.5 w-3.5 text-[#52526e]" />;
};

// ── Mini file tree ─────────────────────────────────────────────────────────────
function MiniFileTreeItem({ node, depth = 0, onSelect }: { node: FileNode; depth?: number; onSelect: (p: string) => void }) {
  const [expanded, setExpanded] = useState(depth === 0);
  if (node.name.startsWith(".")) return null;
  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-1 px-2 hover:bg-[#141420] cursor-pointer text-sm rounded"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3 w-3 mr-1 text-[#52526e]" /> : <ChevronRight className="h-3 w-3 mr-1 text-[#52526e]" />}
          <Folder className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
          <span className="truncate text-[12px]">{node.name}</span>
        </div>
        {expanded && node.children?.map(c => <MiniFileTreeItem key={c.path} node={c} depth={depth + 1} onSelect={onSelect} />)}
      </div>
    );
  }
  return (
    <div
      className="flex items-center py-1 px-2 hover:bg-[#141420] cursor-pointer rounded"
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      onClick={() => onSelect(node.path)}
    >
      {getFileIcon(node.name)}
      <span className="truncate ml-1.5 text-[12px] text-[#a0a0c0]">{node.name}</span>
    </div>
  );
}

// ── Typewriter ─────────────────────────────────────────────────────────────────
const PHRASES = [
  "Ask anything, build anything.",
  "Debug your code in seconds.",
  "Write, review and ship faster.",
  "Turn ideas into working code.",
  "Access ChatGPT, Claude & Grok in one place.",
];

function TypewriterText() {
  const [displayed, setDisplayed] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [typing, setTyping] = useState(true);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const phrase = PHRASES[phraseIdx];
    if (paused) { const t = setTimeout(() => { setPaused(false); setTyping(false); }, 1800); return () => clearTimeout(t); }
    if (typing) {
      if (displayed.length < phrase.length) { const t = setTimeout(() => setDisplayed(phrase.slice(0, displayed.length + 1)), 45); return () => clearTimeout(t); }
      else setPaused(true);
    } else {
      if (displayed.length > 0) { const t = setTimeout(() => setDisplayed(d => d.slice(0, -1)), 22); return () => clearTimeout(t); }
      else { setPhraseIdx(i => (i + 1) % PHRASES.length); setTyping(true); }
    }
  }, [displayed, typing, paused, phraseIdx]);
  return (
    <p className="text-[#52526e] text-sm min-h-[1.5rem]">
      {displayed}<span className="inline-block w-0.5 h-[1em] bg-primary ml-0.5 align-middle animate-pulse" />
    </p>
  );
}

// ── Quick prompts ──────────────────────────────────────────────────────────────
const QUICK_PROMPTS = [
  "Explain this code",
  "Fix the bug in my code",
  "Write unit tests",
  "Refactor for readability",
  "Create a Flask REST API",
  "Optimize performance",
];

// ── Message bubble ─────────────────────────────────────────────────────────────
function MessageBubble({ msg, onExecute }: {
  msg: { role: "user" | "assistant"; content: string; aiId?: string; error?: boolean };
  onExecute?: (result: any) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(msg.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (msg.role === "user") {
    return (
      <div className="flex justify-end px-3 py-1">
        <div className="max-w-[85%] bg-[#1e1e2e] border border-[#2a2a40] rounded-2xl rounded-tr-sm px-3.5 py-2.5 text-sm text-foreground leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="px-3 py-1 group">
      <div className={`text-sm leading-relaxed ${msg.error ? "text-red-400" : "text-foreground"}`}>
        {msg.error ? (
          <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{msg.content}</span>
          </div>
        ) : (
          <MarkdownRenderer content={msg.content} onExecute={onExecute} />
        )}
      </div>
      <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
        {msg.aiId && (
          <span className="text-[10px] text-[#3a3a5c] font-mono">{msg.aiId}</span>
        )}
        <button onClick={copy} className="h-5 w-5 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors">
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        </button>
      </div>
    </div>
  );
}

// ── Main chat panel ────────────────────────────────────────────────────────────
export function ChatPanel({ newChatKey }: { newChatKey: number }) {
  const { selectedAi, setSelectedAi } = useIDE();
  const { toast } = useToast();
  const { data: aisData } = useListAis({
    query: { queryKey: getListAisQueryKey(), staleTime: 15_000, refetchInterval: 30_000 },
  });

  const askAi = useAskAi();
  const askAiWithContext = useAskAiWithContext();

  const [prompt, setPrompt] = useState("");
  const [messages, setMessages] = useState<Array<{ role: "user" | "assistant"; content: string; aiId?: string; error?: boolean }>>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [executionResult, setExecutionResult] = useState<any>(null);
  const [attachedFile, setAttachedFile] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; content: string } | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen] = useState(false);
  const [showAttachMenu, setShowAttachMenu] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reset on new chat
  useEffect(() => {
    if (newChatKey === 0) return;
    setMessages([]); setConversationId(null); setExecutionResult(null);
    setAttachedFile(null); setUploadedFile(null); setPrompt("");
  }, [newChatKey]);

  const { data: treeData } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }), enabled: isFilePickerOpen } }
  );
  const { data: attachedFileData } = useReadFile(
    { path: attachedFile || "" },
    { query: { enabled: !!attachedFile, queryKey: getReadFileQueryKey({ path: attachedFile || "" }) } }
  );

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, executionResult]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const close = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-attach-menu]")) setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showAttachMenu]);

  const isPending = askAi.isPending || askAiWithContext.isPending;
  const isAuto = selectedAi === "__auto__";
  const connectedAis = aisData?.ais?.filter((a: any) => a.hasSession) ?? [];
  const clearAttachment = () => { setAttachedFile(null); setUploadedFile(null); };

  const send = async (text: string) => {
    if (!text.trim() || isPending) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    try {
      const effectiveAiId = isAuto
        ? (aisData?.ais?.find((a: any) => a.hasSession)?.id ?? "pollinations")
        : selectedAi;
      const payload = { aiId: effectiveAiId, prompt: text, conversationId: conversationId ?? undefined, fallback: isAuto };
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
      setMessages(prev => [...prev, { role: "assistant", content: "Unexpected error. Please try again.", error: true }]);
    }
  };

  const handleSend = () => { send(prompt); setPrompt(""); clearAttachment(); };
  const handleRegen = () => { const last = [...messages].reverse().find(m => m.role === "user"); if (last) send(last.content); };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      setUploadedFile({ name: file.name, content: ev.target?.result as string });
      setShowAttachMenu(false);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const attachment = uploadedFile?.name ?? attachedFile;

  return (
    <div className="flex flex-col h-full bg-[#0d0d12] border-l border-[#1a1a24]">
      {/* Chat header */}
      <div className="shrink-0 flex items-center justify-between px-3 h-9 border-b border-[#1a1a24] bg-[#0a0a0c]">
        <div className="flex items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-[#52526e]" />
          <span className="text-xs font-bold text-[#52526e] uppercase tracking-wider">Chat</span>
          {isAuto && connectedAis.length > 0 && (
            <span className="text-[10px] bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-1.5 py-0.5 rounded font-bold">
              {connectedAis.length} AI{connectedAis.length > 1 ? "s" : ""} ready
            </span>
          )}
        </div>
        {messages.length > 0 && (
          <button
            onClick={handleRegen}
            disabled={isPending}
            className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420] disabled:opacity-40 transition-colors"
            title="Regenerate"
          ><RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} /></button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-2" ref={scrollRef}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 px-4 text-center">
            <div className="relative">
              <div className="absolute inset-0 blur-2xl bg-primary/20 rounded-full scale-[2] opacity-50" />
              <VesperLogo size={40} />
            </div>
            <TypewriterText />

            {/* Quick prompts */}
            <div className="w-full max-w-xs space-y-1.5 mt-2">
              {QUICK_PROMPTS.map(p => (
                <button
                  key={p}
                  onClick={() => { send(p); }}
                  className="w-full text-left text-xs px-3 py-2 rounded-lg bg-[#141420] hover:bg-[#1e1e2e] border border-[#1a1a24] text-[#8080a0] hover:text-foreground transition-all"
                >{p}</button>
              ))}
            </div>

            {isAuto && connectedAis.length === 0 && (
              <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-400 text-xs max-w-xs">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>No AI connected. Go to Sessions → add an API key. Pollinations AI is always free.</span>
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-1">
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onExecute={setExecutionResult} />
            ))}
            {executionResult && (
              <div className="px-3 py-1">
                <TerminalOutput result={executionResult} />
              </div>
            )}
            {isPending && (
              <div className="flex items-center gap-2 px-4 py-2 text-[#52526e] text-xs">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span className="animate-pulse">Thinking…</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Attachment bar */}
      {attachment && (
        <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-[#141420] border-t border-[#1a1a24] text-xs">
          <Paperclip className="h-3 w-3 text-primary shrink-0" />
          <span className="flex-1 truncate text-[#a0a0c0] font-mono">{attachment}</span>
          <button onClick={clearAttachment} className="text-[#52526e] hover:text-red-400 transition-colors">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* File picker */}
      {isFilePickerOpen && (
        <div className="shrink-0 border-t border-[#1a1a24] bg-[#0a0a0c] max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a24]">
            <span className="text-[10px] font-bold text-[#52526e] uppercase">Attach from workspace</span>
            <button onClick={() => setIsFilePickerOpen(false)} className="text-[#52526e] hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {treeData?.tree ? (
            <MiniFileTreeItem node={treeData.tree} onSelect={p => { setAttachedFile(p); setIsFilePickerOpen(false); }} />
          ) : (
            <div className="flex items-center justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-[#52526e]" /></div>
          )}
        </div>
      )}

      {/* Input area */}
      <div className="shrink-0 px-3 py-2.5 border-t border-[#1a1a24] bg-[#0a0a0c]">
        <div className="relative flex items-end gap-2 bg-[#141420] border border-[#1e1e2e] focus-within:border-primary/40 rounded-xl transition-colors">
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={isPending ? "Waiting for response…" : "Ask anything… (Enter to send, Shift+Enter for newline)"}
            disabled={isPending}
            className="flex-1 bg-transparent resize-none outline-none text-sm text-foreground placeholder:text-[#3a3a5c] py-2.5 pl-3 max-h-32 min-h-[40px] leading-relaxed"
            style={{ height: "auto" }}
            onInput={e => {
              const t = e.target as HTMLTextAreaElement;
              t.style.height = "auto";
              t.style.height = Math.min(t.scrollHeight, 128) + "px";
            }}
          />
          <div className="flex items-center gap-1 pr-2 pb-2 shrink-0">
            {/* Attach */}
            <div className="relative" data-attach-menu>
              <button
                onClick={() => setShowAttachMenu(o => !o)}
                className="h-7 w-7 flex items-center justify-center rounded-lg text-[#52526e] hover:text-foreground hover:bg-[#1e1e2e] transition-colors"
                title="Attach file"
              ><Paperclip className="h-3.5 w-3.5" /></button>
              {showAttachMenu && (
                <div className="absolute bottom-9 right-0 z-50 bg-[#0d0d12] border border-[#1a1a24] rounded-xl shadow-xl p-1 min-w-[160px]" data-attach-menu>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg text-[#a0a0c0] hover:bg-[#141420] transition-colors"
                    onClick={() => { setIsFilePickerOpen(true); setShowAttachMenu(false); }}
                  ><Folder className="h-3.5 w-3.5 text-blue-400" /> From workspace</button>
                  <button
                    className="w-full flex items-center gap-2.5 px-3 py-2 text-sm rounded-lg text-[#a0a0c0] hover:bg-[#141420] transition-colors"
                    onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                  ><Upload className="h-3.5 w-3.5 text-emerald-400" /> Upload file</button>
                </div>
              )}
            </div>
            {/* Send */}
            <button
              onClick={handleSend}
              disabled={isPending || !prompt.trim()}
              className="h-7 w-7 flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/80 disabled:opacity-40 transition-all"
            >
              {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        <input ref={fileInputRef} type="file" className="hidden" accept="*/*" onChange={handleFileUpload} />
      </div>
    </div>
  );
}

