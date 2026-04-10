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
- `artifacts/api-server/src/index.ts` — API gateway bootstrapper
- `artifacts/ai-proxy/src/App.tsx` — Frontend entry point
- `artifacts/ai-proxy/src/contexts/ide-context.tsx` — Global IDE state

## Dependencies
- Python: flask, flask-cors, flask-sqlalchemy, playwright, openai, anthropic, gunicorn
- Node: express, vite, react, react-query, codemirror, monaco-editor, xterm, tailwindcss
- System: playwright-driver (chromium), postgresql, openssl

## AI Provider Authentication
- **Cookie-based** (ChatGPT, Grok, etc.): Import browser cookies via the Sessions UI
- **API key-based** (Claude, Gemini, OpenAI API, etc.): Add keys via the Sessions UI
- Sessions are persisted to both filesystem and a key-value store for durability
