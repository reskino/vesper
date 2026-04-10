/**
 * ChatPanel — full-screen mobile chat + desktop side-panel.
 *
 * Mobile features:
 *   • Full-height scroll area with distinct user/AI bubbles
 *   • Horizontal-scrolling quick-prompt chips on empty state
 *   • Fixed bottom input bar (growing textarea, Send, Attach, model indicator)
 *   • Shift+Enter for newline, Enter to send
 *   • 48 px min touch targets, 16 px base font
 *   • iOS safe-area padding
 *
 * Imported project:
 *   • If the user has imported a local folder via the Files panel, its contents
 *     are automatically included in every AI request as rich file context.
 *   • A dismissible banner in the input bar shows the attached project name.
 *
 * Props:
 *   newChatKey  — bump to clear the chat
 *   compact     — true inside the mobile bottom-sheet (no outer border)
 */
import { useState, useRef, useEffect, useCallback, type ElementType } from "react";
import {
  useListAis, getListAisQueryKey,
  useAskAi, useAskAiWithContext,
  useGetFileTree, getGetFileTreeQueryKey,
  useReadFile, getReadFileQueryKey,
  FileNode,
} from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Send, Paperclip, X, Folder, FileIcon, FileCode,
  FileText, FileJson, ChevronRight, ChevronDown, Loader2,
  AlertCircle, Upload, Copy, Check, RotateCcw, Sparkles,
  FolderOpen, Search, Bug, FlaskConical, Globe, Code2,
  BookOpen, Zap, ArrowRight, ChevronsRight,
} from "lucide-react";
import { VesperLogo } from "@/components/vesper-logo";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { TerminalOutput } from "@/components/chat/terminal-output";
import { useIDE } from "@/contexts/ide-context";
import { ArrowUpRight } from "lucide-react";
import { buildProjectContext, countProjectFiles } from "@/lib/folder-import";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getFileIcon = (name: string) => {
  if (/\.(js|ts|jsx|tsx)$/.test(name)) return <FileCode className="h-3.5 w-3.5 text-blue-400" />;
  if (/\.json$/.test(name)) return <FileJson className="h-3.5 w-3.5 text-yellow-400" />;
  if (/\.md$/.test(name)) return <FileText className="h-3.5 w-3.5 text-[#52526e]" />;
  return <FileIcon className="h-3.5 w-3.5 text-[#52526e]" />;
};

function MiniFileTreeItem({ node, depth = 0, onSelect }: {
  node: FileNode; depth?: number; onSelect: (p: string) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  if (node.name.startsWith(".")) return null;
  if (node.type === "directory") {
    return (
      <div>
        <div
          className="flex items-center py-1.5 px-2 hover:bg-[#141420] cursor-pointer rounded min-h-[36px]"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3 w-3 mr-1 text-[#52526e]" /> : <ChevronRight className="h-3 w-3 mr-1 text-[#52526e]" />}
          <Folder className="h-3.5 w-3.5 mr-1.5 text-blue-400" />
          <span className="truncate text-sm">{node.name}</span>
        </div>
        {expanded && node.children?.map((c: FileNode) => (
          <MiniFileTreeItem key={c.path} node={c} depth={depth + 1} onSelect={onSelect} />
        ))}
      </div>
    );
  }
  return (
    <div
      className="flex items-center py-1.5 px-2 hover:bg-[#141420] cursor-pointer rounded min-h-[36px]"
      style={{ paddingLeft: `${depth * 12 + 22}px` }}
      onClick={() => onSelect(node.path)}
    >
      {getFileIcon(node.name)}
      <span className="truncate ml-1.5 text-sm text-[#a0a0c0]">{node.name}</span>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Typewriter
// ─────────────────────────────────────────────────────────────────────────────

const PHRASES = [
  "What are you building today?",
  "Debug your code in seconds.",
  "Write, review and ship faster.",
  "Turn ideas into working code.",
  "Claude · ChatGPT · Grok · Gemini.",
];

function TypewriterText() {
  const [displayed, setDisplayed] = useState("");
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [typing, setTyping] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const phrase = PHRASES[phraseIdx];
    if (paused) {
      const t = setTimeout(() => { setPaused(false); setTyping(false); }, 2000);
      return () => clearTimeout(t);
    }
    if (typing) {
      if (displayed.length < phrase.length) {
        const t = setTimeout(() => setDisplayed(phrase.slice(0, displayed.length + 1)), 42);
        return () => clearTimeout(t);
      } else { setPaused(true); }
    } else {
      if (displayed.length > 0) {
        const t = setTimeout(() => setDisplayed(d => d.slice(0, -1)), 18);
        return () => clearTimeout(t);
      } else { setPhraseIdx(i => (i + 1) % PHRASES.length); setTyping(true); }
    }
  }, [displayed, typing, paused, phraseIdx]);

  return (
    <p className="text-[#52526e] text-[13px] min-h-[1.5rem] text-center tracking-wide">
      {displayed}
      <span className="inline-block w-px h-[0.9em] bg-primary/60 ml-0.5 align-middle animate-pulse" />
    </p>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Quick prompts — with Lucide icons + short descriptions
// ─────────────────────────────────────────────────────────────────────────────

type QuickPrompt = {
  label: string;
  icon: ElementType;
  desc: string;
};

const QUICK_PROMPTS: QuickPrompt[] = [
  { label: "Explain this code",    icon: Search,       desc: "What does it do?" },
  { label: "Fix the bug",          icon: Bug,          desc: "Diagnose & repair" },
  { label: "Write unit tests",     icon: FlaskConical, desc: "Full test coverage" },
  { label: "Refactor code",        icon: Sparkles,     desc: "Cleaner structure" },
  { label: "Build a REST API",     icon: Globe,        desc: "Endpoint scaffold" },
  { label: "Optimise performance", icon: Zap,          desc: "Speed improvements" },
  { label: "Add TypeScript types", icon: Code2,        desc: "Type-safe code" },
  { label: "Write documentation",  icon: BookOpen,     desc: "Docs & comments" },
];

// ─────────────────────────────────────────────────────────────────────────────
// Message bubble
// ─────────────────────────────────────────────────────────────────────────────

const AI_NICE_NAMES: Record<string, string> = {
  claude: "Claude", chatgpt: "ChatGPT", grok: "Grok", gemini: "Gemini",
  groq: "Groq", deepseek: "DeepSeek", pollinations: "Pollinations AI",
  openrouter: "OpenRouter", together: "Together AI", mistral: "Mistral",
  cerebras: "Cerebras", cohere: "Cohere",
};

function RoutingBadge({ info }: {
  info: { aiId: string; reason: string; signals: string[]; confidence: number };
}) {
  const [expanded, setExpanded] = useState(false);
  const name = AI_NICE_NAMES[info.aiId] ?? info.aiId;
  const pct  = Math.round(info.confidence * 100);
  return (
    <button
      onClick={() => setExpanded(e => !e)}
      className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#3a3a5c] hover:text-[#52526e] transition-colors text-left"
      aria-label="Show routing decision details"
    >
      <span className="flex items-center gap-1 bg-primary/10 text-primary/70 border border-primary/15 px-1.5 py-0.5 rounded-full font-semibold">
        <Sparkles className="h-2.5 w-2.5" />
        Vesper routed → {name}
      </span>
      {info.signals.slice(0, 2).map(s => (
        <span key={s} className="bg-[#0a0a0c] border border-[#1a1a24] px-1.5 py-0.5 rounded-full text-[#52526e]">
          {s}
        </span>
      ))}
      <span className="text-[#2a2a40] font-mono">{pct}% confidence</span>
      {expanded && (
        <span className="w-full text-[#3a3a5c] mt-0.5 italic">{info.reason}</span>
      )}
    </button>
  );
}

function MessageBubble({ msg, onExecute }: {
  msg: {
    role: "user" | "assistant"; content: string; aiId?: string; error?: boolean;
    routingInfo?: { aiId: string; reason: string; signals: string[]; confidence: number };
  };
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
      <div className="flex justify-end px-4 py-1.5">
        <div className="max-w-[82%] md:max-w-[78%] bg-primary/20 border border-primary/25
          rounded-2xl rounded-tr-sm px-4 py-3 text-[15px] md:text-sm text-foreground leading-relaxed">
          {msg.content}
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-1.5 group">
      {msg.aiId && !msg.routingInfo && (
        <p className="text-[10px] text-[#3a3a5c] font-mono mb-1 pl-1">{msg.aiId}</p>
      )}
      <div className={`text-[15px] md:text-sm leading-relaxed ${msg.error ? "text-red-400" : "text-foreground"}`}>
        {msg.error ? (
          <div className="flex items-start gap-2.5 p-3.5 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400">
            <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
            <span>{msg.content}</span>
          </div>
        ) : (
          <MarkdownRenderer content={msg.content} onExecute={onExecute} />
        )}
      </div>
      {msg.routingInfo && <RoutingBadge info={msg.routingInfo} />}
      <div className="flex items-center gap-2 mt-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          onClick={copy}
          className="flex items-center gap-1.5 h-6 px-2 rounded-md text-[#52526e] hover:text-foreground
            hover:bg-[#141420] transition-colors text-xs"
          aria-label="Copy response"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Thinking indicator
// ─────────────────────────────────────────────────────────────────────────────

function ThinkingDots() {
  return (
    <div className="flex items-center gap-1.5 px-4 py-2" aria-label="AI is thinking">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="h-2 w-2 rounded-full bg-primary/60 animate-bounce"
          style={{ animationDelay: `${i * 0.15}s` }}
        />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({ onPrompt, connectedCount }: { onPrompt: (p: string) => void; connectedCount: number }) {
  const { setShowMobileSettings, setMobileSettingsTab } = useIDE();

  const openProviders = () => {
    setMobileSettingsTab("sessions");
    setShowMobileSettings(true);
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto" style={{ scrollbarWidth: "none" }}>

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col items-center pt-9 pb-5 px-5 text-center">
        {/* Logo lockup */}
        <div className="relative mb-4">
          <div className="absolute inset-0 -m-6 blur-3xl bg-primary/10 rounded-full pointer-events-none" />
          <div className="relative h-12 w-12 rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5
            border border-primary/20 flex items-center justify-center
            shadow-[0_0_32px_rgba(99,102,241,0.12),inset_0_1px_0_rgba(255,255,255,0.06)]">
            <VesperLogo size={24} />
          </div>
        </div>

        <h2 className="text-[15px] font-semibold text-foreground tracking-tight mb-1">
          How can I help you?
        </h2>
        <TypewriterText />

        {/* AI status pill / CTA */}
        <div className="mt-3.5">
          {connectedCount > 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] font-medium
              text-emerald-400 bg-emerald-950/80 border border-emerald-900/60
              rounded-full px-3 py-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse shrink-0" />
              {connectedCount} AI provider{connectedCount !== 1 ? "s" : ""} connected
            </span>
          ) : (
            <div className="flex flex-col items-center gap-2.5 max-w-[260px]">
              <div className="flex items-start gap-2 p-3 bg-amber-950/40 border border-amber-900/50
                rounded-xl text-amber-400/80 text-[11px] text-left leading-relaxed w-full">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>No AI connected. Pollinations AI is always free — or add an API key.</span>
              </div>
              {/* Mobile: tappable CTA to open settings */}
              <button
                onClick={openProviders}
                className="md:hidden flex items-center justify-center gap-2 w-full h-10
                  rounded-xl bg-primary/15 hover:bg-primary/20 border border-primary/25
                  text-primary text-[13px] font-semibold transition-all active:scale-[0.97]"
              >
                <ArrowUpRight className="h-3.5 w-3.5" />
                Connect a Provider
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Quick prompts — 2-col grid on ALL screens ─────────────────────── */}
      <div className="px-3 pb-5">
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#2a2a40] mb-2.5 px-0.5 select-none">
          Quick actions
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {QUICK_PROMPTS.map(({ label, icon: Icon, desc }) => (
            <button
              key={label}
              onClick={() => onPrompt(label)}
              className="flex items-start gap-2.5 px-3 py-2.5 rounded-xl text-left
                bg-[#0f0f16] active:bg-[#141420] hover:bg-[#141420]
                border border-[#1a1a24] hover:border-[#252535]
                transition-all duration-150 group min-h-[52px]"
            >
              <div className="mt-0.5 h-6 w-6 rounded-lg bg-[#141420] border border-[#1e1e2e] flex items-center justify-center shrink-0
                group-hover:bg-[#1a1a2a] group-hover:border-[#2a2a3c] transition-all">
                <Icon className="h-3 w-3 text-[#52526e] group-hover:text-[#a0a0c0] transition-colors" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#7070a0] group-hover:text-foreground transition-colors leading-tight">
                  {label}
                </p>
                <p className="text-[10px] text-[#3a3a5c] group-hover:text-[#52526e] mt-0.5 transition-colors hidden sm:block">
                  {desc}
                </p>
              </div>
            </button>
          ))}
        </div>
      </div>

    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Imported project banner (shown above the input bar)
// ─────────────────────────────────────────────────────────────────────────────

function ImportedProjectBanner({
  name,
  fileCount,
  onDetach,
}: {
  name: string;
  fileCount: number;
  onDetach: () => void;
}) {
  return (
    <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 bg-primary/5 border-t border-primary/20 text-xs">
      <FolderOpen className="h-3.5 w-3.5 text-primary shrink-0" />
      <span className="flex-1 truncate text-[#a0a0c0]">
        <span className="text-primary font-semibold">{name}</span>
        <span className="ml-1 text-[#52526e]">· {fileCount} files in AI context</span>
      </span>
      <button
        onClick={onDetach}
        className="text-[#52526e] hover:text-foreground transition-colors p-0.5 rounded"
        title="Remove project from AI context (keeps files in sidebar)"
        aria-label="Detach project from AI context"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Main chat panel
// ─────────────────────────────────────────────────────────────────────────────

export function ChatPanel({ newChatKey, compact = false, mobile = false }: {
  newChatKey: number;
  compact?: boolean;
  mobile?: boolean;
}) {
  const { selectedAi, importedProject, setImportedProject, toggleChat } = useIDE();
  const { toast } = useToast();
  const { data: aisData } = useListAis({
    query: { queryKey: getListAisQueryKey(), staleTime: 15_000, refetchInterval: 30_000 },
  });

  const askAi = useAskAi();
  const askAiWithContext = useAskAiWithContext();

  const [prompt, setPrompt] = useState("");
  type RoutingInfo = { aiId: string; reason: string; signals: string[]; confidence: number };
  const [messages, setMessages] = useState<Array<{
    role: "user" | "assistant"; content: string; aiId?: string; error?: boolean;
    routingInfo?: RoutingInfo;
  }>>([]);
  const [conversationId, setConversationId]       = useState<string | null>(null);
  const [executionResult, setExecutionResult]     = useState<any>(null);
  const [attachedFile, setAttachedFile]           = useState<string | null>(null);
  const [uploadedFile, setUploadedFile]           = useState<{ name: string; content: string } | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen]   = useState(false);
  const [showAttachMenu, setShowAttachMenu]       = useState(false);
  const [projectDetached, setProjectDetached]     = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef    = useRef<HTMLDivElement>(null);
  const textareaRef  = useRef<HTMLTextAreaElement>(null);

  // Reset on new chat
  useEffect(() => {
    if (newChatKey === 0) return;
    setMessages([]);
    setConversationId(null);
    setExecutionResult(null);
    setAttachedFile(null);
    setUploadedFile(null);
    setPrompt("");
    setProjectDetached(false);
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
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, executionResult]);

  useEffect(() => {
    if (!showAttachMenu) return;
    const close = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-attach-menu]")) setShowAttachMenu(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [showAttachMenu]);

  const isPending    = askAi.isPending || askAiWithContext.isPending;
  const isAuto       = selectedAi === "__auto__";
  const connectedAis = aisData?.ais?.filter((a: any) => a.hasSession) ?? [];
  const clearAttachment = () => { setAttachedFile(null); setUploadedFile(null); };

  // Whether the imported project is active in this chat
  const hasImportedProject = !!importedProject && !projectDetached;

  const send = useCallback(async (text: string) => {
    if (!text.trim() || isPending) return;
    setMessages(prev => [...prev, { role: "user", content: text }]);
    try {
      // When in Auto mode, send "__auto__" and let the smart router on the backend
      // pick the best connected AI. The response will include routingDecision.
      const effectiveAiId = isAuto ? "__auto__" : selectedAi;

      const payload = {
        aiId: effectiveAiId,
        prompt: text,
        conversationId: conversationId ?? undefined,
        fallback: isAuto,
      };

      // Build file context: workspace attachment + imported project
      const fileContent = uploadedFile?.content ?? attachedFileData?.content;
      const filePath    = uploadedFile?.name ?? attachedFile ?? "file";

      let files: Array<{ path: string; content: string }> = [];
      if (fileContent) {
        files.push({ path: filePath, content: fileContent });
      }
      if (hasImportedProject && importedProject) {
        // Build rich context from the imported project and inject it as a special file
        const projectCtx = buildProjectContext(importedProject);
        files.push({ path: "__imported_project_context__", content: projectCtx });
      }

      const result = files.length > 0
        ? await askAiWithContext.mutateAsync({ data: { ...payload, files } })
        : await askAi.mutateAsync({ data: payload });

      if (result.success) {
        setConversationId(result.conversationId);
        setMessages(prev => [...prev, {
          role: "assistant",
          content: result.response,
          aiId: result.aiId,
          routingInfo: (result as any).routingDecision ?? undefined,
        }]);
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: result.error || "Failed", error: true }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Unexpected error. Please try again.", error: true }]);
    }
  }, [isPending, isAuto, selectedAi, conversationId, uploadedFile, attachedFileData, attachedFile, askAi, askAiWithContext, hasImportedProject, importedProject]);

  const handleSend  = () => { send(prompt); setPrompt(""); clearAttachment(); };
  const handleRegen = () => { const last = [...messages].reverse().find(m => m.role === "user"); if (last) send(last.content); };
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const resizeTextarea = (ta: HTMLTextAreaElement) => {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight, 160) + "px";
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
  const projectFileCount = importedProject ? countProjectFiles(importedProject) : 0;

  return (
    <div className={`flex flex-col h-full bg-[#0d0d12] ${!compact ? "border-l border-[#1a1a24]" : ""}`}>

      {/* ── Desktop header ─────────────────────────────────────────────── */}
      <div className="hidden md:flex shrink-0 items-center justify-between px-3 h-9
        border-b border-[#131318] bg-[#080809]">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <Sparkles className="h-3 w-3 text-primary/70" />
            <span className="text-[11px] font-bold text-[#3a3a5c] uppercase tracking-widest">Chat</span>
          </div>
          {hasImportedProject && (
            <span className="flex items-center gap-1 text-[10px] bg-primary/10 text-primary/80 border border-primary/15 px-1.5 py-0.5 rounded-md font-semibold">
              <FolderOpen className="h-2.5 w-2.5" />
              {importedProject!.name}
            </span>
          )}
          {isAuto && connectedAis.length > 0 && (
            <span className="flex items-center gap-1 text-[10px] bg-emerald-950/60 text-emerald-400/80 border border-emerald-900/60 px-1.5 py-0.5 rounded-md font-semibold">
              <span className="h-1 w-1 rounded-full bg-emerald-400 animate-pulse" />
              {connectedAis.length} AI{connectedAis.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex items-center gap-0.5">
          {messages.length > 0 && (
            <button
              onClick={handleRegen}
              disabled={isPending}
              className="h-6 w-6 flex items-center justify-center rounded-lg text-[#3a3a5c] hover:text-foreground hover:bg-[#111118] disabled:opacity-30 transition-all duration-150"
              title="Regenerate last response"
            >
              <RotateCcw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
            </button>
          )}
          <button
            onClick={toggleChat}
            className="h-6 w-6 flex items-center justify-center rounded-lg text-[#3a3a5c] hover:text-foreground hover:bg-[#111118] transition-all duration-150"
            title="Collapse chat panel (Ctrl+J)"
          >
            <ChevronsRight className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── Messages ───────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto" ref={scrollRef}>
        {messages.length === 0 ? (
          <EmptyState onPrompt={text => { send(text); }} connectedCount={connectedAis.length} />
        ) : (
          <div className="py-3 space-y-0.5">
            {messages.length > 0 && (
              <div className="flex justify-end px-4 pb-2 md:hidden">
                <button
                  onClick={handleRegen}
                  disabled={isPending}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[#52526e] bg-[#141420]
                    border border-[#1a1a24] hover:text-foreground disabled:opacity-40 transition-colors text-xs"
                >
                  <RotateCcw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
                  Regenerate
                </button>
              </div>
            )}
            {messages.map((msg, i) => (
              <MessageBubble key={i} msg={msg} onExecute={setExecutionResult} />
            ))}
            {executionResult && (
              <div className="px-4 py-1">
                <TerminalOutput result={executionResult} />
              </div>
            )}
            {isPending && <ThinkingDots />}
            <div className="h-2" />
          </div>
        )}
      </div>

      {/* ── Imported project banner ────────────────────────────────────── */}
      {hasImportedProject && (
        <ImportedProjectBanner
          name={importedProject!.name}
          fileCount={projectFileCount}
          onDetach={() => setProjectDetached(true)}
        />
      )}

      {/* ── Workspace file attachment preview ─────────────────────────── */}
      {attachment && (
        <div className="shrink-0 flex items-center gap-2 px-4 py-2 bg-[#141420] border-t border-[#1a1a24] text-sm">
          <span className="text-primary shrink-0">📎</span>
          <span className="flex-1 truncate text-[#a0a0c0] font-mono text-xs">{attachment}</span>
          <button onClick={clearAttachment} className="text-[#52526e] hover:text-red-400 transition-colors p-1" aria-label="Remove attachment">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── File picker ────────────────────────────────────────────────── */}
      {isFilePickerOpen && (
        <div className="shrink-0 border-t border-[#1a1a24] bg-[#0a0a0c] max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a24]">
            <span className="text-[11px] font-bold text-[#52526e] uppercase tracking-wider">Attach from workspace</span>
            <button onClick={() => setIsFilePickerOpen(false)} className="text-[#52526e] hover:text-foreground p-1" aria-label="Close file picker">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {treeData?.tree ? (
            <MiniFileTreeItem
              node={treeData.tree}
              onSelect={p => { setAttachedFile(p); setIsFilePickerOpen(false); }}
            />
          ) : (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-[#52526e]" />
            </div>
          )}
        </div>
      )}

      {/* ── Input bar ──────────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-3 py-3 border-t border-[#1a1a24] bg-[#0a0a0c]"
        style={{ paddingBottom: compact ? "12px" : mobile ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : "env(safe-area-inset-bottom, 12px)" }}
      >
        <div
          className="relative flex items-end gap-2 bg-[#141420] border border-[#1e1e2e]
            focus-within:border-primary/50 rounded-2xl transition-colors shadow-lg"
        >
          <textarea
            ref={textareaRef}
            value={prompt}
            onChange={e => {
              setPrompt(e.target.value);
              resizeTextarea(e.target);
            }}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={
              isPending
                ? "Waiting for response…"
                : hasImportedProject
                  ? `Ask about ${importedProject!.name}…`
                  : "Ask anything… (Enter to send)"
            }
            disabled={isPending}
            aria-label="Chat input"
            className="flex-1 bg-transparent resize-none outline-none text-[16px] md:text-sm
              text-foreground placeholder:text-[#3a3a5c] py-3 pl-4 max-h-40 min-h-[52px]
              md:min-h-[42px] leading-relaxed"
            style={{ height: "auto" }}
          />

          <div className="flex items-center gap-1 pr-2.5 pb-2.5 shrink-0">
            {/* Attach */}
            <div className="relative" data-attach-menu>
              <button
                onClick={() => setShowAttachMenu(o => !o)}
                className="h-9 w-9 md:h-8 md:w-8 flex items-center justify-center rounded-xl
                  text-[#52526e] hover:text-foreground hover:bg-[#1e1e2e] transition-colors"
                aria-label="Attach file"
                data-attach-menu
              >
                <Paperclip className="h-4 w-4 md:h-3.5 md:w-3.5" />
              </button>
              {showAttachMenu && (
                <div
                  className="absolute bottom-11 right-0 z-50 bg-[#0d0d12] border border-[#1a1a24]
                    rounded-2xl shadow-2xl p-1.5 min-w-[180px]"
                  data-attach-menu
                >
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm rounded-xl
                      text-[#a0a0c0] hover:bg-[#141420] transition-colors min-h-[48px]"
                    onClick={() => { setIsFilePickerOpen(true); setShowAttachMenu(false); }}
                  >
                    <Folder className="h-4 w-4 text-blue-400" />
                    From workspace
                  </button>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 text-sm rounded-xl
                      text-[#a0a0c0] hover:bg-[#141420] transition-colors min-h-[48px]"
                    onClick={() => { fileInputRef.current?.click(); setShowAttachMenu(false); }}
                  >
                    <Upload className="h-4 w-4 text-emerald-400" />
                    Upload file
                  </button>
                </div>
              )}
            </div>

            {/* Send */}
            <button
              onClick={handleSend}
              disabled={isPending || !prompt.trim()}
              className="h-9 w-9 md:h-8 md:w-8 flex items-center justify-center rounded-xl
                bg-primary text-primary-foreground hover:bg-primary/80
                disabled:opacity-40 disabled:cursor-not-allowed
                transition-all active:scale-95 shadow-[0_2px_12px_rgba(99,102,241,0.4)]"
              aria-label="Send message"
            >
              {isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Send className="h-4 w-4" />
              }
            </button>
          </div>
        </div>

        <p className="mt-1.5 text-center text-[11px] text-[#3a3a5c] hidden md:block">
          Shift+Enter for new line · Enter to send
        </p>
      </div>

      <input ref={fileInputRef} type="file" className="hidden" accept="*/*" onChange={handleFileUpload} />
    </div>
  );
}
