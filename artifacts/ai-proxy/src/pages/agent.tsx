import { useState, useEffect, useRef } from "react";
import React from "react";
import {
  useRunAgent, useGetAgentStatus, getGetAgentStatusQueryKey,
  useListAis, getListAisQueryKey, AgentStep,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Bot, Play, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Terminal, FileCode, FolderPlus,
  FileEdit, Trash2, List, Loader2, Sparkles, AlertCircle,
  Globe, Camera, Wifi, Clock, Server, Zap, WifiOff, ChevronUp,
  Square, Package, FileDiff, FileText, RefreshCw, Activity,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { useQueryClient } from "@tanstack/react-query";

const TOOL_ICONS: Record<string, React.JSX.Element> = {
  install_packages: <Package className="h-3.5 w-3.5" />,
  execute:          <Terminal className="h-3.5 w-3.5" />,
  background_exec:  <Server className="h-3.5 w-3.5" />,
  kill_process:     <WifiOff className="h-3.5 w-3.5" />,
  write_file:       <FileEdit className="h-3.5 w-3.5" />,
  patch_file:       <FileDiff className="h-3.5 w-3.5" />,
  read_file:        <FileCode className="h-3.5 w-3.5" />,
  create_dir:       <FolderPlus className="h-3.5 w-3.5" />,
  delete:           <Trash2 className="h-3.5 w-3.5" />,
  list_dir:         <List className="h-3.5 w-3.5" />,
  check_port:       <Wifi className="h-3.5 w-3.5" />,
  http_get:         <Globe className="h-3.5 w-3.5" />,
  http_post:        <Zap className="h-3.5 w-3.5" />,
  screenshot_url:   <Camera className="h-3.5 w-3.5" />,
  sleep:            <Clock className="h-3.5 w-3.5" />,
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

const EXAMPLE_TASKS = [
  "Create a Flask REST API with /hello, /time, and /echo endpoints. Install flask, test all endpoints with curl",
  "Write a Python script to fetch top 10 Hacker News stories using the API and display them formatted",
  "Build a simple todo list CLI in Python with add/list/done/delete commands, save to a JSON file",
  "Create a web scraper in Python that fetches the top 5 results from Python.org and saves them to a JSON file",
  "Write a complete README.md for this Vesper AI proxy project with installation, usage, and features",
];

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
  if (t === "execute" || t === "background_exec") return String(p.command ?? "").slice(0, 80);
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

function StepCard({
  step, isActive = false, defaultOpen = false,
}: {
  step: AgentStep; isActive?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);

  // Auto-open when step becomes active
  useEffect(() => {
    if (isActive) setOpen(true);
  }, [isActive]);

  if (step.type === "thought") {
    return (
      <div className={`border rounded-xl overflow-hidden transition-all ${
        isActive ? "border-primary/40 shadow-[0_0_12px_rgba(var(--primary)/0.15)]" : "border-border"
      }`}>
        <button
          className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/30 hover:bg-muted/50 text-left transition-colors"
          onClick={() => setOpen(!open)}
        >
          {isActive
            ? <Loader2 className="h-4 w-4 text-primary shrink-0 animate-spin" />
            : <Bot className="h-4 w-4 text-primary shrink-0" />}
          <span className="text-sm font-medium flex-1">
            Step {step.step} — {isActive ? "Reasoning…" : "Reasoning"}
          </span>
          {step.elapsedMs ? (
            <span className="text-xs text-muted-foreground mr-1">{(step.elapsedMs / 1000).toFixed(1)}s</span>
          ) : null}
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && step.content && (
          <div className="px-4 py-3 border-t border-border text-sm bg-background">
            <MarkdownRenderer content={step.content} />
          </div>
        )}
      </div>
    );
  }

  if (step.type === "tool") {
    const toolName = step.tool || "tool";
    const colorClass = TOOL_COLORS[toolName] || "bg-muted text-muted-foreground border-border";
    const icon = TOOL_ICONS[toolName] || <Terminal className="h-3.5 w-3.5" />;
    const summary = getStepSummary(step);
    const screenshot = step.result ? parseScreenshot(step.result) : null;
    const hasResult = !!step.result;
    const hasError = isToolError(step.result);
    const isRunning = isActive && !hasResult;

    return (
      <div className={`border rounded-xl overflow-hidden transition-all ${
        isActive ? "border-primary/40 shadow-[0_0_12px_rgba(var(--primary)/0.15)]" : "border-border"
      }`}>
        <button
          className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-muted/20 hover:bg-muted/40 text-left transition-colors"
          onClick={() => setOpen(!open)}
        >
          <Badge variant="outline" className={`gap-1 font-mono text-[10px] px-1.5 py-0 h-5 shrink-0 border ${colorClass}`}>
            {icon}
            {toolName}
          </Badge>
          {summary && <code className="text-xs text-muted-foreground font-mono truncate flex-1">{summary}</code>}
          <div className="flex items-center gap-1.5 shrink-0">
            {isRunning && (
              <span className="flex gap-0.5">
                <span className="h-1.5 w-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                <span className="h-1.5 w-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                <span className="h-1.5 w-1.5 bg-primary/60 rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
              </span>
            )}
            {hasResult && (
              <span className={`text-xs ${hasError ? "text-red-400" : "text-emerald-500"}`}>
                {hasError ? "✗" : "✓"}
              </span>
            )}
            {step.elapsedMs ? (
              <span className="text-[10px] text-muted-foreground">{(step.elapsedMs / 1000).toFixed(1)}s</span>
            ) : null}
          </div>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>
        {open && (
          <div className="border-t border-border">
            {step.params && Object.keys(step.params).length > 0 && (
              <div className="px-4 py-2.5 bg-muted/10 border-b border-border">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider mb-1">Parameters</p>
                <pre className="text-xs font-mono whitespace-pre-wrap break-all">{JSON.stringify(step.params, null, 2)}</pre>
              </div>
            )}
            {step.result && (
              <div className="px-4 py-2.5 space-y-2">
                <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wider">Result</p>
                {screenshot && (
                  <img src={screenshot} alt="Screenshot" className="w-full rounded-lg border border-border object-cover max-h-80" />
                )}
                <pre className={`text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto leading-relaxed ${
                  hasError ? "text-red-400" : "text-emerald-300"
                }`}>{step.result}</pre>
              </div>
            )}
            {isRunning && (
              <div className="px-4 py-3 text-xs text-muted-foreground flex items-center gap-2">
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
      <div className="border border-red-500/30 rounded-xl px-4 py-3 bg-red-500/5 flex items-start gap-2.5">
        <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
        <div className="text-sm text-red-400 whitespace-pre-wrap">{step.content}</div>
      </div>
    );
  }
  return null;
}

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

export default function AgentPage() {
  const [task, setTask] = useState("");
  const [selectedAi, setSelectedAi] = useState("pollinations");
  const [selectedModel, setSelectedModel] = useState("openai");
  const [maxSteps, setMaxSteps] = useState(20);
  const [isRunning, setIsRunning] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [currentAction, setCurrentAction] = useState<string | null>(null);
  const [filesWritten, setFilesWritten] = useState<string[]>([]);
  const [result, setResult] = useState<{
    success: boolean;
    summary?: string | null;
    error?: string | null;
    totalElapsedMs?: number | null;
  } | null>(null);
  const [currentTask, setCurrentTask] = useState<string | null>(null);
  const [inputCollapsed, setInputCollapsed] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ais } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const runAgentMutation = useRunAgent();

  const { data: statusData } = useGetAgentStatus({
    query: {
      queryKey: getGetAgentStatusQueryKey(),
      enabled: isRunning,
      refetchInterval: isRunning ? 1000 : false,   // poll every 1s for live updates
    }
  });

  const availableAis = (ais?.ais ?? []).filter(a => AGENT_CAPABLE_AI_IDS.has(a.id));

  const currentAiInfo = availableAis.find(a => a.id === selectedAi);
  const currentAiModels = (currentAiInfo?.models ?? []) as Array<{ id: string; name: string; tier?: string }>;
  const agentModels = currentAiModels.filter(m => {
    const best = BEST_AGENT_MODELS[selectedAi];
    return !best || best.includes(m.id) || m.id === "__auto__";
  });
  const modelsToShow = agentModels.length > 1 ? agentModels : currentAiModels;

  useEffect(() => {
    const ai = availableAis.find(a => a.id === selectedAi);
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
          toast({ title: "Agent stopped", description: "The agent was stopped." });
        } else {
          toast({
            title: "Task failed",
            description: statusData.result.error || undefined,
            variant: "destructive",
          });
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

  const handleRun = () => {
    if (!task.trim()) return;
    setSteps([]);
    setResult(null);
    setCurrentAction("Starting…");
    setFilesWritten([]);
    setCurrentTask(task.trim());
    setIsRunning(true);
    setInputCollapsed(true);
    runAgentMutation.mutate(
      { data: { aiId: selectedAi, modelId: selectedModel || null, task: task.trim(), maxSteps } },
      {
        onError: err => {
          setIsRunning(false);
          setCurrentAction(null);
          toast({ title: "Failed to start agent", description: String(err), variant: "destructive" });
        }
      }
    );
  };

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

  const fmt = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

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

  // Determine which step is the "active" one (last step if running)
  const activeStepIndex = isRunning ? steps.length - 1 : -1;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* ── Header ─────────────────────────────────────────────────── */}
      <div className="shrink-0 border-b border-border px-4 sm:px-6 py-3.5 bg-background">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-extrabold tracking-tight">Autonomous Agent</h1>
            <p className="text-xs font-medium text-muted-foreground hidden sm:block">
              Describe what to build — the agent plans, installs deps, codes, tests &amp; fixes until done
            </p>
          </div>
          {currentTask && (
            <button
              className="sm:hidden h-8 w-8 flex items-center justify-center rounded-xl text-muted-foreground hover:bg-muted transition-colors"
              onClick={() => setInputCollapsed(c => !c)}
            >
              {inputCollapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col sm:flex-row">

        {/* ── Left panel — task input ───────────────────────────────── */}
        <div className={`shrink-0 border-b sm:border-b-0 sm:border-r border-border flex flex-col bg-background
          sm:w-80 ${inputCollapsed ? "hidden sm:flex" : "flex"}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Task</label>
              <Textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                placeholder={"Describe what to build…\n\ne.g. Create a Flask API with /hello and /time endpoints, install flask, start it, and test all endpoints"}
                className="min-h-36 resize-none text-sm"
                disabled={isRunning}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun(); }}
              />
            </div>

            {/* AI Provider */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">AI Provider</label>
              <Select value={selectedAi} onValueChange={setSelectedAi} disabled={isRunning}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {availableAis.length > 0
                    ? availableAis.map(ai => (
                        <SelectItem key={ai.id} value={ai.id}>
                          <span className="flex items-center gap-2">
                            {ai.name}
                            {!ai.hasSession && ai.id !== "pollinations" && (
                              <span className="text-[10px] text-muted-foreground">(no session)</span>
                            )}
                          </span>
                        </SelectItem>
                      ))
                    : (
                      <>
                        <SelectItem value="pollinations">Pollinations AI</SelectItem>
                        <SelectItem value="gemini">Google Gemini</SelectItem>
                        <SelectItem value="groq">Groq</SelectItem>
                        <SelectItem value="claude">Claude</SelectItem>
                        <SelectItem value="chatgpt">ChatGPT</SelectItem>
                      </>
                    )}
                </SelectContent>
              </Select>
            </div>

            {/* Model */}
            {modelsToShow.length > 0 && (
              <div className="space-y-2">
                <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Model</label>
                <Select value={selectedModel} onValueChange={setSelectedModel} disabled={isRunning}>
                  <SelectTrigger className="rounded-xl">
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
            )}

            {/* Max steps */}
            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">
                Max Steps <span className="ml-1 normal-case font-normal">({maxSteps})</span>
              </label>
              <div className="flex gap-1.5">
                {[10, 20, 30, 50].map(n => (
                  <button
                    key={n}
                    onClick={() => setMaxSteps(n)}
                    disabled={isRunning}
                    className={`flex-1 text-xs py-1.5 rounded-lg border transition-colors font-medium
                      ${maxSteps === n
                        ? "bg-primary text-primary-foreground border-primary"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground"}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>

            {/* Run / Stop */}
            <div className="space-y-2">
              <Button
                className="w-full gap-2 rounded-xl"
                onClick={handleRun}
                disabled={isRunning || !task.trim()}
              >
                {isRunning
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Running…</>
                  : <><Play className="h-4 w-4" />Run Agent</>}
              </Button>
              {isRunning && (
                <Button
                  variant="outline"
                  className="w-full gap-2 rounded-xl border-red-500/30 text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  onClick={handleStop}
                  disabled={isStopping}
                >
                  {isStopping
                    ? <><Loader2 className="h-4 w-4 animate-spin" />Stopping…</>
                    : <><Square className="h-4 w-4" />Stop Agent</>}
                </Button>
              )}
            </div>

            {/* Current action live indicator */}
            {isRunning && currentAction && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/5 border border-primary/20">
                <Activity className="h-3.5 w-3.5 text-primary shrink-0 animate-pulse" />
                <p className="text-[11px] text-primary font-medium truncate">{currentAction}</p>
              </div>
            )}

            {/* Files written */}
            {filesWritten.length > 0 && (
              <div className="rounded-xl border border-border bg-muted/20 p-3">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5">
                  Files Written ({filesWritten.length})
                </p>
                <div className="space-y-0.5">
                  {filesWritten.map(f => (
                    <div key={f} className="flex items-center gap-1.5">
                      <FileText className="h-3 w-3 text-emerald-400 shrink-0" />
                      <code className="text-[11px] text-emerald-400 font-mono truncate">{f}</code>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tips */}
            {!isRunning && (
              <div className="rounded-xl border border-border bg-muted/20 p-3 space-y-1.5">
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-widest">Tips</p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  • <strong>Best models:</strong> Claude Sonnet, GPT-4o, Gemini 2.5 Flash, DeepSeek V3 — follow tool format most reliably.
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  • <strong>Pollinations</strong> (GPT-4o via proxy) is always free — great starting point.
                </p>
                <p className="text-[10px] text-muted-foreground leading-relaxed">
                  • The agent now auto-installs Python packages before running code.
                </p>
              </div>
            )}

            {/* Example tasks */}
            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Examples</p>
              {EXAMPLE_TASKS.map((ex, i) => (
                <button
                  key={i}
                  className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/40 transition-colors leading-snug"
                  onClick={() => setTask(ex)}
                  disabled={isRunning}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right panel — execution trace ─────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">

          {/* Task header bar */}
          {currentTask && (
            <div className="shrink-0 px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2">
              {isRunning ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              ) : result?.success ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500 shrink-0" />
              ) : result ? (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium truncate flex-1">{currentTask}</span>
              <div className="flex items-center gap-2 shrink-0">
                {steps.length > 0 && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {steps.length} step{steps.length !== 1 ? "s" : ""}
                  </Badge>
                )}
                {result?.totalElapsedMs && (
                  <Badge variant="outline" className="font-mono text-xs text-muted-foreground">
                    {fmt(result.totalElapsedMs)}
                  </Badge>
                )}
              </div>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">

              {/* Empty state */}
              {!currentTask && (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <div className="relative mb-5">
                    <div className="absolute inset-[-40px] blur-2xl bg-primary/20 rounded-full opacity-50 pointer-events-none" style={{zIndex: -1}} />
                    <div className="relative h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <Sparkles className="h-8 w-8 text-primary" />
                    </div>
                  </div>
                  <h2 className="text-base font-bold mb-2">Ready to Build</h2>
                  <p className="text-sm text-muted-foreground max-w-xs leading-relaxed">
                    Describe what to build on the left. The agent will plan, write code, install packages, run it, fix errors, and test everything automatically.
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 text-[11px] text-muted-foreground max-w-xs">
                    {[
                      ["📦", "Installs dependencies"],
                      ["✍️", "Writes complete files"],
                      ["🔄", "Reads back to verify"],
                      ["🧪", "Tests every endpoint"],
                      ["🐛", "Fixes errors on the fly"],
                      ["📸", "Screenshots web UIs"],
                    ].map(([icon, label]) => (
                      <div key={label} className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg bg-muted/30 border border-border">
                        <span>{icon}</span>
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
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

              {/* Running indicator between steps */}
              {isRunning && steps.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 rounded-xl bg-primary/5 border border-primary/20 border-dashed">
                  <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
                  <span className="text-xs text-primary font-medium">
                    {currentAction || "Working…"}
                  </span>
                </div>
              )}

              {/* Result banner */}
              {result && (
                <div className={`rounded-xl p-4 border ${
                  result.success
                    ? "bg-emerald-500/5 border-emerald-500/20"
                    : "bg-red-500/5 border-red-500/20"
                }`}>
                  <div className="flex items-start gap-3">
                    {result.success
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                      : <XCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />}
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-bold mb-1 ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                        {result.success ? "Task Complete!" : "Task Failed"}
                      </p>
                      <p className={`text-xs leading-relaxed ${result.success ? "text-emerald-300" : "text-red-300"}`}>
                        {result.summary || result.error}
                      </p>
                      {filesWritten.length > 0 && result.success && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {filesWritten.map(f => (
                            <code key={f} className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 font-mono border border-emerald-500/20">
                              {f}
                            </code>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* New task button after completion */}
              {result && (
                <div className="flex justify-center pt-2">
                  <button
                    className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground px-4 py-2 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/40 transition-colors"
                    onClick={() => {
                      setSteps([]);
                      setResult(null);
                      setCurrentTask(null);
                      setFilesWritten([]);
                      setCurrentAction(null);
                      setInputCollapsed(false);
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Start a new task
                  </button>
                </div>
              )}

              <div ref={bottomRef} />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}
