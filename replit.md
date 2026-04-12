# Vesper — AI-Native IDE & Proxy Platform

## Overview
Vesper is a full-stack, AI-native IDE and unified AI proxy platform. It lets users interact with multiple AI providers (ChatGPT, Claude, Grok, Gemini, etc.) through a single VS Code-like browser interface, with an autonomous coding agent that can read/write files and execute terminal commands.

## Architecture
This is a **pnpm monorepo** with three running services:

| Service | Directory | Port | Description |
|---|---|---|---|
| Python AI Backend | `python-backend/` | 5050 | Flask server: AI provider integrations, Playwright browser sessions, file management, terminal execution |
| API Gateway | `artifacts/api-server/` | 8080 | Express server: bridges the frontend to the Python backend, handles file ops and AI proxying |
| Frontend | `artifacts/ai-proxy/` | 19906 | React/Vite app: IDE interface with editor (Monaco/CodeMirror), chat, terminal, file explorer |

### Additional Directories
- `lib/api-spec/` — OpenAPI YAML spec (source of truth for the API contract)
- `lib/api-zod/` — Auto-generated TypeScript types and Zod schemas
- `lib/api-client-react/` — Auto-generated React Query hooks
- `artifacts/mockup-sandbox/` — Isolated React component preview environment
- `attached_assets/` — System prompts for AI agents (Research Scholar, Search Master, Vesper Orchestrator, etc.)

## Workflows
The project uses three parallel workflows (started via the "Project" run button):
1. **Python AI Backend** — `cd python-backend && PYTHON_BACKEND_PORT=5050 python3 main.py`
2. **artifacts/api-server: API Server** — `PORT=8080 pnpm --filter @workspace/api-server run dev`
3. **artifacts/ai-proxy: web** — `PORT=19906 BASE_PATH=/ pnpm --filter @workspace/ai-proxy run dev`

## Key Files
- `python-backend/main.py` — Flask entry point with all API routes
- `python-backend/agent.py` — Autonomous coding agent (think → tool call → observe loop)
- `python-backend/config.py` — AI provider configurations (12+ providers)
- `python-backend/playwright_utils.py` — Browser-based AI session management
- `python-backend/terminal_manager.py` — Shell command execution
- `python-backend/workspace_manager.py` — Per-project workspace management + isolated dependency installation (uv/venv for Python, npm for JS)
- `artifacts/api-server/src/index.ts` — API gateway bootstrapper
- `artifacts/api-server/src/routes/proxy.ts` — All proxy routes (AI, sessions, files, terminal, workspaces, etc.)
- `artifacts/ai-proxy/src/App.tsx` — Frontend entry point (provider tree: AgentProvider → WorkspaceProvider → IDEProvider)
- `artifacts/ai-proxy/src/contexts/ide-context.tsx` — Global IDE state (panels, mobile nav, file opening)
- `artifacts/ai-proxy/src/contexts/agent-context.tsx` — Shared agent type state (persisted via localStorage); exposes `useAgentMode()`
- `artifacts/ai-proxy/src/contexts/workspace-context.tsx` — Per-project workspace state (list, current, deps, install); persisted to localStorage
- `artifacts/ai-proxy/src/components/chat/agent-selector.tsx` — Dropdown in chat panel header for switching agent personas
- `artifacts/ai-proxy/src/components/chat/markdown-renderer.tsx` — Renders AI responses; CodeBlock has Copy + Run + **Save-to-workspace** buttons
- `artifacts/ai-proxy/src/lib/intent-detect.ts` — `detectInstallIntent` (package name extractor) + `detectIntent` (agent routing) + `AGENT_PREFIXES`
- `artifacts/ai-proxy/src/components/ide/file-explorer.tsx` — File tree scoped to active workspace; workspace switcher + Install Dependency panel
- Editor preferences (wordWrap, fontSize) + open tabs + active tab all persisted to localStorage (workspace-scoped)
- Command Palette (`Ctrl+P`): fuzzy file search, ↑↓ keyboard nav, highlights matches — registered in IDEContext, rendered above all overlays
- Custom Vesper Monaco theme (zinc/violet palette): violet keywords, emerald strings, amber numbers, cyan types
- Tab bar active-tab auto-scroll: `scrollIntoView` fires whenever `activeTab` changes; scrollbar hidden for clean look
- `artifacts/ai-proxy/src/components/ide/command-palette.tsx` — unified Ctrl+P/Ctrl+K palette; file mode (default) + command mode (`>` prefix); agent-switch, export, panel-toggle, and help commands
- `artifacts/ai-proxy/src/components/ide/shortcuts-modal.tsx` — keyboard shortcut reference modal; triggered by `?` key, activity bar button, or palette command; `useShortcutsKey()` hook wires the key globally
- `artifacts/ai-proxy/src/components/ide/error-boundary.tsx` — `PanelErrorBoundary` class component wrapping editor, chat, terminal panels (desktop + mobile)
- `artifacts/ai-proxy/src/contexts/ide-context.tsx` — adds `paletteInitialQuery`, `openCommandMode`, `showShortcutsModal`, `openShortcutsModal`, `closeShortcutsModal`
- `artifacts/ai-proxy/src/components/layout/activity-bar.tsx` — Keyboard icon button (amber hover) opens shortcuts modal
- `artifacts/ai-proxy/src/components/ide/file-explorer.tsx` — Workspace Explorer with per-workspace isolation, WorkspaceSwitcher dropdown, NoWorkspacePanel onboarding, InstallDepPanel (uv/npm), collapse-all (collapseAllKey counter), workspace-aware header label ("WORKSPACE" when active), language badge (py/js), refresh syncs workspace metadata; all file ops (create/rename/delete/import/export/search) scoped to active workspace
- `python-backend/workspace_manager.py` — `list_workspaces()` detects language live from disk (not just stored metadata); lazy-writes detected lang back to `.vesper/workspace.json`
- `artifacts/ai-proxy/src/lib/export-chat.ts` — PDF (print-window), Word via backend (`exportChatAsDocxBackend` with client-side fallback), save to workspace as `.md` (`saveChatToWorkspace`)
- `artifacts/ai-proxy/src/components/chat/export-menu.tsx` — 3-option export dropdown: PDF, Word (.docx), Save to Workspace; desktop header + mobile compact icon
- `python-backend/main.py` — `/api/export/docx` endpoint uses `python-docx`; returns real .docx binary with coloured headers, code blocks, inline formatting
- `artifacts/api-server/src/routes/proxy.ts` — `/export/docx` route added; binary streaming extended to include Word MIME type + Content-Disposition forwarding
- Chat messages carry `timestamp: Date` for accurate export timestamps
- `artifacts/ai-proxy/src/components/layout/ide-layout.tsx` — Root IDE shell: desktop 3-panel + mobile single-panel with lazy tab mounting + bottom nav with chat unread badge

## Per-Project Workspace System
Each workspace is an isolated subdirectory at `workspaces/{slug}/` under `WORKSPACE_ROOT`.

**Storage layout:**
```
workspaces/
  my-app/
    .vesper/workspace.json   ← metadata (name, language, created)
    .venv/                   ← Python venv (created on first install)
    src/                     ← user files
    package.json             ← JS manifest (created on first npm install)
    node_modules/            ← JS deps
```

**API endpoints (all proxied via api-server → Python backend):**
- `GET /api/workspaces` — list all workspaces
- `POST /api/workspaces/create` — `{ name }` → creates workspace dir + metadata
- `GET /api/workspaces/{id}/deps` — list installed packages (pip list / package.json)
- `POST /api/workspaces/{id}/install` — `{ package, version? }` → uv/pip (Python) or npm (JS)

**File tree scoping:** Pass `path: "workspaces/{slug}"` to the existing `/api/files/tree` endpoint. The tree root will be the workspace directory.

## Dependencies
- Python: flask, flask-cors, flask-sqlalchemy, playwright, openai, anthropic, gunicorn
- Node: express, vite, react, react-query, codemirror, monaco-editor, xterm, tailwindcss
- System: playwright-driver (chromium), postgresql, openssl

## Graphify Code Graph (integrated)
Interactive knowledge-graph view of any directory in the workspace.

**How it works:**
- Uses the `graphifyy` PyPI package (`pip install graphifyy`) which wraps tree-sitter AST for 20 languages
- Pipeline: `collect_files(root)` → `extract(paths)` → `build(extractions)` → `cluster(G)` → `analyze(G)` → `to_json(G, communities, path)`
- Runs in a background thread per job; frontend polls for live phase/progress updates

**Flask API** (`python-backend/main.py` + `graph_analyzer.py`):
- `GET  /api/graph/jobs`          — list all jobs
- `POST /api/graph/analyze`       — start new job `{root?, extensions?}`
- `GET  /api/graph/jobs/:id`      — poll job status + graph data + analysis
- `DELETE /api/graph/jobs/:id`    — remove a job
- `POST /api/graph/clear-done`    — remove all completed jobs

**Frontend:** New "Code Graph" panel (⬡ Network icon) in the activity bar:
- `artifacts/ai-proxy/src/pages/graph.tsx` — D3 force-directed graph visualization
- Directory input + Analyze button → live progress bar with phase label
- Interactive SVG: drag nodes, zoom/pan, click node to open source file in editor
- Right sidebar: cluster colour legend, hub nodes, suggested questions, connection stats
- Search box highlights matching nodes in gold

## Open Multi-Agent Swarm (integrated)
Run multiple AI agents in parallel, each with their own AI provider, role, and task:

**Architecture:**
- `python-backend/agent.py` — refactored to support per-agent state via threading.local + `_multi_states` dict. `run_agent()` now accepts `agent_id=""` and uses isolated state/stop closures when set.
- `python-backend/multi_agent.py` — manager module: `spawn()`, `get()`, `list_all()`, `stop()`, `clear()`, `clear_all_done()`
- Each agent runs in its own daemon thread with its own stop flag

**Flask API** (`python-backend/main.py`):
- `GET  /api/agents` — list all agents
- `POST /api/agents/spawn` — spawn new agent `{aiId, task, role, maxSteps?, label?}`
- `GET  /api/agents/:id` — get agent status (poll for live updates)
- `POST /api/agents/:id/stop` — stop gracefully
- `DELETE /api/agents/:id` — remove from registry
- `POST /api/agents/clear-done` — remove all finished agents

**Agent roles available:** `builder`, `scholar`, `search_master`, `orchestrator`

**Frontend:** New "Swarm" panel (👥 icon) in the activity bar sidebar:
- `artifacts/ai-proxy/src/pages/agents.tsx` — live swarm view with 2s polling
- Shows running agents with live action + step log, and completed agents with summary
- Spawn form: pick AI provider, role, max steps, and write a task
- Stop/remove individual agents; "Clear done" button for batch cleanup

## Web Scraping (Scrapling — integrated)
Powered by [Scrapling](https://github.com/D4Vinci/Scrapling) — adaptive scraping with 3 tiers:
- **Tier 1 — Fast:** `Fetcher` (curl_cffi, browser fingerprinting, no Playwright, <1s)
- **Tier 2 — Dynamic:** `DynamicFetcher` (Playwright headless, JS-heavy pages)
- **Tier 3 — Fallback:** raw Playwright with Vesper's existing Chromium install

Agent tools added (`python-backend/agent.py`):
- `web_search` — DuckDuckGo search, returns title + URL + snippet for top N results
- `web_scrape` — scrape any URL, with optional CSS selector and `dynamic` flag

Flask endpoints (`python-backend/main.py`):
- `POST /api/scraper/scrape` — `{url, selector?, dynamic?}`
- `GET|POST /api/scraper/search` — `?q=query&n=8` or `{query, num_results}`

Both proxied through API server at port 8080.

## RTK Token Reduction (integrated)
Inspired by github.com/rtk-ai/rtk. Every terminal command output is compressed before reaching the LLM:
- `python-backend/token_reducer.py` — implements the 4 RTK strategies (filtering, grouping, truncation, deduplication)
- Hooked into `terminal_manager.py` `exec_command()` — applies to ALL terminal usage (IDE terminal + agent)
- `/api/terminal/savings` endpoint tracks cumulative token savings per session
- Terminal panel header shows a live `⚡ -X% tokens` badge once savings exceed 10%
- Typical savings: `git status` ~65%, `pip install` ~80%, test runners ~90%

## Python Virtual Environment Management (Safe Execution)

Every Python workspace gets an isolated `.venv` managed automatically by Vesper.

**Backend API** (`python-backend/workspace_manager.py` + `main.py`):
- `GET  /api/workspaces/:id/venv`         — detailed venv health (exists, healthy, python_version, package_count, tool, path, error)
- `POST /api/workspaces/:id/venv/ensure`  — create venv if missing, heal if broken (uv preferred, pip fallback)
- `POST /api/workspaces/:id/venv/repair`  — delete and fully recreate the venv

**Agent safe execution** (`python-backend/agent.py`):
- `install_packages` tool now auto-creates `.venv` before every pip install (uv venv → venv pip as fallbacks)
- `execute` tool prepends `.venv/bin` to PATH so `python`, `pip`, and all installed modules resolve to the venv
- `_get_venv_extra_env(cwd)` — helper that builds `VIRTUAL_ENV + PATH` overrides for any command
- `_ensure_workspace_venv(cwd)` — helper that creates venv if python binary missing
- `exec_command` now accepts optional `extra_env` parameter for venv activation

**Terminal Manager** (`python-backend/terminal_manager.py`):
- `exec_command` signature extended with `extra_env: dict | None` — merged into os.environ before subprocess

**Frontend** (`workspace-context.tsx`, `file-explorer.tsx`):
- `VenvStatus` interface tracks: exists, healthy, python_version, package_count, tool, path, error
- `venvStatus`, `venvState`, `refreshVenv()`, `ensureVenv()`, `repairVenv()` exposed via WorkspaceContext
- `InstallDepPanel` shows:
  - `VenvBadge` — live status (no venv / broken / venv active) with colour coding
  - Python version, package count, tool (uv/pip), path
  - "Create venv" button (amber, when missing)
  - "Repair venv" button (red when broken, grey when healthy)
  - Refresh button for venv section + packages section
  - Venv operation busy states with live progress messages

## UI & UX Components
- **Toast notifications:** Fully migrated from Radix `useToast` to [Sonner](https://sonner.emilkowal.ski/) across all pages and components. `components/ui/sonner.tsx` provides a custom Vesper dark theme (`!bg-[#0f0f16]`, `rounded-xl`, `duration: 3500`, `position: bottom-right`). All call sites use `toast.success()`, `toast.error()`, or `toast()` from `"sonner"`.
- **ThinkingDots:** Animated AI-thinking indicator with avatar badge, staggered bouncing dots, "Thinking…" label, and skeleton preview lines — shown in chat panel while AI is streaming.
- **Editor skeleton:** When a file is loading, a rich 10-line code-skeleton placeholder fills the Monaco area instead of a bare spinner.
- **Activity bar:** Keyboard shortcut button (`Keyboard` icon) in the footer toggles the command palette.
- **File explorer:** Collapse-all button, workspace-aware header, language badge (py/js), refresh syncs workspace metadata. `list_workspaces()` runs live `_detect_language()` per request.

## AI Provider Authentication
- **Cookie-based** (ChatGPT, Grok, etc.): Import browser cookies via the Sessions UI
- **API key-based** (Claude, Gemini, OpenAI API, etc.): Add keys via the Sessions UI
- Sessions are persisted to both filesystem and a key-value store for durability
