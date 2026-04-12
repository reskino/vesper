# Vesper — AI-Native IDE & Coding Agent Platform

**by Skinopro Tech Solutions (Ghana)**
Live at: [https://vespe.replit.app](https://vespe.replit.app) | Source: [github.com/reskino/vesper](https://github.com/reskino/vesper)

---

## What is Vesper?

Vesper is a full-stack, browser-based AI IDE that unifies 15+ AI providers (ChatGPT, Claude, Gemini, Grok, Groq, DeepSeek, Mistral, and more) behind a single VS Code-like interface. It includes:

- **Multi-tab Monaco code editor** with syntax highlighting, IntelliSense, and a custom Vesper theme
- **Autonomous coding agent** (8 specialist personas: Builder, Orchestrator, Scholar, Code Surgeon, etc.) that can read/write files, install packages, and execute terminal commands
- **Intelligent chat** with intent detection — auto-offers to install packages or run scripts directly, bypassing the AI round-trip
- **Workspace isolation** — each project gets its own `.venv` (Python) or `node_modules` (JS), managed automatically
- **Integrated terminal**, file explorer, dependency manager, command palette (`Ctrl+K`), and PDF/Word export
- **Responsive mobile layout** with bottom navigation

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite 7, TypeScript, TailwindCSS v4, Monaco Editor, TanStack Query |
| API Gateway | Node.js, Express 5, Pino logger, Helmet, express-rate-limit, compression |
| AI Backend | Python 3.11, Flask 3, Playwright, flask-compress, gunicorn |
| Dependency management | pnpm workspaces (monorepo), uv (Python venvs) |
| Deployment | Replit Autoscale |

---

## Architecture

```
Browser ──► Frontend (Vite/React, port 19906)
              │
              └──► API Gateway (Express, port 8080)
                      │
                      └──► Python AI Backend (Flask, port 5050)
                                │
                                ├── Playwright browser sessions (ChatGPT / Claude / Grok web)
                                ├── Direct API calls (Groq, Gemini, Mistral, OpenRouter, etc.)
                                ├── Workspace manager (uv venvs + npm installs)
                                └── Autonomous agent (think → tool → observe loop)
```

### Monorepo structure

```
vesper/
├── artifacts/
│   ├── ai-proxy/        # React + Vite frontend
│   └── api-server/      # Express API gateway
├── python-backend/      # Flask AI backend
├── lib/
│   ├── api-spec/        # OpenAPI YAML (source of truth)
│   ├── api-zod/         # Auto-generated Zod types
│   └── api-client-react/# Auto-generated React Query hooks
└── workspaces/          # User workspace directories
```

---

## Running Locally

### Prerequisites

- Node.js 20+ and pnpm 9+ (`npm i -g pnpm`)
- Python 3.11+ and uv (`pip install uv`)
- Playwright browsers: `playwright install chromium`

### Start all three services

```bash
# 1. Install all dependencies
pnpm install
pip install -r python-backend/requirements.txt

# 2. Start Python backend (terminal 1)
cd python-backend
PYTHON_BACKEND_PORT=5050 python3 main.py

# 3. Start API gateway (terminal 2)
PORT=8080 pnpm --filter @workspace/api-server run dev

# 4. Start frontend (terminal 3)
PORT=19906 BASE_PATH=/ pnpm --filter @workspace/ai-proxy run dev
```

Then open **http://localhost:19906** in your browser.

> On Replit, all three services start automatically via the configured Workflows.

---

## Environment Variables / Secrets

All secrets must be set via **Replit Secrets** (or your own `.env` file locally — never commit them).

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Flask session signing key — set to a long random string |
| `PYTHON_BACKEND_PORT` | Yes | Port for Flask (default `5050`) |
| `PORT` | Yes | Port for Express gateway (default `8080`) |
| `BASE_PATH` | Yes | Frontend base path (default `/`) |
| `FLASK_ENV` | No | Set to `production` in deployed environment |
| `CHROMIUM_PATH` | No | Override path to Chromium binary for Playwright |

**User API keys** (Groq, Gemini, Anthropic, etc.) are entered in-app via the Sessions panel and stored encrypted in the Flask backend's key store — they are **never** sent to the Express gateway or logged.

---

## Deploying to Replit

### Recommended deployment type: **Autoscale**

Autoscale is ideal for Vesper because:
- Scales to zero when idle (saves cost)
- Handles traffic bursts (multiple users connecting to sessions)
- Persistent disk is not required (workspaces are ephemeral per session)

### Steps

1. Open your Repl → click **Deploy** → choose **Autoscale**
2. Set the run command to:
   ```
   PORT=8080 pnpm --filter @workspace/api-server run start
   ```
   The API server auto-spawns the Python backend on startup.
3. Set environment variables in the **Secrets** tab:
   - `SESSION_SECRET` → random 32+ char string
   - `FLASK_ENV` → `production`
   - `PYTHON_BACKEND_PORT` → `5050`
4. Under **Custom domain**, point your domain to the Replit deployment URL.
5. Click **Deploy** and wait for the health check to pass.

> For persistent user workspaces across deployments, use **Reserved VM** instead.
> Reserved VM keeps the disk between restarts, preserving workspace `.venv` directories.

### After deployment

- Visit your `.replit.app` URL (or custom domain)
- Test AI connections: Sessions tab → connect one provider (e.g. Pollinations — no key needed)
- Test the agent: Agent tab → create a workspace → give it a task

---

## Production Safeguards

| Concern | What Vesper does |
|---|---|
| **Rate limiting** | Express: 300 req/min general, 60 req/min AI chat, 10 req/min agent runs |
| **Security headers** | Helmet middleware (X-Frame-Options, HSTS, X-Content-Type-Options, etc.) |
| **Gzip compression** | `compression` (Express) + `flask-compress` (Flask) — reduces payload ~60-80% |
| **Secret exposure** | Query strings stripped from access logs; stack traces hidden in production |
| **Error handling** | Global Express error handler returns clean JSON; PanelErrorBoundary in React |
| **Log level** | DEBUG in development, INFO in production (`FLASK_ENV=production`) |
| **Sensitive route scrubbing** | API keys stored only in the Python key store, never logged or forwarded |

---

## Testing the Production Build

```bash
# Build the frontend
cd artifacts/ai-proxy
NODE_ENV=production BASE_PATH=/ PORT=19906 pnpm run build

# Preview the production bundle locally
BASE_PATH=/ PORT=19906 pnpm run preview

# Check bundle sizes (look for oversized chunks)
# Monaco Editor chunks will be ~3 MB each — this is expected.
```

### Performance targets

| Metric | Target |
|---|---|
| First Contentful Paint (3G) | < 4 s |
| Time to Interactive (3G) | < 8 s |
| Main JS bundle (excluding Monaco) | < 500 KB |
| Monaco Editor chunks | ~3 MB (loaded lazily on editor focus) |

### Testing checklist after deploy

- [ ] App loads on live URL with no console errors
- [ ] All AI providers show in Sessions tab
- [ ] Pollinations (no-key provider) works out of the box
- [ ] Agent can create a file and run Python in a workspace
- [ ] Chat intent detection: type `install requests` → install strip appears
- [ ] Chat intent detection: type `run main.py` → run strip appears
- [ ] No API keys appear in server logs (`FLASK_ENV=production`)
- [ ] Response headers include `X-Frame-Options` and `X-Content-Type-Options`
- [ ] Load app on a mobile device — bottom nav works

---

## Suggested Next Step

**Full Testing Round** — run the app against a real AI provider (e.g. Groq free tier), create a workspace, write a Python script via the agent, run it with the venv, and verify the output appears correctly in the chat. Then run Lighthouse in Chrome DevTools on the deployed URL to confirm FCP < 4 s on simulated 3G.
