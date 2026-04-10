# Vesper — Universal AI Coding Proxy & IDE

## Overview

**Vesper** is a full-stack, VS Code-like AI-native IDE that gives developers ONE interface to access ChatGPT, Claude, Grok, Groq, Gemini, and others via official REST APIs. Built as a pnpm monorepo with a React/Vite frontend, Express API gateway, and Python Flask backend.

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
Browser → React Frontend (/) → Express API (/api) → Python Flask (:5050) → Official AI REST APIs
```

The Express server proxies all routes to the Python Flask backend which calls official AI REST APIs.

## IDE Layout (VS Code-like)

The frontend (`artifacts/ai-proxy/src/`) uses a full IDE shell:

- **`contexts/ide-context.tsx`** — Global IDE state (active file, panels, model selection, chat key)
- **`components/layout/ide-layout.tsx`** — Main shell: activity bar + secondary sidebar + main area + mobile nav
- **`components/layout/activity-bar.tsx`** — Left icon strip (Files, Agent, Sessions, History, Help)
- **`components/layout/top-bar.tsx`** — Top bar: Vesper logo, model selector, panel toggles, settings
- **`components/ide/file-explorer.tsx`** — Secondary sidebar file tree with import/export
- **`components/ide/editor-panel.tsx`** — Center: CodeMirror editor + AI context panel
- **`components/ide/chat-panel.tsx`** — Right panel: multi-turn AI chat with file context & streaming
- **`components/ide/terminal-panel.tsx`** — Bottom: persistent shell terminal

### Design System

- Background: `#0a0a0c` / `#0d0d12`
- Borders: `#1a1a24`
- Muted text: `#52526e`
- Primary: cyberpunk blue (via Tailwind `primary`)
- Dark mode: always-on (class set on `<html>` in `main.tsx`)

### Keyboard Shortcuts

- `Ctrl/Cmd + `` ` `` ` → Toggle terminal
- `Ctrl/Cmd + J` → Toggle chat panel
- `Ctrl/Cmd + N` → New chat

## Python Backend (python-backend/)

- `main.py` — Flask app, all API routes
- `config.py` — AI service configs (12 providers)
- `playwright_utils.py` — browser automation functions
- `history_manager.py` — conversation history (logs/conversation_history.json)
- `file_manager.py` — workspace file tree, read, write, create, delete, rename
- `terminal_manager.py` — shell command execution with persistent CWD
- `agent.py` — autonomous coding agent engine (tool loop: think → call tool → observe → repeat)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks from OpenAPI spec
- `pnpm --filter @workspace/ai-proxy run dev` — run frontend locally
- `pnpm --filter @workspace/api-server run dev` — run API server locally
- `cd python-backend && python3 main.py` — run Python AI backend

## Workflows

- **Python AI Backend** — Flask server on port 5050
- **artifacts/ai-proxy: web** — React frontend (port 19906)
- **artifacts/api-server: API Server** — Express proxy gateway (port 8080)

## Supported AI Providers (12)

ChatGPT, Claude, Grok, Groq, Gemini, Pollinations (free), Deepseek, Mistral, Cohere, Perplexity, Together AI, Hugging Face

## Africa-First Roadmap Notes

- Sprint 4 target: Paystack + MTN MoMo monetization
- Offline awareness + data-lite mode planned
- Mobile-first responsive layout with bottom nav already implemented
