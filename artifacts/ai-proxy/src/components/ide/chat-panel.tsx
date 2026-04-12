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
import { AgentSelector } from "@/components/chat/agent-selector";
import { useIDE } from "@/contexts/ide-context";
import { useAgentMode, type AgentType } from "@/contexts/agent-context";
import { useWorkspace } from "@/contexts/workspace-context";
import { ArrowUpRight } from "lucide-react";
import { buildProjectContext, countProjectFiles } from "@/lib/folder-import";
import { ExportMenu } from "@/components/chat/export-menu";
import {
  detectIntent, detectInstallIntent,
  AGENT_PREFIXES,
  type IntentResult, type InstallIntentResult,
} from "@/lib/intent-detect";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const getFileIcon = (name: string) => {
  if (/\.(js|ts|jsx|tsx)$/.test(name)) return <FileCode className="h-3.5 w-3.5 text-blue-400" />;
  if (/\.json$/.test(name)) return <FileJson className="h-3.5 w-3.5 text-yellow-400" />;
  if (/\.md$/.test(name)) return <FileText className="h-3.5 w-3.5 text-[#9898b8]" />;
  return <FileIcon className="h-3.5 w-3.5 text-[#9898b8]" />;
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
          {expanded ? <ChevronDown className="h-3 w-3 mr-1 text-[#9898b8]" /> : <ChevronRight className="h-3 w-3 mr-1 text-[#9898b8]" />}
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
    <p className="text-[#9898b8] text-[13px] min-h-[1.5rem] text-center tracking-wide">
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
      className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-[#7878a8] hover:text-[#9898b8] transition-colors text-left"
      aria-label="Show routing decision details"
    >
      <span className="flex items-center gap-1 bg-primary/10 text-primary/70 border border-primary/15 px-1.5 py-0.5 rounded-full font-semibold">
        <Sparkles className="h-2.5 w-2.5" />
        Vesper routed → {name}
      </span>
      {info.signals.slice(0, 2).map(s => (
        <span key={s} className="bg-[#0a0a0c] border border-[#1a1a24] px-1.5 py-0.5 rounded-full text-[#9898b8]">
          {s}
        </span>
      ))}
      <span className="text-[#7878a8] font-mono">{pct}% confidence</span>
      {expanded && (
        <span className="w-full text-[#7878a8] mt-0.5 italic">{info.reason}</span>
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
        <p className="text-[10px] text-[#7878a8] font-mono mb-1 pl-1">{msg.aiId}</p>
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
          className="flex items-center gap-1.5 h-6 px-2 rounded-md text-[#9898b8] hover:text-foreground
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
        <p className="text-[10px] font-bold uppercase tracking-widest text-[#7878a8] mb-2.5 px-0.5 select-none">
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
                <Icon className="h-3 w-3 text-[#9898b8] group-hover:text-[#a0a0c0] transition-colors" />
              </div>
              <div className="min-w-0">
                <p className="text-[12px] font-medium text-[#7070a0] group-hover:text-foreground transition-colors leading-tight">
                  {label}
                </p>
                <p className="text-[10px] text-[#7878a8] group-hover:text-[#9898b8] mt-0.5 transition-colors hidden sm:block">
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
        <span className="ml-1 text-[#9898b8]">· {fileCount} files in AI context</span>
      </span>
      <button
        onClick={onDetach}
        className="text-[#9898b8] hover:text-foreground transition-colors p-0.5 rounded"
        title="Remove project from AI context (keeps files in sidebar)"
        aria-label="Detach project from AI context"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Intent detection strip
// ─────────────────────────────────────────────────────────────────────────────

const INTENT_COLORS: Record<string, { badge: string; chip: string; dot: string }> = {
  rose:    { badge: "border-rose-500/35 bg-rose-500/10 text-rose-400",    chip: "border-rose-500/25 text-rose-400/80 hover:bg-rose-500/10 active:bg-rose-500/20",    dot: "bg-rose-400" },
  emerald: { badge: "border-emerald-500/35 bg-emerald-500/10 text-emerald-400", chip: "border-emerald-500/25 text-emerald-400/80 hover:bg-emerald-500/10 active:bg-emerald-500/20", dot: "bg-emerald-400" },
  sky:     { badge: "border-sky-500/35 bg-sky-500/10 text-sky-400",       chip: "border-sky-500/25 text-sky-400/80 hover:bg-sky-500/10 active:bg-sky-500/20",       dot: "bg-sky-400" },
  amber:   { badge: "border-amber-500/35 bg-amber-500/10 text-amber-400", chip: "border-amber-500/25 text-amber-400/80 hover:bg-amber-500/10 active:bg-amber-500/20", dot: "bg-amber-400" },
  violet:  { badge: "border-violet-500/35 bg-violet-500/10 text-violet-400", chip: "border-violet-500/25 text-violet-400/80 hover:bg-violet-500/10 active:bg-violet-500/20", dot: "bg-violet-400" },
  primary: { badge: "border-primary/30 bg-primary/10 text-primary",       chip: "border-primary/20 text-primary/80 hover:bg-primary/10 active:bg-primary/15",       dot: "bg-primary" },
};

function IntentStrip({
  intent,
  dismissed,
  onDismiss,
  onChip,
}: {
  intent: IntentResult | null;
  dismissed: boolean;
  onDismiss: () => void;
  onChip: (chip: string) => void;
}) {
  const visible = !!intent && !dismissed;

  if (!visible) return null;

  const c = INTENT_COLORS[intent!.color] ?? INTENT_COLORS.primary;

  return (
    <div className="mb-2 space-y-1.5">
      {/* Detection badge row */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] font-semibold ${c.badge}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${c.dot} animate-pulse`} />
          {intent!.label} detected
        </span>
        <button
          onClick={onDismiss}
          className="text-[10px] text-[#7878a8] hover:text-[#9898b8] transition-colors p-1 -ml-1"
          aria-label="Dismiss agent suggestion"
          title="Dismiss — send with current agent"
        >
          <X className="h-3 w-3" />
        </button>
        <span className="text-[10px] text-[#7878a8]">or pick an action:</span>
      </div>

      {/* Action chips */}
      <div className="flex flex-wrap gap-1.5">
        {intent!.chips.map(chip => (
          <button
            key={chip}
            onClick={() => onChip(chip)}
            className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium
              transition-all duration-100 active:scale-95 min-h-[32px]
              bg-transparent ${c.chip}`}
          >
            <ArrowRight className="h-2.5 w-2.5 shrink-0" />
            {chip}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Install confirm strip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shown when the user's message looks like a package install request.
 * Lets them confirm or dismiss without ever sending to the AI.
 */
function InstallConfirmStrip({
  intent,
  dismissed,
  hasWorkspace,
  isInstalling,
  onConfirm,
  onDismiss,
  onAskAI,
}: {
  intent:       InstallIntentResult | null;
  dismissed:    boolean;
  hasWorkspace: boolean;
  isInstalling: boolean;
  onConfirm:    (pkg: string) => void;
  onDismiss:    () => void;
  onAskAI:      () => void;
}) {
  const visible = !!intent && !dismissed;
  if (!visible) return null;

  const pkg = intent!.packageName;
  const mgr = intent!.manager === "npm" ? "npm" : "workspace";

  return (
    <div className="mb-2">
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-xl border border-teal-500/30 bg-teal-500/8">
        {/* Icon */}
        <span className="mt-0.5 shrink-0 h-4 w-4 text-teal-400">
          <svg viewBox="0 0 16 16" fill="none" className="h-4 w-4" aria-hidden>
            <rect width="16" height="16" rx="4" fill="currentColor" fillOpacity="0.15" />
            <path d="M4 8h8M8 4v8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </span>

        <div className="flex-1 min-w-0">
          <p className="text-[11px] text-teal-300 font-medium mb-1.5">
            Install <code className="px-1 py-0.5 rounded bg-teal-500/15 font-mono">{pkg}</code>
            {" "}in your {mgr}?
          </p>
          <div className="flex flex-wrap gap-1.5">
            {/* Primary: Install now */}
            <button
              onClick={() => onConfirm(pkg)}
              disabled={!hasWorkspace || isInstalling}
              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-semibold
                bg-teal-500/20 border border-teal-500/40 text-teal-300
                hover:bg-teal-500/30 active:scale-95 transition-all duration-100
                disabled:opacity-50 disabled:cursor-not-allowed min-h-[32px]"
              title={hasWorkspace ? undefined : "Select a workspace first"}
            >
              {isInstalling ? (
                <><Loader2 className="h-3 w-3 animate-spin" /> Installing…</>
              ) : (
                <><ArrowRight className="h-3 w-3" /> Install now</>
              )}
            </button>

            {/* Secondary: Ask AI instead */}
            <button
              onClick={onAskAI}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium
                border border-[#2a2a3e] text-[#9898b8] hover:text-foreground hover:border-[#3a3a54]
                active:scale-95 transition-all duration-100 min-h-[32px]"
            >
              Ask AI instead
            </button>

            {/* Dismiss */}
            <button
              onClick={onDismiss}
              className="p-1.5 text-[#7878a8] hover:text-[#9898b8] transition-colors rounded-lg min-h-[32px]"
              aria-label="Dismiss install suggestion"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {!hasWorkspace && (
            <p className="mt-1.5 text-[10px] text-amber-400/80">
              Select a workspace in the file explorer to enable installs.
            </p>
          )}
        </div>
      </div>
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
  const { selectedAi, importedProject, setImportedProject, toggleChat,
    mobileTab, showMobileChatSheet, incrementChatUnread, activeFilePath } = useIDE();
  const { agentType } = useAgentMode();
  const { currentWorkspace, deps, installDep } = useWorkspace();
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
    routingInfo?: RoutingInfo; timestamp?: Date;
  }>>([]);
  const [conversationId, setConversationId]       = useState<string | null>(null);
  const [executionResult, setExecutionResult]     = useState<any>(null);
  const [attachedFile, setAttachedFile]           = useState<string | null>(null);
  const [uploadedFile, setUploadedFile]           = useState<{ name: string; content: string } | null>(null);
  const [isFilePickerOpen, setIsFilePickerOpen]   = useState(false);
  const [showAttachMenu, setShowAttachMenu]       = useState(false);
  const [projectDetached, setProjectDetached]     = useState(false);

  // ── Intent detection ──────────────────────────────────────────────────────
  const [detectedIntent, setDetectedIntent]       = useState<IntentResult | null>(null);
  const [intentDismissed, setIntentDismissed]     = useState(false);
  const [routingLabel, setRoutingLabel]           = useState<string | null>(null);
  // Install intent — triggers workspace dep install without an AI roundtrip
  const [installIntent, setInstallIntent]         = useState<InstallIntentResult | null>(null);
  const [installDismissed, setInstallDismissed]   = useState(false);
  const [isInstalling, setIsInstalling]           = useState(false);

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

  // File picker tree (only loaded when picker is open)
  const { data: treeData } = useGetFileTree(
    { path: "", depth: 10 },
    { query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }), enabled: isFilePickerOpen } }
  );

  // Workspace tree — fetched continuously when a workspace is active, used for AI context
  const wsTreePath = currentWorkspace?.relPath ?? "";
  const { data: wsTreeData } = useGetFileTree(
    { path: wsTreePath, depth: 4 },
    {
      query: {
        queryKey: getGetFileTreeQueryKey({ path: wsTreePath, depth: 4 }),
        enabled: !!currentWorkspace,
        staleTime: 30_000,
      },
    }
  );

  const { data: attachedFileData } = useReadFile(
    { path: attachedFile || "" },
    { query: { enabled: !!attachedFile, queryKey: getReadFileQueryKey({ path: attachedFile || "" }) } }
  );

  // Auto-read the currently open editor file so AI can see it without manual attaching.
  // Disabled when the user has manually attached a file or uploaded one.
  const autoInjectPath = (!attachedFile && !uploadedFile && activeFilePath) ? activeFilePath : "";
  const { data: activeFileData } = useReadFile(
    { path: autoInjectPath },
    { query: { enabled: !!autoInjectPath, queryKey: getReadFileQueryKey({ path: autoInjectPath }), staleTime: 10_000 } }
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

  // ── Debounced intent detection (300 ms after user stops typing) ───────────
  useEffect(() => {
    const trimmed = prompt.trim();
    if (!trimmed) {
      setDetectedIntent(null);
      setInstallIntent(null);
      return;
    }
    const timer = setTimeout(() => {
      // Install intent takes priority — it bypasses the AI completely
      const install = detectInstallIntent(trimmed);
      setInstallIntent(prev => {
        if (prev?.packageName !== install?.packageName) setInstallDismissed(false);
        return install;
      });

      // Agent intent only shown when no install intent is active
      if (!install) {
        const result = detectIntent(trimmed);
        setDetectedIntent(prev => {
          if (prev?.agentType !== result?.agentType) setIntentDismissed(false);
          return result;
        });
      } else {
        setDetectedIntent(null);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [prompt]);

  const isPending    = askAi.isPending || askAiWithContext.isPending || isInstalling;
  const isAuto       = selectedAi === "__auto__";
  const connectedAis = aisData?.ais?.filter((a: any) => a.hasSession) ?? [];
  const clearAttachment = () => { setAttachedFile(null); setUploadedFile(null); };

  // Whether the imported project is active in this chat
  const hasImportedProject = !!importedProject && !projectDetached;

  // ── Workspace context builder ─────────────────────────────────────────────
  // Builds a compact text summary of the active workspace for AI context.
  // Included automatically with every message when a workspace is selected.
  function buildWsContext(): string | null {
    if (!currentWorkspace || !wsTreeData?.tree) return null;

    const lines: string[] = [
      `# Active Workspace: ${currentWorkspace.name}`,
      `Language: ${currentWorkspace.language ?? "unknown"}`,
      `Path: ${currentWorkspace.relPath}`,
    ];

    if (deps.length > 0) {
      lines.push(`\nInstalled packages (${deps.length}):`);
      deps.slice(0, 20).forEach(d => {
        lines.push(`  • ${d.name}${d.version ? `@${d.version}` : ""}`);
      });
      if (deps.length > 20) lines.push(`  …and ${deps.length - 20} more`);
    }

    // Compact file tree (max 60 entries)
    const fileLines: string[] = [];
    function walkTree(node: FileNode, depth: number) {
      if (fileLines.length >= 60) return;
      if (node.name.startsWith(".")) return;
      const indent = "  ".repeat(depth);
      fileLines.push(`${indent}${node.type === "directory" ? "📁 " : ""}${node.name}`);
      if (node.type === "directory" && node.children) {
        node.children.forEach(c => walkTree(c, depth + 1));
      }
    }
    if (wsTreeData.tree.children) {
      wsTreeData.tree.children.forEach(c => walkTree(c, 0));
    }

    if (fileLines.length > 0) {
      lines.push(`\nWorkspace files:\n${fileLines.join("\n")}`);
    }

    lines.push("\n(You have read/write access to all files in this workspace.)");
    return lines.join("\n");
  }

  const send = useCallback(async (text: string, forceAgent?: AgentType) => {
    if (!text.trim() || isPending) return;

    // Resolve which agent persona to use for this single message:
    // 1. Explicit forceAgent (from action chip click)
    // 2. Detected intent (if not dismissed by user)
    // 3. User's current persisted agentType
    const effectiveAgent: AgentType =
      forceAgent ??
      (!intentDismissed && detectedIntent ? detectedIntent.agentType : agentType);

    // Flash a routing indicator when auto-switching to a different persona
    if (!forceAgent && !intentDismissed && detectedIntent && detectedIntent.agentType !== agentType) {
      setRoutingLabel(detectedIntent.label);
      setTimeout(() => setRoutingLabel(null), 2200);
    }

    setMessages(prev => [...prev, { role: "user", content: text, timestamp: new Date() }]);
    setDetectedIntent(null);
    setIntentDismissed(false);

    try {
      // When in Auto mode, send "__auto__" and let the smart router on the backend
      // pick the best connected AI. The response will include routingDecision.
      const effectiveAiId = isAuto ? "__auto__" : selectedAi;

      const rolePrefix = AGENT_PREFIXES[effectiveAgent] ?? "";
      const promptWithRole = rolePrefix ? rolePrefix + text : text;

      // `action` maps to the backend's ACTION_PREFIXES for specialist prompting.
      // `agentType` lets the backend apply a stronger system-prompt for the persona.
      const detectedAction = !intentDismissed ? detectedIntent?.action : undefined;
      const payload = {
        aiId:          effectiveAiId,
        prompt:        promptWithRole,
        conversationId: conversationId ?? undefined,
        fallback:      isAuto,
        agentType:     effectiveAgent !== "builder" ? effectiveAgent : undefined,
        action:        detectedAction,
      };

      // Build file context: workspace overview + explicit attachment + imported project
      const fileContent = uploadedFile?.content ?? attachedFileData?.content;
      const filePath    = uploadedFile?.name ?? attachedFile ?? "file";

      let files: Array<{ path: string; content: string }> = [];

      // 1. Active workspace overview (file tree + installed deps)
      const wsCtx = buildWsContext();
      if (wsCtx) {
        files.push({ path: "__workspace_context__", content: wsCtx });
      }

      // 2. Explicitly attached file (from sidebar picker or upload)
      if (fileContent) {
        files.push({ path: filePath, content: fileContent });
      } else if (activeFileData?.content && autoInjectPath) {
        // 2a. Auto-inject: the file currently open in the editor — no user action needed.
        //     This is what makes "refactor this", "fix this bug" etc work without attaching.
        files.push({ path: autoInjectPath, content: activeFileData.content });
      }

      // 3. Imported folder project (full contents)
      if (hasImportedProject && importedProject) {
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
          timestamp: new Date(),
        }]);
        // Signal the bottom nav badge when the user is viewing another tab or
        // the chat is closed (so they notice the reply without checking)
        if (mobileTab !== "chat" && !showMobileChatSheet) {
          incrementChatUnread();
        }
      } else {
        setMessages(prev => [...prev, { role: "assistant", content: result.error || "Failed", error: true, timestamp: new Date() }]);
      }
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Unexpected error. Please try again.", error: true, timestamp: new Date() }]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPending, isAuto, selectedAi, agentType, detectedIntent, intentDismissed, conversationId, uploadedFile, attachedFileData, attachedFile, askAi, askAiWithContext, hasImportedProject, importedProject, currentWorkspace, wsTreeData, deps, mobileTab, showMobileChatSheet, incrementChatUnread, activeFileData, autoInjectPath]);

  // ── Install-intent handler ────────────────────────────────────────────────
  const handleInstallConfirm = useCallback(async (packageName: string) => {
    if (!currentWorkspace) {
      toast({ title: "No workspace", description: "Select a workspace first.", variant: "destructive" });
      return;
    }
    setIsInstalling(true);
    setInstallIntent(null);
    setInstallDismissed(false);
    setPrompt("");

    // Show a user-side message so it feels conversational
    setMessages(prev => [...prev, {
      role: "user",
      content: `Install \`${packageName}\` in workspace **${currentWorkspace.name}**`,
      timestamp: new Date(),
    }]);

    try {
      await installDep(packageName);
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `**\`${packageName}\` installed successfully** in \`${currentWorkspace.name}\`.\n\nYou can now import it in your code.`,
        timestamp: new Date(),
      }]);
      toast({ title: "Package installed", description: `${packageName} is ready to use.` });
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: "assistant",
        content: `**Installation failed** for \`${packageName}\`.\n\n${err?.message ?? "Unknown error — check the terminal for details."}`,
        error: true,
        timestamp: new Date(),
      }]);
      toast({ title: "Install failed", description: err?.message ?? "Unknown error", variant: "destructive" });
    } finally {
      setIsInstalling(false);
    }
  }, [currentWorkspace, installDep, toast]);

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
            <span className="text-[11px] font-bold text-[#7878a8] uppercase tracking-widest">Chat</span>
          </div>
          <AgentSelector isPending={isPending} />
          {/* Workspace context indicator */}
          {currentWorkspace && wsTreeData?.tree && (
            <span
              title={`Workspace "${currentWorkspace.name}" is included as AI context`}
              className="flex items-center gap-1 text-[10px] bg-violet-950/50 text-violet-400/80
                border border-violet-800/40 px-1.5 py-0.5 rounded-md font-semibold select-none"
            >
              <span className="h-1 w-1 rounded-full bg-violet-400" />
              {currentWorkspace.name}
            </span>
          )}
          {/* Auto-injected active editor file */}
          {autoInjectPath && activeFileData?.content && (
            <span
              title={`${autoInjectPath} is auto-included as AI context from the editor`}
              className="flex items-center gap-1 text-[10px] bg-sky-950/50 text-sky-400/80
                border border-sky-800/40 px-1.5 py-0.5 rounded-md font-semibold select-none"
            >
              <span className="h-1 w-1 rounded-full bg-sky-400" />
              {autoInjectPath.split("/").pop()}
            </span>
          )}
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
            <>
              <ExportMenu
                messages={messages}
                workspaceName={currentWorkspace?.name}
              />
              <button
                onClick={handleRegen}
                disabled={isPending}
                className="h-6 w-6 flex items-center justify-center rounded-lg text-[#7878a8] hover:text-foreground hover:bg-[#111118] disabled:opacity-30 transition-all duration-150"
                title="Regenerate last response"
              >
                <RotateCcw className={`h-3 w-3 ${isPending ? "animate-spin" : ""}`} />
              </button>
            </>
          )}
          <button
            onClick={toggleChat}
            className="h-6 w-6 flex items-center justify-center rounded-lg text-[#7878a8] hover:text-foreground hover:bg-[#111118] transition-all duration-150"
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
              <div className="flex justify-end items-center gap-2 px-4 pb-2 md:hidden">
                <ExportMenu
                  messages={messages}
                  workspaceName={currentWorkspace?.name}
                  compact
                />
                <button
                  onClick={handleRegen}
                  disabled={isPending}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-full text-[#9898b8] bg-[#141420]
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
          <button onClick={clearAttachment} className="text-[#9898b8] hover:text-red-400 transition-colors p-1" aria-label="Remove attachment">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── File picker ────────────────────────────────────────────────── */}
      {isFilePickerOpen && (
        <div className="shrink-0 border-t border-[#1a1a24] bg-[#0a0a0c] max-h-52 overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-2 border-b border-[#1a1a24]">
            <span className="text-[11px] font-bold text-[#9898b8] uppercase tracking-wider">Attach from workspace</span>
            <button onClick={() => setIsFilePickerOpen(false)} className="text-[#9898b8] hover:text-foreground p-1" aria-label="Close file picker">
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
              <Loader2 className="h-5 w-5 animate-spin text-[#9898b8]" />
            </div>
          )}
        </div>
      )}

      {/* ── Input bar ──────────────────────────────────────────────────── */}
      <div
        className="shrink-0 px-3 py-3 border-t border-[#1a1a24] bg-[#0a0a0c]"
        style={{ paddingBottom: compact ? "12px" : mobile ? "calc(env(safe-area-inset-bottom, 0px) + 8px)" : "env(safe-area-inset-bottom, 12px)" }}
      >
        {/* Mobile-only agent selector row (desktop header is hidden on small screens) */}
        <div className="md:hidden flex items-center justify-between mb-2">
          <AgentSelector isPending={isPending} />
        </div>
        {/* Install-intent confirmation — shown instead of agent routing strip */}
        <InstallConfirmStrip
          intent={installIntent}
          dismissed={installDismissed}
          hasWorkspace={!!currentWorkspace}
          isInstalling={isInstalling}
          onConfirm={(pkg) => handleInstallConfirm(pkg)}
          onDismiss={() => setInstallDismissed(true)}
          onAskAI={() => {
            setInstallDismissed(true);
            send(prompt);
            setPrompt("");
            clearAttachment();
          }}
        />

        {/* Agent-routing strip — hidden while install strip is active */}
        <IntentStrip
          intent={installIntent && !installDismissed ? null : detectedIntent}
          dismissed={intentDismissed}
          onDismiss={() => setIntentDismissed(true)}
          onChip={(chip) => {
            const text = prompt.trim() ? prompt : chip;
            send(text, detectedIntent?.agentType);
            setPrompt("");
            clearAttachment();
          }}
        />
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
              text-foreground placeholder:text-[#7878a8] py-3 pl-4 max-h-40 min-h-[52px]
              md:min-h-[42px] leading-relaxed"
            style={{ height: "auto" }}
          />

          <div className="flex items-center gap-1 pr-2.5 pb-2.5 shrink-0">
            {/* Attach */}
            <div className="relative" data-attach-menu>
              <button
                onClick={() => setShowAttachMenu(o => !o)}
                className="h-9 w-9 md:h-8 md:w-8 flex items-center justify-center rounded-xl
                  text-[#9898b8] hover:text-foreground hover:bg-[#1e1e2e] transition-colors"
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

        <p className="mt-1.5 text-center text-[11px] text-[#7878a8] hidden md:block transition-all">
          {routingLabel
            ? <span className="text-primary/70 animate-pulse">↪ Routing to {routingLabel}…</span>
            : "Shift+Enter for new line · Enter to send"
          }
        </p>
      </div>

      <input ref={fileInputRef} type="file" className="hidden" accept="*/*" onChange={handleFileUpload} />
    </div>
  );
}
