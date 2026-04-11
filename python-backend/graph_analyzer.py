"""
graph_analyzer.py — Graphify integration for Vesper.
Runs the graphify pipeline: collect → extract → build → cluster → analyze → export.
Each job runs in a background thread.
"""
import json
import logging
import os
import tempfile
import threading
import time
import uuid
from pathlib import Path

logger = logging.getLogger(__name__)

# ─── State registry ──────────────────────────────────────────────────────────

_jobs: dict[str, dict] = {}
_lock = threading.Lock()


def _new_job(root: str) -> str:
    job_id = uuid.uuid4().hex[:8]
    with _lock:
        _jobs[job_id] = {
            "id": job_id,
            "root": root,
            "running": True,
            "phase": "queued",
            "progress": 0,
            "total": 0,
            "graph": None,
            "analysis": None,
            "error": None,
            "created_at": time.time(),
            "finished_at": None,
        }
    return job_id


def get_job(job_id: str) -> dict | None:
    with _lock:
        return dict(_jobs[job_id]) if job_id in _jobs else None


def list_jobs() -> list[dict]:
    with _lock:
        return [dict(j) for j in _jobs.values()]


def clear_job(job_id: str) -> bool:
    with _lock:
        if job_id in _jobs:
            del _jobs[job_id]
            return True
    return False


def clear_done_jobs() -> int:
    with _lock:
        done = [jid for jid, j in _jobs.items() if not j["running"]]
        for jid in done:
            del _jobs[jid]
    return len(done)


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _set(job_id: str, **kwargs):
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(kwargs)


def _run_pipeline(job_id: str, root: str, extensions_filter: list[str] | None):
    try:
        from graphify.extract import collect_files, extract as gfy_extract
        from graphify.build import build as gfy_build
        from graphify.cluster import cluster as gfy_cluster
        from graphify.analyze import god_nodes, surprising_connections, suggest_questions
        from graphify.export import to_json
        import networkx as nx

        root_path = Path(root).resolve()
        if not root_path.exists():
            _set(job_id, running=False, error=f"Path not found: {root}", finished_at=time.time())
            return

        # ── Phase 1: collect files ─────────────────────────────────────────
        _set(job_id, phase="collecting files")
        all_files: list[Path] = collect_files(root_path)

        # Optional extension filter
        if extensions_filter:
            exts = {e.lstrip(".").lower() for e in extensions_filter}
            all_files = [f for f in all_files if f.suffix.lstrip(".").lower() in exts]

        total = len(all_files)
        _set(job_id, total=total)
        logger.info("[graph:%s] Collected %d files from %s", job_id, total, root_path)

        if total == 0:
            _set(job_id, running=False, error="No supported files found in this directory.", finished_at=time.time())
            return

        # ── Phase 2: extract nodes/edges (batch call) ──────────────────────
        _set(job_id, phase="extracting", progress=0)
        extractions_raw = gfy_extract(all_files)
        # gfy_extract returns a single merged dict {nodes: [...], edges: [...]}
        extractions = [extractions_raw] if isinstance(extractions_raw, dict) else extractions_raw
        _set(job_id, progress=total)
        logger.info("[graph:%s] Extraction complete", job_id)

        if not extractions or all(not e.get("nodes") for e in extractions):
            _set(job_id, running=False, error="No symbols extracted from these files.", finished_at=time.time())
            return

        # ── Phase 3: build NetworkX graph ──────────────────────────────────
        _set(job_id, phase="building graph")
        G: nx.Graph = gfy_build(extractions)
        logger.info("[graph:%s] Graph: %d nodes, %d edges", job_id, G.number_of_nodes(), G.number_of_edges())

        # ── Phase 4: community clustering ──────────────────────────────────
        _set(job_id, phase="clustering")
        communities: dict[int, list[str]] = gfy_cluster(G)

        # Attach community id to each node for frontend colouring
        for comm_id, members in communities.items():
            for node_id in members:
                if G.has_node(node_id):
                    G.nodes[node_id]["community"] = comm_id

        # ── Phase 5: analyze ───────────────────────────────────────────────
        _set(job_id, phase="analyzing")
        hub_nodes = god_nodes(G, top_n=10)
        surprises = surprising_connections(G, communities=communities, top_n=10)
        # Build simple community labels
        community_labels = {cid: f"Cluster {cid}" for cid in communities}
        questions_raw = suggest_questions(G, communities, community_labels, top_n=8)
        # suggest_questions may return list[dict] with a "question" key, or list[str]
        questions: list[str] = []
        for q in questions_raw:
            if isinstance(q, dict):
                questions.append(q.get("question", str(q)))
            else:
                questions.append(str(q))

        # ── Phase 6: serialize to JSON for frontend ────────────────────────
        _set(job_id, phase="exporting")
        # to_json writes to file; use a temp file and read it back
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tf:
            tmp_path = tf.name
        try:
            to_json(G, communities, tmp_path)
            with open(tmp_path) as f:
                graph_json = json.load(f)
        finally:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

        analysis = {
            "nodeCount": G.number_of_nodes(),
            "edgeCount": G.number_of_edges(),
            "godNodes": hub_nodes,
            "surprisingConnections": surprises,
            "suggestedQuestions": questions,
            "communities": [
                {"id": cid, "size": len(members)}
                for cid, members in sorted(communities.items(), key=lambda x: -len(x[1]))
            ][:20],
        }

        _set(
            job_id,
            running=False,
            phase="done",
            graph=graph_json,
            analysis=analysis,
            finished_at=time.time(),
        )
        logger.info("[graph:%s] Done — %d nodes, %d communities", job_id, G.number_of_nodes(), len(communities))

    except Exception as exc:
        logger.exception("[graph:%s] pipeline error: %s", job_id, exc)
        _set(job_id, running=False, phase="error", error=str(exc), finished_at=time.time())


# ─── Public API ───────────────────────────────────────────────────────────────

def spawn(root: str, extensions_filter: list[str] | None = None) -> str:
    """Start a graphify analysis job in the background. Returns job_id."""
    job_id = _new_job(root)
    t = threading.Thread(
        target=_run_pipeline,
        args=(job_id, root, extensions_filter),
        daemon=True,
    )
    t.start()
    return job_id
