import { useState, useEffect, useRef } from "react";
import React from "react";
import { useRunAgent, useGetAgentStatus, getGetAgentStatusQueryKey, useListAis, getListAisQueryKey, AgentStep } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { 
  Bot, Play, CheckCircle2, XCircle, 
  ChevronDown, ChevronRight, Terminal, FileCode, FolderPlus,
  FileEdit, Trash2, List, Loader2, Sparkles, AlertCircle,
  Globe, Camera, Wifi, Clock, Server, Zap, WifiOff
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
  execute:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  background_exec:  "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  kill_process:     "bg-orange-500/10 text-orange-400 border-orange-500/20",
  write_file:       "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
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
  "Create a Flask REST API with /hello and /time endpoints, save it as hello_api.py, then run it to verify it works",
  "Write a Python script that generates a Fibonacci sequence, run it, and show the first 20 numbers",
  "Create a JavaScript file that fetches a JSON placeholder todo and logs it, then run it with Node",
  "Build a simple calculator CLI in Python (add, sub, mul, div), write tests for it, then run the tests",
  "Create a markdown README for this AI Proxy project explaining what it does and how to use it",
];

const SCREENSHOT_API_RE = /Screenshot API path: (\/api\/agent\/screenshot\/[^\s]+\.png)/;

function parseScreenshotPath(result: string): string | null {
  const m = result.match(SCREENSHOT_API_RE);
  return m ? m[1] : null;
}

function getStepSummary(step: AgentStep): string {
  const toolName = step.tool || "";
  const p = step.params || {};
  if (toolName === "execute" || toolName === "background_exec") return String((p as Record<string, unknown>).command ?? "").slice(0, 80);
  if (toolName === "write_file" || toolName === "read_file") return String((p as Record<string, unknown>).path ?? "");
  if (toolName === "http_get" || toolName === "http_post" || toolName === "screenshot_url") return String((p as Record<string, unknown>).url ?? "");
  if (toolName === "check_port") return `port ${(p as Record<string, unknown>).port}`;
  if (toolName === "sleep") return `${(p as Record<string, unknown>).seconds}s`;
  if (toolName === "create_dir" || toolName === "delete" || toolName === "list_dir") return String((p as Record<string, unknown>).path ?? "");
  return "";
}

function StepCard({ step, defaultOpen = false }: { step: AgentStep; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);

  if (step.type === "thought") {
    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center gap-2 px-3 py-2.5 bg-muted/30 hover:bg-muted/50 text-left"
          onClick={() => setOpen(!open)}
        >
          <Bot className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium flex-1">Step {step.step} — AI Reasoning</span>
          <span className="text-xs text-muted-foreground mr-1">{step.elapsedMs ? `${(step.elapsedMs/1000).toFixed(1)}s` : ""}</span>
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </button>
        {open && step.content && (
          <div className="px-4 py-3 text-sm border-t border-border bg-background">
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
    const screenshotPath = step.result ? parseScreenshotPath(step.result) : null;
    const isSuccess = step.result && !step.result.startsWith("ERROR");

    return (
      <div className="border border-border rounded-lg overflow-hidden">
        <button
          className="w-full flex items-center gap-2 px-3 py-2 bg-muted/20 hover:bg-muted/40 text-left"
          onClick={() => setOpen(!open)}
        >
          <Badge variant="outline" className={`gap-1 font-mono text-xs px-1.5 py-0 h-5 shrink-0 border ${colorClass}`}>
            {icon}
            {toolName}
          </Badge>
          {summary && (
            <code className="text-xs text-muted-foreground font-mono truncate flex-1">{summary}</code>
          )}
          {step.result && (
            <span className={`text-xs font-mono shrink-0 ${isSuccess ? "text-green-500" : "text-red-400"}`}>
              {isSuccess ? "✓" : "✗"}
            </span>
          )}
          {open ? <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
        </button>
        {open && (
          <div className="border-t border-border">
            {step.params && Object.keys(step.params).length > 0 && (
              <div className="px-3 py-2 bg-muted/10 border-b border-border">
                <p className="text-xs text-muted-foreground mb-1 font-medium">Parameters</p>
                <pre className="text-xs font-mono text-foreground whitespace-pre-wrap break-all">
                  {JSON.stringify(step.params, null, 2)}
                </pre>
              </div>
            )}
            {step.result && (
              <div className="px-3 py-2 space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Result</p>
                {screenshotPath && (
                  <div className="rounded-md overflow-hidden border border-border">
                    <img
                      src={screenshotPath}
                      alt="Screenshot"
                      className="w-full object-cover"
                      style={{ maxHeight: 400 }}
                    />
                  </div>
                )}
                <pre className={`text-xs font-mono whitespace-pre-wrap break-all max-h-64 overflow-y-auto ${
                  step.result.startsWith("ERROR") ? "text-red-400" : "text-green-300"
                }`}>
                  {step.result}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  if (step.type === "error") {
    return (
      <div className="border border-red-500/30 rounded-lg px-3 py-2.5 bg-red-500/5">
        <div className="flex items-center gap-2">
          <XCircle className="h-4 w-4 text-red-400 shrink-0" />
          <span className="text-sm text-red-400">{step.content}</span>
        </div>
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
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: ais } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const runAgentMutation = useRunAgent();

  // Poll agent status while running
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
        // Invalidate file tree in case new files were created
        queryClient.invalidateQueries({ queryKey: ["getFileTree"] });
      }
    }
  }, [statusData, isRunning]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [steps]);

  const handleRun = () => {
    if (!task.trim()) return;
    setSteps([]);
    setResult(null);
    setCurrentTask(task.trim());
    setIsRunning(true);

    runAgentMutation.mutate(
      { data: { aiId: selectedAi, task: task.trim(), maxSteps: 20 } },
      {
        onError: (err) => {
          setIsRunning(false);
          toast({ title: "Failed to start agent", description: String(err), variant: "destructive" });
        }
      }
    );
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 py-4 bg-background">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold">Agent Mode</h1>
            <p className="text-xs text-muted-foreground">Describe what to build — the agent plans, codes, runs, and fixes until done</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-hidden flex">
        {/* Left — task input + examples */}
        <div className="w-80 shrink-0 border-r border-border flex flex-col">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Task</label>
              <Textarea
                value={task}
                onChange={(e) => setTask(e.target.value)}
                placeholder="Describe what to build or do...&#10;&#10;e.g. Create a Flask REST API with user auth, save it to my_api.py, install dependencies, and test it"
                className="min-h-36 resize-none font-mono text-sm"
                disabled={isRunning}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleRun();
                }}
              />
            </div>

            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">AI Model</label>
              <Select value={selectedAi} onValueChange={setSelectedAi} disabled={isRunning}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ais?.ais?.map((ai) => (
                    <SelectItem key={ai.id} value={ai.id}>
                      {ai.name}
                    </SelectItem>
                  )) || (
                    <>
                      <SelectItem value="chatgpt">ChatGPT</SelectItem>
                      <SelectItem value="grok">Grok</SelectItem>
                      <SelectItem value="claude">Claude</SelectItem>
                    </>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleRun}
              disabled={isRunning || !task.trim()}
            >
              {isRunning ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Running...
                </>
              ) : (
                <>
                  <Play className="h-4 w-4" />
                  Run Agent
                </>
              )}
            </Button>

            {isRunning && (
              <p className="text-xs text-center text-muted-foreground">
                Agent is working... steps appear live on the right
              </p>
            )}

            <div className="space-y-2 pt-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Examples</p>
              {EXAMPLE_TASKS.map((ex, i) => (
                <button
                  key={i}
                  className="w-full text-left text-xs text-muted-foreground hover:text-foreground px-3 py-2 rounded-md border border-border hover:border-primary/40 hover:bg-muted/40 transition-colors"
                  onClick={() => setTask(ex)}
                  disabled={isRunning}
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Right — trace */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {/* Status bar */}
          {currentTask && (
            <div className="shrink-0 px-4 py-2.5 border-b border-border bg-muted/20 flex items-center gap-2">
              {isRunning ? (
                <Loader2 className="h-4 w-4 text-primary animate-spin shrink-0" />
              ) : result?.success ? (
                <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
              ) : result ? (
                <XCircle className="h-4 w-4 text-red-500 shrink-0" />
              ) : (
                <Bot className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span className="text-sm font-medium truncate">{currentTask}</span>
              <div className="ml-auto shrink-0 flex items-center gap-2">
                {steps.length > 0 && (
                  <Badge variant="secondary" className="font-mono text-xs">
                    {steps.length} step{steps.length !== 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
            </div>
          )}

          <ScrollArea className="flex-1">
            <div className="p-4 space-y-2">
              {!currentTask && (
                <div className="flex flex-col items-center justify-center py-24 text-center">
                  <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center mb-4">
                    <Bot className="h-8 w-8 text-primary" />
                  </div>
                  <h3 className="text-base font-semibold mb-1">Autonomous Coding Agent</h3>
                  <p className="text-sm text-muted-foreground max-w-sm">
                    Describe what you want built. The agent will write code, install packages, run tests, debug errors, and iterate until the task is complete.
                  </p>
                </div>
              )}

              {steps.map((step, i) => (
                <StepCard key={`${step.step}-${step.type}-${i}`} step={step} defaultOpen={i === steps.length - 1} />
              ))}

              {isRunning && steps.length > 0 && (
                <div className="flex items-center gap-2 px-3 py-2.5 border border-dashed border-border rounded-lg text-muted-foreground text-sm">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Agent thinking...
                </div>
              )}

              {result && (
                <div className={`rounded-lg border p-4 ${
                  result.success
                    ? "border-green-500/30 bg-green-500/5"
                    : "border-red-500/30 bg-red-500/5"
                }`}>
                  <div className="flex items-start gap-3">
                    {result.success ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500 shrink-0 mt-0.5" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
                    )}
                    <div>
                      <p className={`text-sm font-semibold ${result.success ? "text-green-400" : "text-red-400"}`}>
                        {result.success ? "Task Complete" : "Task Failed"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {result.success ? result.summary : result.error}
                      </p>
                      {result.totalElapsedMs && (
                        <p className="text-xs text-muted-foreground mt-1">
                          Completed in {formatDuration(result.totalElapsedMs)}
                        </p>
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
