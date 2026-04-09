# Universal AI Coding Proxy

## Overview

A full-stack Universal AI Coding Proxy that routes coding prompts to multiple AI chat services (ChatGPT, Grok, Claude) via browser automation with Playwright. No API keys needed — drives the actual AI websites with persistent logged-in sessions.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/ai-proxy) at `/`
- **API Gateway**: Express 5 (artifacts/api-server) at `/api`
- **Python Backend**: Flask + Playwright (python-backend/) on port 5050
- **Database**: PostgreSQL + Drizzle ORM (not yet used)
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)

## Architecture

```
Browser → React Frontend (/) → Express API (/api) → Python Flask (:5050) → Playwright → AI Websites
```

The Express server proxies all AI-related routes to the Python Flask backend which does browser automation.

## Python Backend (python-backend/)

- `main.py` — Flask app, all API routes
- `config.py` — AI service configs, selectors for each AI UI
- `playwright_utils.py` — browser automation functions (login, send prompt, extract response)
- `history_manager.py` — conversation history stored in logs/conversation_history.json
- `sessions/` — browser storage_state JSON files per AI
- `logs/` — conversation history

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec
- `pnpm --filter @workspace/ai-proxy run dev` — run frontend locally
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `cd python-backend && python3 main.py` — run Python AI backend

## How to Use

### First Login (per AI)
1. Go to the **Sessions** page in the UI
2. Click **Create Session** for the AI you want to use
3. A browser window opens — log in manually
4. Close the browser — session is saved automatically

### Sending Prompts
1. Select an AI from the sidebar (green = ready, amber = needs session)
2. Type your coding question and click Send
3. Response renders with markdown and syntax-highlighted code
4. Click **Execute** on any code block to run it in Replit

### Updating Selectors
AI websites change their UI. To update selectors, edit `python-backend/config.py` — the `selectors` dict for each AI. Use browser DevTools to find the correct CSS selectors.

### Adding New AIs
Add a new entry to `AI_CONFIGS` in `python-backend/config.py` following the existing pattern.

## Workflows

- **Python AI Backend** — Flask server on port 5050
- **artifacts/ai-proxy: web** — React frontend
- **artifacts/api-server: API Server** — Express proxy gateway
