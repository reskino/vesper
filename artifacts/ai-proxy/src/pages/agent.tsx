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
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import { useQueryClient } from "@tanstack/react-query";

const TOOL_ICONS: Record<string, React.JSX.Element> = {
  execute:          <Terminal className="h-3.5 w-3.5" />,
  background_exec:  <Server className="h-3.5 w-3.5" />,
  kill_process:     <WifiOff className="h-3.5 w-3.5" />,
  write_file:       <FileEdit className="h-3.5 w-3.5" />,
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
  execute:         "bg-blue-500/10 text-blue-400 border-blue-500/20",
  background_exec: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  kill_process:    "bg-orange-500/10 text-orange-400 border-orange-500/20",
  write_file:      "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  read_file:       "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  create_dir:      "bg-purple-500/10 text-purple-400 border-purple-500/20",
  delete:          "bg-red-500/10 text-red-400 border-red-500/20",
  list_dir:        "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  check_port:      "bg-teal-500/10 text-teal-400 border-teal-500/20",
  http_get:        "bg-sky-500/10 text-sky-400 border-sky-500/20",
  http_post:       "bg-violet-500/10 text-violet-400 border-violet-500/20",
  screenshot_url:  "bg-pink-500/10 text-pink-400 border-pink-500/20",
  sleep:           "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const EXAMPLE_TASKS = [
  "Create a Flask REST API with /hello and /time endpoints, save it as hello_api.py, then run it",
  "Write a Python Fibonacci script, run it, show the first 20 numbers",
  "Fetch a JSON placeholder todo with Node.js and log it",
  "Build a calculator CLI in Python with add/sub/mul/div, write tests, run them",
  "Create a README.md for this AI Proxy project",
];

const SCREENSHOT_RE = /Screenshot API path: (\/api\/agent\/screenshot\/[^\s]+\.png)/;

function parseScreenshot(r: string) {
  return r.match(SCREENSHOT_RE)?.[1] ?? null;
}

function getStepSummary(step: AgentStep) {
  const p = step.params as Record<string, unknown> | undefined ?? {};
  const t = step.tool || "";
  if (t === "execute" || t === "background_exec") return String(p.command ?? "").slice(0, 80);
  if (t === "write_file" || t === "read_file") return String(p.path ?? "");
  if (t === "http_get" || t === "http_post" || t === "screenshot_url") return String(p.url ?? "");
  if (t === "check_port") return `port ${p.port}`;
  if (t === "sleep") return `${p.seconds}s`;
  if (t === "create_dir" || t === "delete" || t === "list_dir") return String(p.path ?? "");
  return "";
}

function StepCard({ step, defaultOpen = false }: { step: AgentStep; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  if (step.type === "thought") {
    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <button className="w-full flex items-center gap-2.5 px-4 py-3 bg-muted/30 hover:bg-muted/50 text-left transition-colors" onClick={() => setOpen(!open)}>
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1">Step {step.step} — Reasoning</span>
          {step.elapsedMs ? <span className="text-xs text-muted-foreground mr-1">{(step.elapsedMs / 1000).toFixed(1)}s</span> : null}
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
    const ok = step.result && !step.result.startsWith("ERROR");

    return (
      <div className="border border-border rounded-xl overflow-hidden">
        <button className="w-full flex items-center gap-2.5 px-4 py-2.5 bg-muted/20 hover:bg-muted/40 text-left transition-colors" onClick={() => setOpen(!open)}>
          <Badge variant="outline" className={`gap-1 font-mono text-[10px] px-1.5 py-0 h-5 shrink-0 border ${colorClass}`}>
            {icon}
            {toolName}
          </Badge>
          {summary && <code className="text-xs text-muted-foreground font-mono truncate flex-1">{summary}</code>}
          {step.result && (
            <span className={`text-xs shrink-0 ${ok ? "text-emerald-500" : "text-red-400"}`}>{ok ? "✓" : "✗"}</span>
          )}
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
                <pre className={`text-xs font-mono whitespace-pre-wrap break-all max-h-56 overflow-y-auto ${
                  step.result.startsWith("ERROR") ? "text-red-400" : "text-emerald-300"
                }`}>{step.result}</pre>
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
        <span className="text-sm text-red-400">{step.content}</span>
      </div>
    );
  }
  return null;
}

export default function AgentPage() {
  const [task, setTask] = useState("");
  const [selectedAi, setSelectedAi] = useState("chatgpt");
  const [isRunning, setIsRunning] = useState(false);
  const [steps, setSteps] = useState<AgentStep[]>([]);
  const [result, setResult] = useState<{ success: boolean; summary?: string | null; error?: string | null; totalElapsedMs?: number | null } | null>(null);
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
      refetchInterval: isRunning ? 2000 : false,
    }
  });

  useEffect(() => {
    if (!statusData) return;
    if (statusData.steps) setSteps(statusData.steps as AgentStep[]);
    if (!statusData.running && isRunning) {
      setIsRunning(false);
      if (statusData.result) {
        setResult(statusData.result);
        if (statusData.result.success) {
          toast({ title: "Task complete!", description: statusData.result.summary || undefined });
        } else {
          toast({ title: "Task failed", description: statusData.result.error || undefined, variant: "destructive" });
        }
        queryClient.invalidateQueries({ queryKey: ["getFileTree"] });
      }
    }
  }, [statusData, isRunning]);

  useEffect(() => {
    if (steps.length > 0) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const handleRun = () => {
    if (!task.trim()) return;
    setSteps([]);
    setResult(null);
    setCurrentTask(task.trim());
    setIsRunning(true);
    setInputCollapsed(true);
    runAgentMutation.mutate(
      { data: { aiId: selectedAi, task: task.trim(), maxSteps: 20 } },
      { onError: err => { setIsRunning(false); toast({ title: "Failed to start agent", description: String(err), variant: "destructive" }); } }
    );
  };

  const fmt = (ms: number) => ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Page header */}
      <div className="shrink-0 border-b border-border px-4 sm:px-6 py-3.5 bg-background">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-extrabold tracking-tight">Agent Mode</h1>
            <p className="text-xs font-medium text-muted-foreground hidden sm:block">
              Describe what to build — the agent plans, codes, runs &amp; fixes until done
            </p>
          </div>
          {/* Mobile collapse/expand task input */}
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

        {/* ── Left panel — task input ───────────────────────────── */}
        <div className={`shrink-0 border-b sm:border-b-0 sm:border-r border-border flex flex-col bg-background
          sm:w-80 ${inputCollapsed ? "hidden sm:flex" : "flex"}`}>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">

            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Task</label>
              <Textarea
                value={task}
                onChange={e => setTask(e.target.value)}
                placeholder={"Describe what to build…\n\ne.g. Create a Flask REST API, save to my_api.py, install deps, and test it"}
                className="min-h-32 resize-none text-sm"
                disabled={isRunning}
                onKeyDown={e => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun(); }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Model</label>
              <Select value={selectedAi} onValueChange={setSelectedAi} disabled={isRunning}>
                <SelectTrigger className="rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ais?.ais?.map(ai => (
                    <SelectItem key={ai.id} value={ai.id}>{ai.name}</SelectItem>
                  )) ?? (
                    <>
                      <SelectItem value="chatgpt">ChatGPT</SelectItem>
                      <SelectItem value="grok">Grok</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button className="w-full gap-2 rounded-xl" onClick={handleRun} disabled={isRunning || !task.trim()}>
              {isRunning
                ? <><Loader2 className="h-4 w-4 animate-spin" />Running…</>
                : <><Play className="h-4 w-4" />Run Agent</>}
            </Button>

            {isRunning && (
              <p className="text-xs text-center text-muted-foreground">
                Agent is working — steps appear live below
              </p>
            )}

            {!isRunning && (
              <p className="text-[10px] text-muted-foreground text-center leading-relaxed">
                💡 ChatGPT and Claude follow the tool format most reliably. Mistral, Groq, and other models may loop — switch models if you see repeated steps.
              </p>
            )}

            <div className="space-y-2 pt-1">
              <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest">Examples</p>
              {EXAMPLE_TASKS.map((ex, i) => (
                <button
                  key={i}
                  className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-xl border border-border hover:border-primary/30 hover:bg-muted/40 transition-colors"
                  onClick={() => setTask(ex)}
                  disabled={isRunning}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right panel — trace ───────────────────────────────── */}
        <div className="flex-1 overflow-hidden flex flex-col min-h-0">
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
              {steps.length > 0 && (
                <Badge variant="secondary" className="font-mono text-xs shrink-0">
                  {steps.length} step{steps.length !== 1 ? "s" : ""}
                </Badge>
              )}
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {!currentTask && (
                <div className="flex flex-col items-center justify-center py-20 text-center px-4">
                  <div className="relative mb-5">
                    <div className="absolute inset-0 blur-2xl bg-primary/20 rounded-full scale-[2] opacity-60" />
                    <div className="relative h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20">
                      <Bot className="h-8 w-8 text-primary" />
                    </div>
                  </div>
                  <h3 className="text-xl font-black tracking-tight mb-2">Autonomous Coding Agent</h3>
                  <p className="text-sm font-medium text-muted-foreground max-w-sm leading-relaxed">
                    Describe what you want built. The agent writes code, installs packages, runs tests, debugs errors, and iterates until complete.
                  </p>
                </div>
              )}

              {steps.map((step, i) => (
                <StepCard key={`${step.step}-${step.type}-${i}`} step={step} defaultOpen={i === steps.length - 1} />
              ))}

              {isRunning && steps.length > 0 && (
                <div className="flex items-center gap-2.5 px-4 py-3 border border-dashed border-border rounded-xl text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Agent thinking…
                </div>
              )}

              {result && (
                <div className={`rounded-xl border p-4 ${
                  result.success ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"
                }`}>
                  <div className="flex items-start gap-3">
                    {result.success
                      ? <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
                      : <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />}
                    <div>
                      <p className={`text-sm font-bold ${result.success ? "text-emerald-400" : "text-red-400"}`}>
                        {result.success ? "Task Complete" : "Task Failed"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {result.success ? result.summary : result.error}
                      </p>
                      {result.totalElapsedMs && (
                        <p className="text-xs text-muted-foreground mt-1">Completed in {fmt(result.totalElapsedMs)}</p>
                      )}
                    </div>
                  </div>
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
