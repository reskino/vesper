import { useState, useEffect, useCallback, useRef } from "react";
import { useIDE } from "@/contexts/ide-context";
import { useListAis } from "@workspace/api-client-react";
import {
  Play, Square, Trash2, RefreshCw, Plus, ChevronDown,
  ChevronRight, Terminal, FileEdit, Globe, Package, Wifi,
  Loader2, CheckCircle2, XCircle, Clock, Zap, Users,
  AlertCircle, Camera, List, FileDiff, FolderPlus, FileCode,
  WifiOff, Server, Search, FileText, Bot,
} from "lucide-react";
import { toast } from "sonner";

const BASE_URL = ((import.meta.env.BASE_URL as string) ?? "/").replace(/\/$/, "") + "/";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentStep {
  step: number;
  type: "thought" | "tool" | "error";
  tool?: string;
  params?: Record<string, unknown>;
  result?: string;
  content?: string;
  elapsedMs?: number;
}

interface AgentStatus {
  agent_id: string;
  label?: string;
  role?: string;
  ai_id?: string;
  model_id?: string;
  running: boolean;
  task?: string;
  current_action?: string | null;
  steps: AgentStep[];
  result?: {
    success: boolean;
    summary?: string | null;
    error?: string | null;
    totalElapsedMs?: number;
  } | null;
  files_written?: string[];
  created_at?: number;
}

// ─── Provider + model config (mirrors agent.tsx) ───────────────────────────

const AGENT_CAPABLE_AI_IDS = new Set([
  "pollinations", "llm7",
  "gemini", "groq", "openrouter",
  "chatgpt", "claude", "mistral", "cerebras", "deepseek", "together",
  "nvidia", "github", "huggingface", "kluster", "siliconflow", "zhipu",
]);

const BEST_AGENT_MODELS: Record<string, string[]> = {
  pollinations: ["openai-large", "openai", "claude-sonnet-3-7"],
  llm7:         ["codestral-latest", "gpt-oss-20b", "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo"],
  chatgpt:      ["gpt-4o", "gpt-4.1", "o3"],
  claude:       ["claude-3-7-sonnet-20250219", "claude-3-5-sonnet-20241022"],
  gemini:       ["gemini-2.5-flash-preview-04-17", "gemini-2.0-flash", "gemini-1.5-pro"],
  groq:         ["llama-3.3-70b-versatile", "qwen-qwq-32b", "deepseek-r1-distill-llama-70b"],
  openrouter:   ["meta-llama/llama-3.3-70b-instruct:free", "google/gemma-3-27b-it:free", "deepseek/deepseek-r1:free"],
  mistral:      ["codestral-latest", "mistral-large-latest"],
  cerebras:     ["llama-3.3-70b", "qwen-3-32b"],
  deepseek:     ["deepseek-chat", "deepseek-reasoner"],
  together:     ["meta-llama/Llama-3.3-70B-Instruct-Turbo"],
  nvidia:       ["meta/llama-3.3-70b-instruct", "nvidia/llama-3.3-nemotron-super-49b-v1", "meta/llama-4-maverick-17b-128e-instruct"],
  github:       ["gpt-4o", "DeepSeek-R1", "Meta-Llama-3.3-70B-Instruct"],
  huggingface:  ["moonshotai/Kimi-K2.5", "deepseek-ai/DeepSeek-R1", "openai/gpt-oss-120b"],
  kluster:      ["deepseek-ai/DeepSeek-R1-0528", "klusterai/Meta-Llama-3.3-70B-Instruct-Turbo", "meta-llama/Llama-4-Maverick-17B-128E-Instruct-FP8"],
  siliconflow:  ["Qwen/Qwen3-8B", "deepseek-ai/DeepSeek-R1-Distill-Qwen-7B"],
  zhipu:        ["glm-4", "glm-4-airx", "glm-4-air"],
};

// ─── Tool visuals ─────────────────────────────────────────────────────────────

const TOOL_ICONS: Record<string, React.ReactElement> = {
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
  web_search:       <Search className="h-3 w-3" />,
  web_scrape:       <FileText className="h-3 w-3" />,
  sleep:            <Clock className="h-3 w-3" />,
};

const TOOL_COLORS: Record<string, string> = {
  install_packages: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  execute:          "bg-blue-500/10 text-blue-400 border-blue-500/20",
  background_exec:  "bg-indigo-500/10 text-indigo-400 border-indigo-500/20",
  write_file:       "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  read_file:        "bg-yellow-500/10 text-yellow-400 border-yellow-500/20",
  http_get:         "bg-sky-500/10 text-sky-400 border-sky-500/20",
  http_post:        "bg-violet-500/10 text-violet-400 border-violet-500/20",
  web_search:       "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  web_scrape:       "bg-teal-500/10 text-teal-400 border-teal-500/20",
  default:          "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

const ROLE_COLORS: Record<string, string> = {
  builder:      "bg-primary/10 text-primary border-primary/20",
  scholar:      "bg-purple-500/10 text-purple-400 border-purple-500/20",
  search_master:"bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  orchestrator: "bg-amber-500/10 text-amber-400 border-amber-500/20",
};

const ROLE_LABELS: Record<string, string> = {
  builder: "Builder", scholar: "Scholar",
  search_master: "Search Master", orchestrator: "Orchestrator",
};

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchAgents(): Promise<AgentStatus[]> {
  const r = await fetch(`${BASE_URL}api/agents`);
  const d = await r.json();
  return d.agents || [];
}

async function spawnAgent(payload: {
  aiId: string; task: string; role: string; maxSteps: number;
  modelId?: string; label?: string;
}): Promise<{ agentId: string }> {
  const r = await fetch(`${BASE_URL}api/agents/spawn`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return r.json();
}

async function stopAgent(agentId: string) {
  await fetch(`${BASE_URL}api/agents/${agentId}/stop`, { method: "POST" });
}

async function clearAgent(agentId: string) {
  await fetch(`${BASE_URL}api/agents/${agentId}`, { method: "DELETE" });
}

async function clearDone() {
  await fetch(`${BASE_URL}api/agents/clear-done`, { method: "POST" });
}

// ─── AgentCard ────────────────────────────────────────────────────────────────

function AgentCard({ agent, onStop, onClear }: {
  agent: AgentStatus;
  onStop: () => void;
  onClear: () => void;
}) {
  const [expanded, setExpanded] = useState(agent.running);
  const toolSteps = agent.steps.filter(s => s.type === "tool");
  const errorSteps = agent.steps.filter(s => s.type === "error");

  const statusColor = agent.running
    ? "border-primary/30 bg-primary/5"
    : agent.result?.success
      ? "border-emerald-500/30 bg-emerald-500/5"
      : "border-red-500/30 bg-red-500/5";

  const elapsed = agent.result?.totalElapsedMs
    ? `${(agent.result.totalElapsedMs / 1000).toFixed(1)}s`
    : null;

  const shortModel = agent.model_id
    ? agent.model_id.split("/").pop()?.split(":")[0] ?? agent.model_id
    : null;

  return (
    <div className={`rounded-xl border ${statusColor} overflow-hidden mb-3`}>
      {/* Header */}
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-white/5 transition-colors"
        onClick={() => setExpanded(e => !e)}
      >
        {agent.running ? (
          <Loader2 className="h-3.5 w-3.5 text-primary animate-spin shrink-0" />
        ) : agent.result?.success ? (
          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        ) : (
          <XCircle className="h-3.5 w-3.5 text-red-400 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-mono text-muted-foreground">#{agent.agent_id}</span>
            {agent.role && (
              <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border
                ${ROLE_COLORS[agent.role] || "bg-slate-500/10 text-slate-400 border-slate-500/20"}`}>
                {ROLE_LABELS[agent.role] || agent.role}
              </span>
            )}
            {agent.ai_id && (
              <span className="text-[9px] text-muted-foreground/85 font-mono bg-white/5 px-1 rounded">
                {agent.ai_id}
              </span>
            )}
            {shortModel && (
              <span className="text-[9px] text-primary/50 font-mono truncate max-w-[120px]" title={agent.model_id}>
                {shortModel}
              </span>
            )}
            {elapsed && (
              <span className="text-[9px] text-muted-foreground/80 ml-auto">{elapsed}</span>
            )}
          </div>
          <p className="text-xs text-foreground/90 mt-0.5 truncate">
            {agent.label || agent.task || "No task"}
          </p>
          {agent.running && agent.current_action && (
            <p className="text-[10px] text-primary/70 mt-0.5 truncate animate-pulse">
              ↳ {agent.current_action}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {agent.running && (
            <button
              onClick={e => { e.stopPropagation(); onStop(); }}
              className="h-6 w-6 flex items-center justify-center rounded-md
                bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20
                transition-all active:scale-95"
              title="Stop agent"
            >
              <Square className="h-2.5 w-2.5" />
            </button>
          )}
          {!agent.running && (
            <button
              onClick={e => { e.stopPropagation(); onClear(); }}
              className="h-6 w-6 flex items-center justify-center rounded-md
                bg-muted hover:bg-muted/80 text-muted-foreground border border-border
                transition-all active:scale-95"
              title="Remove"
            >
              <Trash2 className="h-2.5 w-2.5" />
            </button>
          )}
          {expanded ? (
            <ChevronDown className="h-3 w-3 text-muted-foreground/80" />
          ) : (
            <ChevronRight className="h-3 w-3 text-muted-foreground/80" />
          )}
        </div>
      </div>

      {/* Result banner */}
      {!agent.running && agent.result && (
        <div className={`px-3 py-1.5 text-xs border-t
          ${agent.result.success
            ? "border-emerald-500/20 text-emerald-400 bg-emerald-500/5"
            : "border-red-500/20 text-red-400 bg-red-500/5"}`}>
          {agent.result.success ? "✓ " : "✗ "}
          {agent.result.summary || agent.result.error || "Done"}
        </div>
      )}

      {/* Step list */}
      {expanded && (
        <div className="border-t border-border/50 divide-y divide-border/30 max-h-72 overflow-y-auto">
          {agent.steps.length === 0 && (
            <p className="text-[11px] text-muted-foreground/80 px-3 py-3 text-center">
              No steps yet…
            </p>
          )}
          {agent.steps.map((step, i) => {
            if (step.type === "thought") return null;
            const toolColor = TOOL_COLORS[step.tool || ""] || TOOL_COLORS.default;
            const toolIcon = TOOL_ICONS[step.tool || ""] || <Terminal className="h-3 w-3" />;
            return (
              <div key={i} className="px-3 py-2">
                {step.type === "tool" && (
                  <div>
                    <div className="flex items-center gap-1.5 mb-1">
                      <span className={`flex items-center gap-1 text-[9px] font-bold px-1.5 py-0.5 rounded border ${toolColor}`}>
                        {toolIcon} {step.tool}
                      </span>
                      {step.elapsedMs !== undefined && (
                        <span className="text-[9px] text-muted-foreground/70">{step.elapsedMs}ms</span>
                      )}
                    </div>
                    {step.result && (
                      <pre className="text-[10px] text-muted-foreground/70 whitespace-pre-wrap break-words
                        bg-black/20 rounded p-1.5 max-h-24 overflow-y-auto font-mono">
                        {step.result.slice(0, 400)}{step.result.length > 400 ? "…" : ""}
                      </pre>
                    )}
                  </div>
                )}
                {step.type === "error" && (
                  <div className="flex items-start gap-1.5">
                    <AlertCircle className="h-3 w-3 text-red-400 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-red-400">{step.content?.slice(0, 200)}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stats bar */}
      {agent.steps.length > 0 && (
        <div className="border-t border-border/30 px-3 py-1.5 flex items-center gap-3 bg-black/10">
          <span className="text-[9px] text-muted-foreground/80">
            {agent.steps.length} steps · {toolSteps.length} tools · {errorSteps.length} errors
          </span>
          {agent.files_written && agent.files_written.length > 0 && (
            <span className="text-[9px] text-emerald-400/60">
              {agent.files_written.length} files written
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Spawn form ───────────────────────────────────────────────────────────────

function SpawnForm({ onSpawned }: { onSpawned: () => void }) {
  const { data: aisData } = useListAis();
  const { selectedAi } = useIDE();
  const [task, setTask] = useState("");
  const [aiId, setAiId] = useState(selectedAi === "__auto__" ? "" : selectedAi);
  const [modelId, setModelId] = useState("__auto__");
  const [role, setRole] = useState("builder");
  const [maxSteps, setMaxSteps] = useState(20);
  const [spawning, setSpawning] = useState(false);
  const [open, setOpen] = useState(false);

  const allAis = (aisData?.ais ?? []).filter((a: any) => AGENT_CAPABLE_AI_IDS.has(a.id));
  const selectedAiInfo = allAis.find((a: any) => a.id === aiId);
  const allModels = (selectedAiInfo?.models ?? []) as Array<{ id: string; name: string; tier?: string }>;
  const bestIds = aiId ? (BEST_AGENT_MODELS[aiId] ?? []) : [];
  const filteredModels = allModels.filter(m => bestIds.includes(m.id) || m.id === "__auto__");
  const modelsToShow = filteredModels.length > 1 ? filteredModels : allModels;

  useEffect(() => {
    if (!aiId) return;
    const best = BEST_AGENT_MODELS[aiId];
    const models = (allAis.find((a: any) => a.id === aiId)?.models ?? []) as Array<{ id: string }>;
    if (best) {
      const match = models.find(m => best.includes(m.id));
      if (match) { setModelId(match.id); return; }
    }
    const auto = models.find(m => m.id === "__auto__");
    setModelId(auto ? "__auto__" : models[0]?.id ?? "__auto__");
  }, [aiId]);

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

  const handleSpawn = async () => {
    if (!task.trim() || !aiId) return;
    setSpawning(true);
    try {
      await spawnAgent({
        aiId,
        task: task.trim(),
        role,
        maxSteps,
        modelId: modelId !== "__auto__" ? modelId : undefined,
      });
      setTask("");
      setOpen(false);
      onSpawned();
      toast.success("Agent spawned successfully");
    } catch {
      toast.error("Failed to spawn agent");
    } finally {
      setSpawning(false);
    }
  };

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden mb-4">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/5 transition-colors text-left"
      >
        <div className="h-6 w-6 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center">
          <Plus className="h-3 w-3 text-primary" />
        </div>
        <span className="text-xs font-semibold text-foreground">Spawn New Agent</span>
        {open ? <ChevronDown className="h-3 w-3 ml-auto text-muted-foreground/80" />
               : <ChevronRight className="h-3 w-3 ml-auto text-muted-foreground/80" />}
      </button>

      {open && (
        <div className="border-t border-border/50 p-3 space-y-3">
          {/* Task */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
              Task
            </label>
            <textarea
              value={task}
              onChange={e => setTask(e.target.value)}
              placeholder="Describe what this agent should do…"
              rows={3}
              className="w-full bg-black/20 border border-border/60 rounded-lg px-3 py-2
                text-xs text-foreground placeholder:text-muted-foreground/70
                resize-none focus:outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {/* Provider */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
              AI Provider
            </label>
            <select
              value={aiId}
              onChange={e => setAiId(e.target.value)}
              className="w-full bg-black/20 border border-border/60 rounded-lg px-2 py-1.5
                text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors"
            >
              <option value="">Select provider…</option>
              {allAis.map((ai: any) => (
                <option key={ai.id} value={ai.id}>
                  {ai.name}{!ai.hasSession ? " (no key)" : ""}
                </option>
              ))}
            </select>
          </div>

          {/* Model */}
          {aiId && modelsToShow.length > 0 && (
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                Model
              </label>
              <select
                value={modelId}
                onChange={e => setModelId(e.target.value)}
                className="w-full bg-black/20 border border-border/60 rounded-lg px-2 py-1.5
                  text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              >
                {modelsToShow.map(m => (
                  <option key={m.id} value={m.id}>
                    {m.name}{m.tier ? ` · ${tierLabel(m.tier)}` : ""}
                  </option>
                ))}
              </select>
              {modelId && modelId !== "__auto__" && (() => {
                const m = modelsToShow.find(m => m.id === modelId);
                return m?.tier ? (
                  <p className={`text-[9px] mt-0.5 ${tierColor(m.tier)}`}>
                    {tierLabel(m.tier)} tier model selected
                  </p>
                ) : null;
              })()}
            </div>
          )}

          {/* Role + Max Steps */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                Role
              </label>
              <select
                value={role}
                onChange={e => setRole(e.target.value)}
                className="w-full bg-black/20 border border-border/60 rounded-lg px-2 py-1.5
                  text-xs text-foreground focus:outline-none focus:border-primary/50 transition-colors"
              >
                <option value="builder">Builder</option>
                <option value="scholar">Scholar</option>
                <option value="search_master">Search Master</option>
                <option value="orchestrator">Orchestrator</option>
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-1 block">
                Max Steps: {maxSteps}
              </label>
              <input
                type="range" min={5} max={50} step={5} value={maxSteps}
                onChange={e => setMaxSteps(Number(e.target.value))}
                className="w-full mt-2 accent-primary"
              />
            </div>
          </div>

          <button
            onClick={handleSpawn}
            disabled={!task.trim() || !aiId || spawning}
            className="w-full h-8 flex items-center justify-center gap-2 rounded-lg
              bg-primary text-primary-foreground text-xs font-bold
              disabled:opacity-40 disabled:cursor-not-allowed
              hover:opacity-90 active:scale-[0.98] transition-all"
          >
            {spawning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Bot className="h-3 w-3" />}
            {spawning ? "Spawning…" : "Spawn Agent"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchAgents();
      setAgents(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    pollRef.current = setInterval(refresh, 2000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refresh]);

  const handleStop = async (agentId: string) => {
    await stopAgent(agentId);
    refresh();
  };

  const handleClear = async (agentId: string) => {
    await clearAgent(agentId);
    refresh();
  };

  const handleClearDone = async () => {
    await clearDone();
    refresh();
    toast.success("Cleared completed agents");
  };

  const running = agents.filter(a => a.running);
  const done = agents.filter(a => !a.running);

  return (
    <div className="flex flex-col h-full bg-surface">
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between px-3 py-3 border-b border-border/60">
        <div className="flex items-center gap-2">
          <div className="h-7 w-7 rounded-lg bg-primary/10 border border-primary/20
            flex items-center justify-center">
            <Users className="h-4 w-4 text-primary" />
          </div>
          <div>
            <p className="text-[13px] font-bold text-foreground leading-none">Agent Swarm</p>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              {running.length} running · {done.length} done
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {done.length > 0 && (
            <button
              onClick={handleClearDone}
              className="h-7 px-2 flex items-center gap-1 rounded-lg text-[10px] font-semibold
                bg-muted hover:bg-muted/80 text-muted-foreground border border-border
                transition-all active:scale-95"
            >
              <Trash2 className="h-3 w-3" /> Clear done
            </button>
          )}
          <button
            onClick={refresh}
            className="h-7 w-7 flex items-center justify-center rounded-lg
              bg-muted hover:bg-muted/80 text-muted-foreground border border-border
              transition-all active:scale-95"
            title="Refresh"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-3">
        <SpawnForm onSpawned={refresh} />

        {loading && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 text-muted-foreground animate-spin" />
          </div>
        )}

        {!loading && agents.length === 0 && (
          <div className="text-center py-10">
            <Users className="h-8 w-8 text-muted-foreground/85 mx-auto mb-2" />
            <p className="text-xs text-muted-foreground/80">No agents running</p>
            <p className="text-[10px] text-muted-foreground/85 mt-1">
              Spawn multiple agents to run tasks in parallel
            </p>
          </div>
        )}

        {running.length > 0 && (
          <div className="mb-2">
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-2">
              Running ({running.length})
            </p>
            {running.map(a => (
              <AgentCard
                key={a.agent_id}
                agent={a}
                onStop={() => handleStop(a.agent_id)}
                onClear={() => handleClear(a.agent_id)}
              />
            ))}
          </div>
        )}

        {done.length > 0 && (
          <div>
            <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/80 mb-2">
              Completed ({done.length})
            </p>
            {done.map(a => (
              <AgentCard
                key={a.agent_id}
                agent={a}
                onStop={() => handleStop(a.agent_id)}
                onClear={() => handleClear(a.agent_id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
