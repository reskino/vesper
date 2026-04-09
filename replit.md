# Universal AI Coding Proxy

## Overview

A full-stack Universal AI Coding Proxy and AI-powered development environment that routes coding prompts to multiple AI services (ChatGPT, Grok, Claude) via their **official REST APIs**. Requires API keys — stored locally in `python-backend/sessions/keys.json` or via environment variables.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **Frontend**: React + Vite (artifacts/ai-proxy) at `/`
- **API Gateway**: Express 5 (artifacts/api-server) at `/api`
- **Python Backend**: Flask + OpenAI/Anthropic SDKs (python-backend/) on port 5050
- **Validation**: Zod (`zod/v4`)
- **API codegen**: Orval (from OpenAPI spec)

## Architecture

```
Browser → React Frontend (/) → Express API (/api) → Python Flask (:5050) → Official APIs (OpenAI / xAI / Anthropic)
```

The Express server proxies all routes to the Python Flask backend which calls official AI REST APIs.

## Python Backend (python-backend/)

- `main.py` — Flask app, all API routes
- `config.py` — AI service configs, selectors for each AI UI
- `playwright_utils.py` — browser automation functions (login, send prompt, extract response)
- `history_manager.py` — conversation history stored in logs/conversation_history.json
- `file_manager.py` — workspace file tree, read, write, create, delete, rename
- `terminal_manager.py` — shell command execution with persistent CWD
- `agent.py` — autonomous coding agent engine (tool loop: think → call tool → observe → repeat)
- `sessions/` — browser storage_state JSON files per AI
- `logs/` — conversation history

## Pages (Frontend)

1. **Chat** (`/`) — Prompt any AI, markdown responses, execute code blocks inline
2. **Editor** (`/editor`) — File tree browser, CodeMirror code editor, AI assistant panel with context-aware actions
3. **Terminal** (`/terminal`) — Full shell terminal, run any bash/python/node command, install packages
4. **Agent** (`/agent`) — Autonomous coding agent: describe a task, the AI plans and executes it using tools (read/write files, run commands, install packages) until done
5. **Sessions** (`/sessions`) — Manage AI browser sessions (login to ChatGPT/Grok/Claude)
6. **History** (`/history`) — Full conversation history log

## Agent Tool System

The agent in `agent.py` lets the AI call these tools in its responses:
- `execute` — run any shell command
- `write_file` — create or overwrite a file
- `read_file` — read file contents
- `create_dir` — create a directory
- `delete` — delete file or directory
- `list_dir` — list directory contents

Agent runs in a background thread (non-blocking HTTP); frontend polls `/api/agent/status` every 2 seconds.

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec (then fix lib/api-zod/src/index.ts to only re-export `./generated/api`, then `pnpm run typecheck:libs`)
- `pnpm --filter @workspace/ai-proxy run dev` — run frontend locally
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `cd python-backend && python3 main.py` — run Python AI backend

## How to Use

### First Login (per AI)
1. Go to the **Sessions** page
2. Click **Create Session** for the AI you want to use
3. A browser window opens — log in manually
4. Close the browser — session is saved automatically

### Chat Mode
1. Select an AI from the sidebar (green = ready, amber = needs session)
2. Type your coding question and click Send
3. Response renders with markdown and syntax-highlighted code
4. Click **Execute** on any code block to run it and see output

### Editor + AI Context
1. Open **Editor** → browse to any file → click to open it
2. Select an action: Explain Code, Fix Bugs, Refactor, Write Tests
3. AI gets the full file contents as context
4. Click **Apply to File** to paste AI suggestions back into the editor

### Terminal
1. Open **Terminal** → type any shell command
2. Supports: `ls`, `pwd`, `cd`, `pip install`, `npm install`, `python3 script.py`, `git`, etc.
3. Arrow keys cycle through command history (Ctrl+L clears)

### Agent Mode
1. Open **Agent** → type a task description like "Create a Flask API, test it, and save to api.py"
2. Select which AI to use, click **Run Agent**
3. Watch the step-by-step trace: AI reasoning → tool calls → results
4. When done, see the summary. New files appear automatically in the Editor

### Updating Selectors
AI websites change their UI. To update selectors, edit `python-backend/config.py`.

## Workflows

- **Python AI Backend** — Flask server on port 5050
- **artifacts/ai-proxy: web** — React frontend
- **artifacts/api-server: API Server** — Express proxy gateway
