import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import React from "react";
import {
  useRunAgent, useGetAgentStatus, getGetAgentStatusQueryKey,
  useListAis, getListAisQueryKey, AgentStep,
} from "@workspace/api-client-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bot, Play, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Terminal, FileCode, FolderPlus,
  FileEdit, Trash2, List, Loader2, Sparkles, AlertCircle,
  Globe, Camera, Wifi, Clock, Server, Zap, WifiOff,
  Square, Package, FileDiff, FileText, RefreshCw, Activity,
  ChevronUp, Key, Badge as BadgeIcon, ChevronLeft,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { useQueryClient } from "@tanstack/react-query";

// ─── Tool metadata ────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.JSX.Element> = {
  install_packages: <Package className="h-3 w-3" />,
  execute:          <Terminal className="h-3 w-3" />,
  background_exec:  <Server className="h-3 w-3" />,
  kill_process:     <WifiOff className="h-3 w-3" />,
  write_file:       <FileEdit className="h-3 w-3" />,
  patch_file:       <FileDiff className="h-3 w-3" />,
  read_file:        <FileCode className="h-3 w-3" />,
  create_dir:       <FolderPlus className="h-3 w-3" />,
  delete:           <Trash2 className="h-3 w-3" />,
  list_dir:         <List className="h-3 w-3" />,
  check_port:       <Wifi className="h-3 w-3" />,
  http_get:         <Globe className="h-3 w-3" />,
  http_post:        <Zap className="h-3 w-3" />,
  screenshot_url:   <Camera className="h-3 w-3" />,
  sleep:            <Clock className="h-3 w-3" />,
};

const TOOL_COLORS: Record<string, string> = {
  install_packages: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  execute:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  background_exec:  "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  kill_process:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  write_file:       "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  patch_file:       "bg-teal-500/10 text-teal-400 border-teal-500/20",
  read_file:        "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  create_dir:       "bg-purple-500/10 text-purple-400 border-purple-500/20",
  delete:           "bg-red-500/10 text-red-400 border-red-500/20",
  list_dir:         "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  check_port:       "bg-teal-500/10 text-teal-400 border-teal-500/20",
  http_get:         "bg-sky-500/10 text-sky-400 border-sky-500/20",
  http_post:        "bg-violet-500/10 text-violet-400 border-violet-500/20",
  screenshot_url:   "bg-pink-500/10 text-pink-400 border-pink-500/20",
  sleep:            "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const SCREENSHOT_RE = /Screenshot API path: (\/api\/agent\/screenshot\/[^\s]+\.png)/;

function parseScreenshot(r: string) {
  return r.match(SCREENSHOT_RE)?.[1] ?? null;
}

function isToolError(result: string | null | undefined): boolean {
  if (!result) return false;
  return result.startsWith("ERROR") || result.startsWith("✗") || result.includes("failed") || result.includes("crashed");
}

function getStepSummary(step: AgentStep) {
  const p = step.params as Record<string, unknown> | undefined ?? {};
  const t = step.tool || "";
  if (t === "execute" || t === "background_exec") return String(p.command ?? "").slice(0, 60);
  if (t === "write_file" || t === "read_file" || t === "patch_file") return String(p.path ?? "");
  if (t === "http_get" || t === "http_post" || t === "screenshot_url") return String(p.url ?? "");
  if (t === "check_port") return `port ${p.port}`;
  if (t === "sleep") return `${p.seconds}s`;
  if (t === "create_dir" || t === "delete" || t === "list_dir") return String(p.path ?? "");
  if (t === "install_packages") {
    const pkgs = p.packages;
    if (Array.isArray(pkgs)) return pkgs.join(", ");
    return String(pkgs ?? "");
  }
  return "";
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({ step, isActive = false, defaultOpen = false }: {
  step: AgentStep; isActive?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  if (step.type === "thought") {
    return (
      <div className={`border rounded-xl overflow-hidden transition-all ${
        isActive ? "border-primary/30 shadow-[0_0_10px_rgba(99,102,241,0.12)]" : "border-[#1a1a24]"
      }`}>
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 bg-[#0d0d12] hover:bg-[#111118] text-left transition-colors"
          onClick={() => setOpen(!open)}
        >
          {isActive
            ? <Loader2 className="h-3.5 w-3.5 text-primary shrink-0 animate-spin" />
            : <Bot className="h-3.5 w-3.5 text-primary/60 shrink-0" />}
          <span className="text-xs font-medium text-[#a0a0c0] flex-1">
            Step {step.step} — {isActive ? "Reasoning…" : "Thought"}
          </span>
          {step.elapsedMs ? (
            <span className="text-[10px] text-[#52526e] mr-1">{(step.elapsedMs / 1000).toFixed(1)}s</span>
          ) : null}
          {open
            ? <ChevronDown className="h-3.5 w-3.5 text-[#52526e]" />
            : <ChevronRight className="h-3.5 w-3.5 text-[#52526e]" />}
        </button>
        {open && step.content && (
          <div className="px-3 py-2.5 border-t border-[#1a1a24] text-sm bg-[#0a0a0c]">
            <MarkdownRenderer content={step.content} />
          </div>
        )}
      </div>
    );
  }

  if (step.type === "tool") {
    const toolName = step.tool || "tool";
    const colorClass = TOOL_COLORS[toolName] || "bg-[#141420] text-[#52526e] border-[#1a1a24]";
    const icon = TOOL_ICONS[toolName] || <Terminal className="h-3 w-3" />;
    const summary = getStepSummary(step);
    const screenshot = step.result ? parseScreenshot(step.result) : null;
    const hasResult = !!step.result;
    const hasError = isToolError(step.result);
    const isRunning = isActive && !hasResult;

    return (
      <div className={`border rounded-xl overflow-hidden transition-all ${
        isActive ? "border-primary/30 shadow-[0_0_10px_rgba(99,102,241,0.12)]" : "border-[#1a1a24]"
      }`}>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 bg-[#0d0d12] hover:bg-[#111118] text-left transition-colors"
          onClick={() => setOpen(!open)}
        >
          <span className={`inline-flex items-center gap-1 text-[10px] font-mono px-1.5 py-0.5 rounded-md border ${colorClass} shrink-0`}>
            {icon}
            <span className="hidden sm:inline">{toolName}</span>
          </span>
          {summary && <code className="text-[11px] text-[#52526e] font-mono truncate flex-1">{summary}</code>}
          <div className="flex items-center gap-1.5 shrink-0 ml-auto">
            {isRunning && (
              <span className="flex gap-0.5">
                <span className="h-1 w-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1 w-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1 w-1 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            )}
            {hasResult && (
              <span className={`text-[11px] font-bold ${hasError ? "text-red-400" : "text-emerald-400"}`}>
                {hasError ? "✗" : "✓"}
              </span>
            )}
            {step.elapsedMs ? (
              <span className="text-[10px] text-[#52526e]">{(step.elapsedMs / 1000).toFixed(1)}s</span>
            ) : null}
          </div>
          {open
            ? <ChevronDown className="h-3 w-3 text-[#52526e] shrink-0" />
            : <ChevronRight className="h-3 w-3 text-[#52526e] shrink-0" />}
        </button>
        {open && (
          <div className="border-t border-[#1a1a24]">
            {step.params && Object.keys(step.params).length > 0 && (
              <div className="px-3 py-2 bg-[#0a0a0c] border-b border-[#1a1a24]">
                <p className="text-[9px] text-[#52526e] font-bold uppercase tracking-widest mb-1">Params</p>
                <pre className="text-[11px] font-mono whitespace-pre-wrap break-all text-[#a0a0c0]">{JSON.stringify(step.params, null, 2)}</pre>
              </div>
            )}
            {step.result && (
              <div className="px-3 py-2 space-y-2 bg-[#0a0a0c]">
                <p className="text-[9px] text-[#52526e] font-bold uppercase tracking-widest">Result</p>
                {screenshot && (
                  <img src={screenshot} alt="Screenshot" className="w-full rounded-lg border border-[#1a1a24] object-cover max-h-60" />
                )}
                <pre className={`text-[11px] font-mono whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed ${
                  hasError ? "text-red-400" : "text-emerald-300"
                }`}>{step.result}</pre>
              </div>
            )}
            {isRunning && (
              <div className="px-3 py-2.5 text-xs text-[#52526e] flex items-center gap-2 bg-[#0a0a0c]">
                <Loader2 className="h-3 w-3 animate-spin" />
                Executing…
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (step.type === "error") {
    return (
      <div className="border border-red-500/30 rounded-xl px-3 py-2.5 bg-red-500/5 flex items-start gap-2">
        <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0 mt-0.5" />
        <div className="text-sm text-red-400 whitespace-pre-wrap">{step.content}</div>
      </div>
    );
  }
  return null;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const EXAMPLE_TASKS = [
  "Create a Flask REST API with /hello, /time, and /echo endpoints. Install flask, test all endpoints",
  "Write a Python script to fetch top 10 Hacker News stories and display them formatted",
  "Build a simple todo CLI in Python with add/list/done/delete, save to JSON",
  "Create a web scraper that fetches the top 5 results from Python.org and saves to JSON",
  "Write a complete README.md for this Vesper AI proxy project",
];

const AGENT_CAPABLE_AI_IDS = new Set([
  "pollinations", "gemini", "groq", "openrouter",
  "chatgpt", "claude", "mistral", "cerebras", "deepseek", "together",
]);

const BEST_AGENT_MODELS: Record<string, string[]> = {
  pollinations: ["openai", "openai-large", "claude-sonnet-3-7"],
  gemini:       ["gemini-2.5-flash-preview-04-17", "gemini-2.0-flash", "gemini-1.5-pro"],
  groq:         ["llama-3.3-70b-versatile", "qwen-qwq-32b", "deepseek-r1-distill-llama-70b"],
  openrouter:   ["meta-llama/llama-3.3-70b-instruct:free", "google/gemma-3-27b-it:free"],
  chatgpt:      ["gpt-4o", "gpt-4.1", "o3"],
  claude:       ["claude-3-5-sonnet-20241022", "claude-3-7-sonnet-20250219"],
  mistral:      ["codestral-latest", "mistral-large-latest"],
  cerebras:     ["llama-3.3-70b", "qwen-3-32b"],
  deepseek:     ["deepseek-chat", "deepseek-reasoner"],
  together:     ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
};

// ─── Agent phase derived state ────────────────────────────────────────────────

type AgentPhase = "idle" | "starting" | "planning" | "coding" | "testing" | "fixing" | "installing" | "done" | "failed";

function derivePhase(isRunning: boolean, result: { success: boolean } | null, currentAction: string | null): AgentPhase {
  if (!isRunning && !result) return "idle";
  if (result?.success) return "done";
  if (result) return "failed";
  if (!currentAction) return "starting";
  const a = currentAction.toLowerCase();
  if (a.includes("plan") || a.includes("reason") || a.includes("think")) return "planning";
  if (a.includes("test") || a.includes("curl") || a.includes("verif")) return "testing";
  if (a.includes("fix") || a.includes("retry") || a.includes("error")) return "fixing";
  if (a.includes("install") || a.includes("package")) return "installing";
  return "coding";
}

const PHASE_CONFIG: Record<AgentPhase, { label: string; color: string; bg: string; border: string; pulse: boolean }> = {
  idle:       { label: "Idle",       color: "text-[#52526e]", bg: "bg-[#141420]",        border: "border-[#1a1a24]",    pulse: false },
  starting:   { label: "Starting…",  color: "text-amber-400", bg: "bg-amber-500/10",      border: "border-amber-500/20", pulse: true  },
  planning:   { label: "Planning",   color: "text-violet-400",bg: "bg-violet-500/10",     border: "border-violet-500/20",pulse: true  },
  coding:     { label: "Coding",     color: "text-blue-400",  bg: "bg-blue-500/10",       border: "border-blue-500/20",  pulse: true  },
  testing:    { label: "Testing",    color: "text-cyan-400",  bg: "bg-cyan-500/10",       border: "border-cyan-500/20",  pulse: true  },
  fixing:     { label: "Fixing",     color: "text-orange-400",bg: "bg-orange-500/10",     border: "border-orange-500/20",pulse: true  },
  installing: { label: "Installing", color: "text-amber-400", bg: "bg-amber-500/10",      border: "border-amber-500/20", pulse: true  },
  done:       { label: "Done",       color: "text-emerald-400",bg:"bg-emerald-500/10",    border: "border-emerald-500/20",pulse: false },
  failed:     { label: "Failed",     color: "text-red-400",   bg: "bg-red-500/10",        border: "border-red-500/20",   pulse: false },
};

// ─── Segmented step control ───────────────────────────────────────────────────

function MaxStepsControl({ value, onChange, disabled }: { value: number; onChange: (n: number) => void; disabled: boolean }) {
  return (
    <div className="flex items-center gap-1 bg-[#111118] border border-[#1a1a24] rounded-xl p-1">
      {[10, 20, 30, 50].map(n => (
        <button
          key={n}
          onClick={() => onChange(n)}
          disabled={disabled}
          className={`flex-1 text-[11px] py-1 rounded-lg font-bold transition-all
            ${value === n
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-[#52526e] hover:text-foreground disabled:cursor-not-allowed"
            }`}
        >
          {n}
        </button>
      ))}
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function AgentPage({ mobile = false }: { mobile?: boolean }) {
  const [task, setTask]               = useState("");
  const [agentType, setAgentType]     = useState<"builder" | "orchestrator" | "scholar">("builder");
  const [selectedAi, setSelectedAi]   = useState("pollinations");
  const [selectedModel, setSelectedModel] = useState("openai");
  const [maxSteps, setMaxSteps]       = useState(20);
  const [isRunning, setIsRunning]     = useState(false);
  const [isStopping, setIsStopping]   = useState(false);
  const [steps, setSteps]             = useState<AgentStep[]>([]);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [filesWritten, setFilesWritten] = useState<string[]>([]);
  const [result, setResult]           = useState<{
    success: boolean; summary?: string | null; error?: string | null; totalElapsedMs?: number | null;
  } | null>(null);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [showSetup, setShowSetup]     = useState(true);
  const [showTips, setShowTips]       = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ais } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const runAgentMutation = useRunAgent();

  const { data: statusData } = useGetAgentStatus({
    query: {
      queryKey: getGetAgentStatusQueryKey(),
      enabled: isRunning,
      refetchInterval: isRunning ? 1000 : false,
    }
  });

  const availableAis = (ais?.ais ?? []).filter((a: any) => AGENT_CAPABLE_AI_IDS.has(a.id));
  const currentAiInfo = availableAis.find((a: any) => a.id === selectedAi);
  const currentAiModels = (currentAiInfo?.models ?? []) as Array<{ id: string; name: string; tier?: string }>;
  const agentModels = currentAiModels.filter(m => {
    const best = BEST_AGENT_MODELS[selectedAi];
    return !best || best.includes(m.id) || m.id === "__auto__";
  });
  const modelsToShow = agentModels.length > 1 ? agentModels : currentAiModels;

  useEffect(() => {
    const ai = availableAis.find((a: any) => a.id === selectedAi);
    if (!ai) return;
    const models = (ai.models ?? []) as Array<{ id: string }>;
    const best = BEST_AGENT_MODELS[selectedAi];
    if (best) {
      const match = models.find(m => best.includes(m.id));
      if (match) { setSelectedModel(match.id); return; }
    }
    const auto = models.find(m => m.id === "__auto__");
    if (auto) setSelectedModel("__auto__");
    else if (models[0]) setSelectedModel(models[0].id);
  }, [selectedAi]);

  useEffect(() => {
    if (!statusData) return;
    if (statusData.steps) setSteps(statusData.steps as AgentStep[]);
    if (statusData.current_action) setCurrentAction(statusData.current_action);
    if (statusData.files_written) setFilesWritten(statusData.files_written);

    if (!statusData.running && isRunning) {
      setIsRunning(false);
      setIsStopping(false);
      setCurrentAction(null);
      if (statusData.result) {
        setResult(statusData.result);
        if (statusData.result.success) {
          toast({ title: "Task complete!", description: statusData.result.summary || undefined });
        } else if (statusData.result.error === "Agent stopped by user.") {
          toast({ title: "Agent stopped" });
        } else {
          toast({ title: "Task failed", description: statusData.result.error || undefined, variant: "destructive" });
        }
        queryClient.invalidateQueries({ queryKey: ["getFileTree"] });
      }
    }
  }, [statusData, isRunning]);

  useEffect(() => {
    if (steps.length > 0) {
      setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
    }
  }, [steps.length]);

  const phase = useMemo(() =>
    derivePhase(isRunning, result, currentAction), [isRunning, result, currentAction]);
  const phaseConfig = PHASE_CONFIG[phase];

  const handleRun = useCallback(() => {
    if (!task.trim()) return;
    setSteps([]);
    setResult(null);
    setCurrentAction("Starting…");
    setFilesWritten([]);
    setCurrentTask(task.trim());
    setIsRunning(true);
    setShowSetup(false);
    runAgentMutation.mutate(
      { data: { aiId: selectedAi, modelId: selectedModel || null, task: task.trim(), maxSteps, agentType } },
      {
        onError: err => {
          setIsRunning(false);
          setCurrentAction(null);
          toast({ title: "Failed to start agent", description: String(err), variant: "destructive" });
        }
      }
    );
  }, [task, agentType, selectedAi, selectedModel, maxSteps, runAgentMutation, toast]);

  const handleStop = async () => {
    if (!isRunning || isStopping) return;
    setIsStopping(true);
    try {
      const base = (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");
      await fetch(`${base}/api/agent/stop`, { method: "POST" });
    } catch {
      setIsStopping(false);
    }
  };

  const handleReset = () => {
    setSteps([]);
    setResult(null);
    setCurrentTask(null);
    setFilesWritten([]);
    setCurrentAction(null);
    setShowSetup(true);
  };

  const fmt = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
  const activeStepIndex = isRunning ? steps.length - 1 : -1;

  const tierColor = (tier?: string) => {
    if (tier === "pro") return "text-amber-400";
    if (tier === "plus") return "text-blue-400";
    return "text-emerald-400";
  };
  const tierLabel = (tier?: string) => {
    if (tier === "pro") return "Max";
    if (tier === "plus") return "Plus";
    return "Free";
  };

  return (
    <div className="flex flex-col h-full bg-[#0a0a0c] overflow-hidden">

      {/* ── Header ───────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#131318] bg-[#080809]">
        <div className="h-6 w-6 rounded-lg bg-gradient-to-br from-violet-500/30 to-primary/20 border border-primary/20
          flex items-center justify-center shrink-0">
          <Bot className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-[11px] font-bold text-[#3a3a5c] uppercase tracking-widest flex-1 min-w-0 truncate">
          Agent
        </span>

        {/* Phase badge */}
        <span className={`text-[9px] font-bold px-2 py-0.5 rounded-md border shrink-0
          ${phaseConfig.bg} ${phaseConfig.color} ${phaseConfig.border}`}>
          <span className={phaseConfig.pulse ? "animate-pulse" : ""}>
            {phaseConfig.label}
          </span>
        </span>

        {/* Toggle setup / log */}
        {currentTask && (
          <button
            onClick={() => setShowSetup(v => !v)}
            className="h-6 w-6 flex items-center justify-center rounded-lg text-[#3a3a5c] hover:text-foreground hover:bg-[#141420] transition-colors shrink-0"
            title={showSetup ? "Show execution log" : "Show setup"}
          >
            {showSetup
              ? <Activity className="h-3.5 w-3.5" />
              : <Bot className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>

      {/* ── Setup panel ──────────────────────────────────────────────── */}
      {showSetup && (
        <div className="flex-1 overflow-y-auto">
          <div className={`flex flex-col gap-3 p-3 ${mobile ? "max-w-lg mx-auto" : ""}`}>

            {/* Task textarea */}
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest">Task</label>
              <div className={`relative rounded-2xl border transition-colors
                ${task.trim() ? "border-primary/30 bg-[#0d0d12]" : "border-[#1a1a24] bg-[#0d0d12]"}
                focus-within:border-primary/50`}>
                <textarea
                  ref={textareaRef}
                  value={task}
                  onChange={e => setTask(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun(); }}
                  placeholder={"Describe what to build…\n\ne.g. Create a Flask API with /hello and /time endpoints"}
                  disabled={isRunning}
                  className={`w-full bg-transparent resize-none text-[13px] text-foreground
                    placeholder:text-[#3a3a5c] focus:outline-none leading-relaxed
                    px-3 pt-3 pb-2 ${mobile ? "min-h-40" : "min-h-28"}`}
                  style={{ minHeight: mobile ? 160 : 112 }}
                />
                <div className="flex items-center justify-between px-3 pb-2">
                  <span className="text-[9px] text-[#2a2a44]">Ctrl+Enter to run</span>
                  {task.trim() && (
                    <span className="text-[9px] text-primary font-medium">{task.length} chars</span>
                  )}
                </div>
              </div>
            </div>

            {/* Example chips */}
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest">Examples</label>
              <div className="space-y-1">
                {EXAMPLE_TASKS.map((ex, i) => (
                  <button
                    key={i}
                    onClick={() => { setTask(ex); textareaRef.current?.focus(); }}
                    disabled={isRunning}
                    className="w-full text-left text-[11px] text-[#52526e] hover:text-foreground px-2.5 py-1.5
                      rounded-xl border border-[#1a1a24] hover:border-primary/20 hover:bg-[#111118]
                      transition-all leading-snug disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {ex.slice(0, 70)}{ex.length > 70 ? "…" : ""}
                  </button>
                ))}
              </div>
            </div>

            {/* Agent Persona selector */}
            <div className="space-y-1.5">
              <label className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest">Agent Persona</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  {
                    id: "builder",
                    label: "Builder",
                    icon: <Zap className="h-3.5 w-3.5" />,
                    desc: "Plan, code, test & ship",
                    gradient: "from-blue-500/20 to-primary/10",
                    active: "border-primary/40 bg-primary/10 text-primary",
                    inactive: "border-[#1a1a24] text-[#52526e] hover:border-[#2a2a3c] hover:text-foreground",
                  },
                  {
                    id: "orchestrator",
                    label: "Orchestrator",
                    icon: <Sparkles className="h-3.5 w-3.5" />,
                    desc: "5 roles in one brain",
                    gradient: "from-violet-500/20 to-pink-500/10",
                    active: "border-violet-500/40 bg-violet-500/10 text-violet-400",
                    inactive: "border-[#1a1a24] text-[#52526e] hover:border-[#2a2a3c] hover:text-foreground",
                  },
                  {
                    id: "scholar",
                    label: "Scholar",
                    icon: <FileText className="h-3.5 w-3.5" />,
                    desc: "Research & papers",
                    gradient: "from-emerald-500/20 to-teal-500/10",
                    active: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
                    inactive: "border-[#1a1a24] text-[#52526e] hover:border-[#2a2a3c] hover:text-foreground",
                  },
                ] as const).map(({ id, label, icon, desc, active, inactive }) => (
                  <button
                    key={id}
                    onClick={() => setAgentType(id)}
                    disabled={isRunning}
                    className={`flex flex-col items-center gap-1.5 px-2 py-2.5 rounded-xl border text-center
                      transition-all duration-150 disabled:opacity-40 disabled:cursor-not-allowed
                      ${agentType === id ? active : inactive}`}
                  >
                    <span className="shrink-0">{icon}</span>
                    <span className="text-[11px] font-bold leading-none">{label}</span>
                    <span className="text-[9px] leading-tight opacity-70">{desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Provider + Model card */}
            <div className="rounded-2xl border border-[#1a1a24] bg-[#0d0d12] overflow-hidden">
              <div className="px-3 pt-2.5 pb-1">
                <label className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest">AI Provider</label>
              </div>
              <div className="px-2 pb-2">
                <Select value={selectedAi} onValueChange={setSelectedAi} disabled={isRunning}>
                  <SelectTrigger className="rounded-xl border-[#1a1a24] bg-[#111118] h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {availableAis.length > 0
                      ? availableAis.map((ai: any) => (
                          <SelectItem key={ai.id} value={ai.id}>
                            <span className="flex items-center gap-2">
                              {ai.name}
                              {!ai.hasSession && ai.id !== "pollinations" && (
                                <span className="text-[10px] text-[#52526e]">(no session)</span>
                              )}
                            </span>
                          </SelectItem>
                        ))
                      : <>
                          <SelectItem value="pollinations">Pollinations AI</SelectItem>
                          <SelectItem value="gemini">Google Gemini</SelectItem>
                          <SelectItem value="groq">Groq</SelectItem>
                          <SelectItem value="claude">Claude</SelectItem>
                          <SelectItem value="chatgpt">ChatGPT</SelectItem>
                        </>}
                  </SelectContent>
                </Select>
              </div>

              {modelsToShow.length > 0 && (
                <>
                  <div className="h-px bg-[#131318] mx-3" />
                  <div className="px-3 pt-2 pb-0.5">
                    <label className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest">Model</label>
                  </div>
                  <div className="px-2 pb-2">
                    <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isRunning}>
                      <SelectTrigger className="rounded-xl border-[#1a1a24] bg-[#111118] h-8 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {modelsToShow.map(m => (
                          <SelectItem key={m.id} value={m.id}>
                            <span className="flex items-center gap-1.5">
                              <span>{m.name}</span>
                              {m.tier && (
                                <span className={`text-[10px] font-bold ${tierColor(m.tier)}`}>
                                  {tierLabel(m.tier)}
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}
            </div>

            {/* Max Steps */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-bold text-[#3a3a5c] uppercase tracking-widest">Max Steps</label>
                <span className="text-[10px] font-bold text-primary">{maxSteps} steps</span>
              </div>
              <MaxStepsControl value={maxSteps} onChange={setMaxSteps} disabled={isRunning} />
            </div>

            {/* Run button */}
            <button
              onClick={handleRun}
              disabled={isRunning || !task.trim()}
              className={`relative w-full rounded-2xl font-bold text-sm tracking-wide
                flex items-center justify-center gap-2 transition-all duration-300
                ${mobile ? "h-14 text-base" : "h-11"}
                bg-gradient-to-r from-primary to-violet-500
                hover:from-primary/95 hover:to-violet-400
                hover:shadow-[0_0_28px_rgba(99,102,241,0.45),0_4px_16px_rgba(99,102,241,0.25)]
                hover:scale-[1.02] active:scale-[0.98]
                disabled:opacity-40 disabled:cursor-not-allowed
                disabled:hover:scale-100 disabled:hover:shadow-none
                text-white`}
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running…
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Agent
                </>
              )}
            </button>

            {/* Stop button */}
            {isRunning && (
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="w-full rounded-2xl h-9 font-semibold text-xs tracking-wide
                  flex items-center justify-center gap-2 transition-all
                  border border-red-500/30 text-red-400 hover:bg-red-500/10 hover:border-red-500/50
                  disabled:opacity-50"
              >
                {isStopping
                  ? <><Loader2 className="h-3.5 w-3.5 animate-spin" />Stopping…</>
                  : <><Square className="h-3.5 w-3.5" />Stop Agent</>}
              </button>
            )}

            {/* Live action pill */}
            {isRunning && currentAction && (
              <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-primary/5 border border-primary/20">
                <Activity className="h-3.5 w-3.5 text-primary shrink-0 animate-pulse" />
                <p className="text-[11px] text-primary font-medium truncate">{currentAction}</p>
              </div>
            )}

            {/* Collapsible tips */}
            {!isRunning && (
              <div className="rounded-xl border border-[#1a1a24] overflow-hidden">
                <button
                  onClick={() => setShowTips(v => !v)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-[#111118] transition-colors"
                >
                  <AlertCircle className="h-3 w-3 text-[#52526e] shrink-0" />
                  <span className="text-[10px] font-bold text-[#3a3a5c] uppercase tracking-widest flex-1">Tips</span>
                  {showTips
                    ? <ChevronUp className="h-3.5 w-3.5 text-[#52526e]" />
                    : <ChevronDown className="h-3.5 w-3.5 text-[#52526e]" />}
                </button>
                {showTips && (
                  <div className="px-3 pb-3 pt-1 space-y-1.5 border-t border-[#1a1a24] bg-[#0a0a0c]">
                    <p className="text-[10px] text-[#52526e] leading-relaxed">
                      • <strong className="text-[#a0a0c0]">Best models:</strong> Claude Sonnet, GPT-4o, Gemini 2.5 Flash, DeepSeek V3
                    </p>
                    <p className="text-[10px] text-[#52526e] leading-relaxed">
                      • <strong className="text-[#a0a0c0]">Pollinations (GPT-4o)</strong> is always free — great starting point
                    </p>
                    <p className="text-[10px] text-[#52526e] leading-relaxed">
                      • The agent auto-installs Python packages before running code
                    </p>
                    <p className="text-[10px] text-[#52526e] leading-relaxed">
                      • <strong className="text-[#a0a0c0]">Ctrl+Enter</strong> to run from the task input
                    </p>
                  </div>
                )}
              </div>
            )}

            <div className="h-1" />
          </div>
        </div>
      )}

      {/* ── Execution log ─────────────────────────────────────────────── */}
      {!showSetup && (
        <div className="flex-1 flex flex-col min-h-0">

          {/* Task bar */}
          {currentTask && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#131318] bg-[#080809]">
              {isRunning ? (
                <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
              ) : result?.success ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
              ) : result ? (
                <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
              ) : (
                <Bot className="h-3.5 w-3.5 text-[#52526e] shrink-0" />
              )}
              <span className="text-[12px] font-medium text-foreground truncate flex-1">{currentTask}</span>
              <div className="flex items-center gap-1.5 shrink-0">
                {steps.length > 0 && (
                  <span className="text-[9px] font-bold text-[#52526e] bg-[#141420] border border-[#1a1a24] px-1.5 py-0.5 rounded-md">
                    {steps.length} steps
                  </span>
                )}
                {result?.totalElapsedMs && (
                  <span className="text-[9px] font-bold text-[#52526e] bg-[#141420] border border-[#1a1a24] px-1.5 py-0.5 rounded-md">
                    {fmt(result.totalElapsedMs)}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Stop bar when running */}
          {isRunning && (
            <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-b border-[#131318] bg-[#080809]">
              <Activity className="h-3 w-3 text-primary animate-pulse shrink-0" />
              <span className="text-[11px] text-primary font-medium flex-1 truncate">
                {currentAction || "Working…"}
              </span>
              <button
                onClick={handleStop}
                disabled={isStopping}
                className="flex items-center gap-1 text-[10px] font-bold text-red-400 hover:text-red-300
                  px-2 py-1 rounded-lg border border-red-500/30 hover:bg-red-500/10 transition-colors"
              >
                {isStopping ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Square className="h-2.5 w-2.5" />}
                Stop
              </button>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-2">

              {/* Empty execution log */}
              {!currentTask && (
                <div className="flex flex-col items-center justify-center py-12 text-center px-3">
                  <div className="relative mb-4">
                    <div className="absolute inset-0 blur-2xl bg-primary/20 rounded-full scale-150 pointer-events-none" />
                    <div className="relative h-12 w-12 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <Sparkles className="h-6 w-6 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-sm font-bold mb-1">Ready to Build</h3>
                  <p className="text-[11px] text-[#52526e] leading-relaxed">
                    Describe your task and hit Run Agent. The AI will plan, code, test, and fix until it's done.
                  </p>
                </div>
              )}

              {/* Steps */}
              {steps.map((step, i) => (
                <StepCard
                  key={`${step.step}-${step.type}-${i}`}
                  step={step}
                  isActive={i === activeStepIndex}
                  defaultOpen={i === steps.length - 1}
                />
              ))}

              {/* Working indicator */}
              {isRunning && steps.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/15 border-dashed">
                  <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
                  <span className="text-[11px] text-primary font-medium">{currentAction || "Working…"}</span>
                </div>
              )}

              {/* Result banner */}
              {result && (
                <div className={`rounded-xl p-3 border ${
                  result.success
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-red-500/5 border-red-500/20"
                }`}>
                  <div className="flex items-start gap-2.5">
                    {result.success
                      ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                      : <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-xs font-bold mb-1 ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                        {result.success ? "Task Complete!" : "Task Failed"}
                      </p>
                      <p className={`text-[11px] leading-relaxed ${result.success ? "text-emerald-300" : "text-red-300"}`}>
                        {result.summary || result.error}
                      </p>
                      {filesWritten.length > 0 && result.success && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {filesWritten.map(f => (
                            <code key={f} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20">
                              {f}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* New task button */}
              {result && (
                <button
                  onClick={handleReset}
                  className="w-full flex items-center justify-center gap-2 text-xs text-[#52526e]
                    hover:text-foreground px-4 py-2.5 rounded-xl border border-[#1a1a24]
                    hover:border-primary/20 hover:bg-[#111118] transition-all"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Start a new task
                </button>
              )}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
