import { useState, useEffect, useRef, useCallback } from "react";
import { useIDE } from "@/contexts/ide-context";
import {
  GitBranch, Play, Trash2, RefreshCw, AlertCircle, Loader2,
  CheckCircle2, Network, Search, ZoomIn, ZoomOut, Maximize2,
  FileCode, Layers, Lightbulb, ChevronDown, ChevronRight, X,
} from "lucide-react";
import { toast } from "sonner";
import * as d3 from "d3";

const BASE_URL = ((import.meta.env.BASE_URL as string) ?? "/").replace(/\/$/, "") + "/";

// ─── Types ────────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  label?: string;
  type?: string;
  source_file?: string;
  community?: number;
  degree?: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  relation?: string;
  confidence?: string;
}

interface GraphData {
  nodes: GraphNode[];
  links: GraphLink[];
}

interface Analysis {
  nodeCount: number;
  edgeCount: number;
  godNodes: Array<{ id: string; degree: number }>;
  surprisingConnections: Array<{ source: string; target: string; relation?: string }>;
  suggestedQuestions: string[];
  communities: Array<{ id: number; size: number }>;
}

interface Job {
  id: string;
  root: string;
  running: boolean;
  phase: string;
  progress: number;
  total: number;
  graph: GraphData | null;
  analysis: Analysis | null;
  error: string | null;
  created_at: number;
  finished_at: number | null;
}

// ─── Community colours ────────────────────────────────────────────────────────

const COMMUNITY_COLORS = [
  "#7c6af7", "#4eade0", "#34c6a0", "#f0c35e", "#e86b5f",
  "#b06af7", "#4ecbd4", "#76c85e", "#f0935e", "#d46ab0",
  "#6a9af0", "#c8c85e", "#5ec880", "#f06aaa", "#6ac8c8",
];

function communityColor(id: number) {
  return COMMUNITY_COLORS[id % COMMUNITY_COLORS.length];
}

// ─── D3 Force Graph ───────────────────────────────────────────────────────────

function ForceGraph({
  data,
  onNodeClick,
  searchTerm,
}: {
  data: GraphData;
  onNodeClick: (node: GraphNode) => void;
  searchTerm: string;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);

  useEffect(() => {
    if (!svgRef.current || !data.nodes.length) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();

    const rect = svgRef.current.getBoundingClientRect();
    const W = rect.width || 600;
    const H = rect.height || 500;

    // Zoom layer
    const g = svg.append("g");
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on("zoom", (e) => g.attr("transform", e.transform));
    svg.call(zoom);

    const nodes: GraphNode[] = data.nodes.map(n => ({ ...n }));
    const nodeById = new Map(nodes.map(n => [n.id, n]));

    const links: GraphLink[] = data.links
      .map(l => ({
        ...l,
        source: (typeof l.source === "string" ? nodeById.get(l.source) : l.source) ?? l.source,
        target: (typeof l.target === "string" ? nodeById.get(l.target) : l.target) ?? l.target,
      }))
      .filter(l => l.source && l.target) as GraphLink[];

    // Compute degree for node sizing
    nodes.forEach(n => { n.degree = 0; });
    links.forEach(l => {
      const s = typeof l.source === "string" ? nodeById.get(l.source) : l.source as GraphNode;
      const t = typeof l.target === "string" ? nodeById.get(l.target) : l.target as GraphNode;
      if (s) s.degree = (s.degree ?? 0) + 1;
      if (t) t.degree = (t.degree ?? 0) + 1;
    });

    const maxDeg = Math.max(...nodes.map(n => n.degree ?? 0), 1);
    const nodeR = (n: GraphNode) => 4 + ((n.degree ?? 0) / maxDeg) * 12;

    // Simulation
    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force("link", d3.forceLink<GraphNode, GraphLink>(links).id(n => n.id).distance(60))
      .force("charge", d3.forceManyBody().strength(-120))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force("collide", d3.forceCollide<GraphNode>().radius(n => nodeR(n) + 4));
    simRef.current = sim;

    // Links
    const link = g.append("g").attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", l => l.confidence === "EXTRACTED" ? "#2a2a40" : "#1e1e30")
      .attr("stroke-opacity", 0.6)
      .attr("stroke-width", l => l.confidence === "EXTRACTED" ? 1.5 : 0.8)
      .attr("stroke-dasharray", l => l.confidence === "INFERRED" ? "4,3" : null);

    // Nodes group
    const node = g.append("g").attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .style("cursor", "pointer")
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x; d.fy = d.y;
          })
          .on("drag", (event, d) => { d.fx = event.x; d.fy = event.y; })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null; d.fy = null;
          })
      )
      .on("click", (_, d) => onNodeClick(d));

    node.append("circle")
      .attr("r", nodeR)
      .attr("fill", d => communityColor(d.community ?? 0))
      .attr("fill-opacity", 0.85)
      .attr("stroke", "#0a0a12")
      .attr("stroke-width", 1.5);

    node.append("text")
      .text(d => (d.label ?? d.id).slice(0, 18))
      .attr("dx", d => nodeR(d) + 3)
      .attr("dy", "0.35em")
      .attr("font-size", "9px")
      .attr("fill", "#9090b8")
      .style("pointer-events", "none");

    // Highlight search matches
    if (searchTerm) {
      const lower = searchTerm.toLowerCase();
      node.select("circle")
        .attr("stroke", d =>
          (d.label ?? d.id).toLowerCase().includes(lower) ? "#f0c35e" : "#0a0a12"
        )
        .attr("stroke-width", d =>
          (d.label ?? d.id).toLowerCase().includes(lower) ? 3 : 1.5
        );
    }

    sim.on("tick", () => {
      link
        .attr("x1", l => (l.source as GraphNode).x ?? 0)
        .attr("y1", l => (l.source as GraphNode).y ?? 0)
        .attr("x2", l => (l.target as GraphNode).x ?? 0)
        .attr("y2", l => (l.target as GraphNode).y ?? 0);

      node.attr("transform", d => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => { sim.stop(); };
  }, [data, searchTerm, onNodeClick]);

  return (
    <svg
      ref={svgRef}
      className="w-full h-full"
      style={{ background: "transparent" }}
    />
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function GraphPage() {
  const { openFileInEditor } = useIDE();

  const [jobs, setJobs] = useState<Job[]>([]);
  const [activeJob, setActiveJob] = useState<Job | null>(null);
  const [root, setRoot] = useState("/home/runner/workspace");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [showQuestions, setShowQuestions] = useState(false);
  const [polling, setPolling] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Load existing jobs on mount ───────────────────────────────────────────
  useEffect(() => {
    fetchJobs();
  }, []);

  async function fetchJobs() {
    try {
      const res = await fetch(`${BASE_URL}api/graph/jobs`);
      const d = await res.json();
      setJobs(d.jobs ?? []);
      // Auto-select the latest done job
      const done = (d.jobs ?? []).filter((j: Job) => !j.running && j.graph);
      if (done.length && !activeJob) setActiveJob(done[done.length - 1]);
    } catch { /* ignore */ }
  }

  // ── Poll running job ──────────────────────────────────────────────────────
  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (!polling) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(`${BASE_URL}api/graph/jobs/${polling}`);
        const job: Job = await res.json();
        setJobs(prev => prev.map(j => j.id === job.id ? job : j));
        if (activeJob?.id === job.id) setActiveJob(job);
        if (!job.running) {
          setPolling(null);
          if (job.error) {
            toast.error("Graph analysis failed", { description: job.error });
          } else {
            toast.success("Graph ready", { description: `${job.analysis?.nodeCount} nodes, ${job.analysis?.edgeCount} edges` });
            setActiveJob(job);
          }
        }
      } catch { /* ignore */ }
    }, 1000);

    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [polling, activeJob?.id]);

  async function startAnalysis() {
    try {
      const res = await fetch(`${BASE_URL}api/graph/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ root }),
      });
      const d = await res.json();
      const job: Job = d.job;
      setJobs(prev => [job, ...prev]);
      setActiveJob(job);
      setPolling(job.id);
      toast.success("Analysis started", { description: `Scanning ${root}` });
    } catch (e: any) {
      toast.error("Failed to start", { description: e.message });
    }
  }

  async function deleteJob(jobId: string) {
    await fetch(`${BASE_URL}api/graph/jobs/${jobId}`, { method: "DELETE" });
    setJobs(prev => prev.filter(j => j.id !== jobId));
    if (activeJob?.id === jobId) setActiveJob(null);
  }

  const handleNodeClick = useCallback((node: GraphNode) => {
    setSelectedNode(node);
    if (node.source_file) {
      openFileInEditor(node.source_file);
    }
  }, [openFileInEditor]);

  const runningJob = activeJob?.running ? activeJob : null;
  const graphData = activeJob?.graph ?? null;
  const analysis = activeJob?.analysis ?? null;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#07070e] text-foreground text-sm">

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center justify-between px-3 py-2 border-b border-[#131318] bg-[#080810]">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          <span className="font-semibold text-xs tracking-wide uppercase text-[#8080a8]">
            Code Graph
          </span>
          {analysis && (
            <span className="text-[10px] text-[#8888b0] ml-1">
              {analysis.nodeCount} nodes · {analysis.edgeCount} edges · {analysis.communities.length} clusters
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={fetchJobs}
            className="p-1 text-[#8888b0] hover:text-foreground rounded transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* ── Analyze bar ────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[#0e0e1a] bg-[#070710]">
        <input
          value={root}
          onChange={e => setRoot(e.target.value)}
          placeholder="/home/runner/workspace"
          className="flex-1 bg-[#0c0c18] border border-[#1a1a2e] rounded px-2 py-1 text-xs text-foreground placeholder-[#3a3a5a] focus:outline-none focus:border-primary/50 font-mono"
        />
        <button
          onClick={startAnalysis}
          disabled={!!runningJob}
          className="flex items-center gap-1.5 px-2.5 py-1 bg-primary/90 hover:bg-primary rounded text-xs font-medium text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {runningJob ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
          Analyze
        </button>
      </div>

      {/* ── Job list (if multiple) ──────────────────────────────────────── */}
      {jobs.length > 1 && (
        <div className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 border-b border-[#0e0e1a] overflow-x-auto">
          {jobs.map(j => (
            <button
              key={j.id}
              onClick={() => setActiveJob(j)}
              className={`shrink-0 flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border transition-colors
                ${activeJob?.id === j.id
                  ? "border-primary/60 bg-primary/10 text-primary"
                  : "border-[#1a1a2e] text-[#8888aa] hover:text-foreground"}`}
            >
              {j.running
                ? <Loader2 className="h-2.5 w-2.5 animate-spin" />
                : j.error
                  ? <AlertCircle className="h-2.5 w-2.5 text-red-400" />
                  : <CheckCircle2 className="h-2.5 w-2.5 text-green-400" />}
              <span className="font-mono">{j.id}</span>
              <button
                onClick={e => { e.stopPropagation(); deleteJob(j.id); }}
                className="ml-0.5 text-[#7878a8] hover:text-red-400"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </button>
          ))}
        </div>
      )}

      {/* ── Progress bar ───────────────────────────────────────────────── */}
      {runningJob && (
        <div className="shrink-0 px-3 py-2 border-b border-[#0e0e1a] bg-[#08081a]">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-[#9090c0] capitalize">{runningJob.phase}</span>
            <span className="text-[10px] text-[#8888b0]">
              {runningJob.total > 0 ? `${runningJob.progress}/${runningJob.total}` : ""}
            </span>
          </div>
          <div className="h-1 bg-[#0e0e1a] rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: runningJob.total > 0 ? `${(runningJob.progress / runningJob.total) * 100}%` : "100%" }}
            />
          </div>
          {runningJob.total === 0 && (
            <div className="w-full h-1 mt-[-4px] rounded-full overflow-hidden">
              <div className="h-full w-1/3 bg-primary/60 rounded-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-primary to-transparent" />
            </div>
          )}
        </div>
      )}

      {/* ── Error state ────────────────────────────────────────────────── */}
      {activeJob?.error && !activeJob.running && (
        <div className="shrink-0 mx-3 mt-2 flex items-start gap-2 p-2 bg-red-500/10 border border-red-500/20 rounded text-xs text-red-400">
          <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          {activeJob.error}
        </div>
      )}

      {/* ── Main content: graph + sidebar ──────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">

        {/* Graph canvas */}
        <div className="flex-1 relative overflow-hidden">
          {!graphData && !runningJob && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#7878a8]">
              <Network className="h-12 w-12 opacity-20" />
              <p className="text-sm">Enter a directory and click Analyze</p>
              <p className="text-xs opacity-60">Supports 20 languages via tree-sitter AST</p>
            </div>
          )}
          {runningJob && !graphData && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#8888b0]">
              <Loader2 className="h-10 w-10 animate-spin text-primary/40" />
              <p className="text-xs">Building knowledge graph…</p>
            </div>
          )}
          {graphData && (
            <>
              {/* Search overlay */}
              <div className="absolute top-2 right-2 z-10 flex items-center gap-1.5">
                <div className="flex items-center gap-1 bg-[#0c0c18]/90 border border-[#1a1a2e] rounded px-2 py-1">
                  <Search className="h-3 w-3 text-[#8888b0]" />
                  <input
                    value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    placeholder="Search nodes…"
                    className="w-28 bg-transparent text-xs text-foreground placeholder-[#3a3a5a] focus:outline-none"
                  />
                </div>
              </div>

              <ForceGraph
                data={graphData}
                onNodeClick={handleNodeClick}
                searchTerm={searchTerm}
              />
            </>
          )}
        </div>

        {/* ── Right analysis sidebar ───────────────────────────────────── */}
        {analysis && (
          <div className="w-56 shrink-0 border-l border-[#0e0e1a] bg-[#07070e] overflow-y-auto">

            {/* Selected node info */}
            {selectedNode && (
              <div className="px-3 py-2 border-b border-[#0e0e1a]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[10px] font-semibold text-[#8080a8] uppercase tracking-wide">Selected</span>
                  <button onClick={() => setSelectedNode(null)} className="text-[#7878a8] hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
                <div
                  className="h-2 w-2 rounded-full inline-block mr-1"
                  style={{ background: communityColor(selectedNode.community ?? 0) }}
                />
                <span className="text-xs font-mono text-foreground">
                  {selectedNode.label ?? selectedNode.id}
                </span>
                {selectedNode.type && (
                  <div className="mt-0.5 text-[10px] text-[#8888aa]">{selectedNode.type}</div>
                )}
                {selectedNode.source_file && (
                  <button
                    onClick={() => openFileInEditor(selectedNode.source_file!)}
                    className="mt-1 flex items-center gap-1 text-[10px] text-primary/80 hover:text-primary"
                  >
                    <FileCode className="h-2.5 w-2.5" />
                    <span className="truncate max-w-[140px] font-mono">{selectedNode.source_file.split("/").slice(-2).join("/")}</span>
                  </button>
                )}
              </div>
            )}

            {/* Stats */}
            <div className="px-3 py-2 border-b border-[#0e0e1a]">
              <div className="grid grid-cols-2 gap-1.5">
                {[
                  { label: "Nodes", value: analysis.nodeCount },
                  { label: "Edges", value: analysis.edgeCount },
                  { label: "Clusters", value: analysis.communities.length },
                  { label: "Hub nodes", value: analysis.godNodes.length },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-[#0c0c18] rounded p-1.5 text-center">
                    <div className="text-xs font-bold text-foreground">{value}</div>
                    <div className="text-[9px] text-[#8888b0]">{label}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Communities */}
            <div className="px-3 py-2 border-b border-[#0e0e1a]">
              <button
                onClick={() => setShowAnalysis(v => !v)}
                className="flex items-center justify-between w-full text-[10px] font-semibold text-[#9090c0] uppercase tracking-wide mb-1"
              >
                <span className="flex items-center gap-1"><Layers className="h-3 w-3" /> Clusters</span>
                {showAnalysis ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              </button>
              {showAnalysis && (
                <div className="space-y-1">
                  {analysis.communities.slice(0, 8).map(c => (
                    <div key={c.id} className="flex items-center gap-1.5">
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ background: communityColor(c.id) }}
                      />
                      <span className="text-[10px] text-[#9090c0] flex-1">Cluster {c.id}</span>
                      <span className="text-[10px] text-[#8888b0]">{c.size}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* God nodes (hubs) */}
            {analysis.godNodes.length > 0 && (
              <div className="px-3 py-2 border-b border-[#0e0e1a]">
                <div className="text-[10px] font-semibold text-[#9090c0] uppercase tracking-wide mb-1 flex items-center gap-1">
                  <GitBranch className="h-3 w-3" /> Hub Nodes
                </div>
                <div className="space-y-0.5">
                  {analysis.godNodes.slice(0, 6).map(n => (
                    <div key={n.id} className="text-[10px] text-[#7070a0] font-mono truncate">
                      {n.id.slice(0, 24)}
                      <span className="text-[#7878a8] ml-1">×{n.degree}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Suggested questions */}
            {analysis.suggestedQuestions.length > 0 && (
              <div className="px-3 py-2">
                <button
                  onClick={() => setShowQuestions(v => !v)}
                  className="flex items-center justify-between w-full text-[10px] font-semibold text-[#9090c0] uppercase tracking-wide mb-1"
                >
                  <span className="flex items-center gap-1"><Lightbulb className="h-3 w-3" /> Questions</span>
                  {showQuestions ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
                {showQuestions && (
                  <div className="space-y-1.5">
                    {analysis.suggestedQuestions.map((q, i) => (
                      <div key={i} className="text-[10px] text-[#8888b0] leading-tight">
                        · {q}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        )}
      </div>

    </div>
  );
}
