# Vesper — Production Migration Guide
## Replit → Vercel + Supabase

---

## Architecture Overview

| Layer | Replit (current) | Production target |
|---|---|---|
| Frontend | Vite dev server | Vercel (static CDN) |
| API gateway | Express :8080 | Vercel Serverless Functions |
| AI backend | Python/Flask :5050 | Render.com (Docker) |
| Database | None / ephemeral | Supabase (PostgreSQL) |
| Auth | None | Clerk **or** Supabase Auth |
| Storage | Local filesystem | Supabase Storage |

> **Why Render for the Python backend?** Vercel does not support long-running Python processes or Playwright. Render's free/starter tier handles both.

---

## 1. Prerequisites

```bash
node >= 20
pnpm >= 9
python >= 3.11
docker (for local Render testing)
```

Accounts required:
- [vercel.com](https://vercel.com) — free Hobby tier works
- [supabase.com](https://supabase.com) — free tier works
- [clerk.com](https://clerk.com) — free (10 k MAU)
- [render.com](https://render.com) — free tier or $7/month Starter

---

## 2. Repository Restructure

The monorepo needs minor restructuring so Vercel and Render each understand their slice.

```
vesper/
├── apps/
│   ├── web/                   ← React/Vite frontend (→ Vercel)
│   └── api/                   ← Express gateway (→ Vercel Functions)
├── python-backend/            ← Flask/Playwright (→ Render)
├── packages/
│   └── api-client-react/      ← shared client (unchanged)
├── vercel.json                ← NEW
├── render.yaml                ← NEW
└── pnpm-workspace.yaml
```

Move current directories:
```bash
mv artifacts/ai-proxy  apps/web
mv artifacts/api-server apps/api
```

Update `pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

---

## 3. Supabase — Database Setup

### 3.1 Create a project

1. Go to [app.supabase.com](https://app.supabase.com) → **New project**
2. Choose a region close to your users — **Europe West** (Frankfurt) is closest to Ghana with low latency
3. Save the generated **database password**

### 3.2 Database Schema

Run the following in the Supabase SQL editor (**Database → SQL Editor → New query**):

```sql
-- ─────────────────────────────────────────────────────────────────
-- Enable UUID generation
-- ─────────────────────────────────────────────────────────────────
create extension if not exists "pgcrypto";

-- ─────────────────────────────────────────────────────────────────
-- Users  (mirrors Clerk/Supabase Auth user IDs)
-- ─────────────────────────────────────────────────────────────────
create table public.users (
  id           text primary key,          -- Clerk user_id or Supabase auth.users.id
  email        text unique not null,
  display_name text,
  avatar_url   text,
  plan         text not null default 'free',  -- free | pro | team
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────
-- Projects  (imported local folders / GitHub repos)
-- ─────────────────────────────────────────────────────────────────
create table public.projects (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references public.users(id) on delete cascade,
  name         text not null,
  description  text,
  file_tree    jsonb,                      -- serialised tree snapshot
  total_files  int not null default 0,
  total_bytes  bigint not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.projects(user_id);

-- ─────────────────────────────────────────────────────────────────
-- Conversations  (one conversation = one chat thread)
-- ─────────────────────────────────────────────────────────────────
create table public.conversations (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references public.users(id) on delete cascade,
  project_id   uuid references public.projects(id) on delete set null,
  title        text,                       -- auto-generated from first message
  ai_id        text,                       -- last used provider
  model_id     text,                       -- last used model
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on public.conversations(user_id);
create index on public.conversations(project_id);

-- ─────────────────────────────────────────────────────────────────
-- Messages  (individual chat turns)
-- ─────────────────────────────────────────────────────────────────
create table public.messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.conversations(id) on delete cascade,
  user_id          text not null references public.users(id) on delete cascade,
  role             text not null check (role in ('user','assistant','system')),
  content          text not null,
  ai_id            text,                   -- which provider answered
  model_id         text,
  routing_decision jsonb,                  -- VesperRouter decision snapshot
  elapsed_ms       int,
  fallback_used    boolean default false,
  tokens_in        int,
  tokens_out       int,
  created_at       timestamptz not null default now()
);
create index on public.messages(conversation_id);
create index on public.messages(user_id);

-- ─────────────────────────────────────────────────────────────────
-- AI Sessions  (API keys / cookie blobs per provider per user)
-- ─────────────────────────────────────────────────────────────────
create table public.ai_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      text not null references public.users(id) on delete cascade,
  ai_id        text not null,              -- claude | chatgpt | grok | etc.
  auth_mode    text not null,              -- api_key | cookies
  secret_ref   text,                       -- pointer to Supabase Vault secret
  model_id     text,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(user_id, ai_id)
);
create index on public.ai_sessions(user_id);

-- ─────────────────────────────────────────────────────────────────
-- Usage logs  (for rate limiting / billing)
-- ─────────────────────────────────────────────────────────────────
create table public.usage_events (
  id               uuid primary key default gen_random_uuid(),
  user_id          text not null references public.users(id) on delete cascade,
  conversation_id  uuid references public.conversations(id) on delete set null,
  ai_id            text,
  tokens_in        int default 0,
  tokens_out       int default 0,
  cost_usd         numeric(10,6) default 0,
  created_at       timestamptz not null default now()
);
create index on public.usage_events(user_id, created_at);

-- ─────────────────────────────────────────────────────────────────
-- Row Level Security
-- ─────────────────────────────────────────────────────────────────
alter table public.users          enable row level security;
alter table public.projects       enable row level security;
alter table public.conversations  enable row level security;
alter table public.messages       enable row level security;
alter table public.ai_sessions    enable row level security;
alter table public.usage_events   enable row level security;

-- Users can only read/write their own row
create policy "users: own row" on public.users
  for all using (id = auth.uid()::text);

-- Projects
create policy "projects: own" on public.projects
  for all using (user_id = auth.uid()::text);

-- Conversations
create policy "conversations: own" on public.conversations
  for all using (user_id = auth.uid()::text);

-- Messages
create policy "messages: own" on public.messages
  for all using (user_id = auth.uid()::text);

-- Sessions
create policy "ai_sessions: own" on public.ai_sessions
  for all using (user_id = auth.uid()::text);

-- Usage
create policy "usage_events: own" on public.usage_events
  for all using (user_id = auth.uid()::text);
```

### 3.3 Collect Supabase credentials

Go to **Project Settings → API**:

| Variable | Where to find it |
|---|---|
| `SUPABASE_URL` | Project URL (e.g. `https://xxxx.supabase.co`) |
| `SUPABASE_ANON_KEY` | `anon` public key |
| `SUPABASE_SERVICE_ROLE_KEY` | `service_role` key (server-only, never expose to browser) |
| `DATABASE_URL` | Settings → Database → Connection string (Transaction mode) |

---

## 4. Authentication

Choose **one** of the two options below.

---

### Option A — Clerk (recommended for teams)

Clerk gives you a polished UI, multi-factor auth, organisation support, and a generous free tier.

#### 4.1 Create a Clerk application

1. [dashboard.clerk.com](https://dashboard.clerk.com) → **Create application**
2. Enable: Email, Google OAuth (add more as needed)
3. Go to **API Keys** and copy:
   - `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (frontend)
   - `CLERK_SECRET_KEY` (backend)

#### 4.2 Install Clerk in the frontend

```bash
pnpm --filter @workspace/web add @clerk/clerk-react
```

Wrap your app root (`apps/web/src/main.tsx`):

```tsx
import { ClerkProvider } from "@clerk/clerk-react";

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
    <App />
  </ClerkProvider>
);
```

Protect routes:

```tsx
import { SignedIn, SignedOut, RedirectToSignIn } from "@clerk/clerk-react";

<SignedIn>
  <IDE />
</SignedIn>
<SignedOut>
  <RedirectToSignIn />
</SignedOut>
```

#### 4.3 Verify JWT in the Express API

```bash
pnpm --filter @workspace/api add @clerk/express
```

```typescript
// apps/api/src/middleware/auth.ts
import { requireAuth } from "@clerk/express";
export const authenticate = requireAuth();
```

Apply to protected routes:

```typescript
router.post("/proxy/ask", authenticate, proxyToPython);
```

#### 4.4 Sync Clerk users to Supabase

Create a Clerk webhook (Clerk Dashboard → Webhooks → Add endpoint):
- URL: `https://your-api.vercel.app/api/webhooks/clerk`
- Events: `user.created`, `user.updated`, `user.deleted`

```typescript
// apps/api/src/routes/webhooks.ts
import { Webhook } from "svix";
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

router.post("/webhooks/clerk", async (req, res) => {
  const wh = new Webhook(process.env.CLERK_WEBHOOK_SECRET!);
  const event = wh.verify(req.body, req.headers as any) as any;

  if (event.type === "user.created") {
    await supabase.from("users").upsert({
      id: event.data.id,
      email: event.data.email_addresses[0].email_address,
      display_name: `${event.data.first_name} ${event.data.last_name}`.trim(),
      avatar_url: event.data.image_url,
    });
  }

  if (event.type === "user.deleted") {
    await supabase.from("users").delete().eq("id", event.data.id);
  }

  res.json({ received: true });
});
```

---

### Option B — Supabase Auth (simpler, lower cost)

Good for solo projects or when you want everything in one platform.

#### 4.1 Enable Auth providers

Supabase Dashboard → **Authentication → Providers**:
- Email/Password ✓
- Google OAuth → add Client ID + Secret from Google Cloud Console

#### 4.2 Install Supabase client in frontend

```bash
pnpm --filter @workspace/web add @supabase/supabase-js @supabase/auth-ui-react
```

```tsx
// apps/web/src/lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);
```

Auth UI:

```tsx
import { Auth } from "@supabase/auth-ui-react";
import { ThemeSupa } from "@supabase/auth-ui-shared";

<Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} providers={["google"]} />
```

#### 4.3 Verify JWT in Express

```typescript
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function authenticate(req: Request, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: "Invalid token" });
  (req as any).user = user;
  next();
}
```

---

## 5. Environment Variables

### 5.1 Frontend (`apps/web/.env.production`)

```env
# Supabase
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ...

# Clerk (Option A only)
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...

# API gateway URL
VITE_API_BASE_URL=https://api.yourdomain.com
```

### 5.2 API gateway (`apps/api/.env.production`)

```env
# Supabase
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
DATABASE_URL=postgresql://postgres:[password]@db.xxxx.supabase.co:5432/postgres

# Clerk (Option A)
CLERK_SECRET_KEY=sk_live_...
CLERK_WEBHOOK_SECRET=whsec_...

# Python backend
PYTHON_BACKEND_URL=https://vesper-python.onrender.com

# Session
SESSION_SECRET=<random-64-char-hex>
```

### 5.3 Python backend (`python-backend/.env.production`)

```env
PYTHON_BACKEND_PORT=5050
FLASK_ENV=production
SESSION_SECRET=<same-value-as-api>

# Optional: Supabase for persisting session cookies
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 5.4 Set variables in Vercel

```bash
# Install Vercel CLI
npm i -g vercel

# Login and link project
vercel login
vercel link

# Push each secret
vercel env add SUPABASE_URL production
vercel env add SUPABASE_SERVICE_ROLE_KEY production
vercel env add CLERK_SECRET_KEY production
# ... repeat for each variable
```

---

## 6. Deploying the Python Backend to Render

The Python backend uses Playwright (a browser automation library) which requires a full Linux container — Vercel cannot run this. Render is the simplest alternative.

### 6.1 Create a `Dockerfile` in `python-backend/`

```dockerfile
FROM python:3.11-slim

RUN apt-get update && apt-get install -y \
    wget gnupg curl unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
RUN playwright install chromium --with-deps

COPY . .

EXPOSE 5050
CMD ["python", "main.py"]
```

### 6.2 Create `render.yaml` in the repo root

```yaml
services:
  - type: web
    name: vesper-python-backend
    env: docker
    dockerfilePath: ./python-backend/Dockerfile
    plan: starter          # $7/month — always on, no cold starts
    envVars:
      - key: PYTHON_BACKEND_PORT
        value: 5050
      - key: FLASK_ENV
        value: production
      - key: SESSION_SECRET
        sync: false        # enter manually in Render dashboard
      - key: SUPABASE_URL
        sync: false
      - key: SUPABASE_SERVICE_ROLE_KEY
        sync: false
    healthCheckPath: /health
```

### 6.3 Deploy to Render

1. Push `render.yaml` to your GitHub repository
2. Go to [dashboard.render.com](https://dashboard.render.com) → **New → Blueprint**
3. Connect your GitHub repo — Render reads `render.yaml` automatically
4. Set the secret env vars in the Render dashboard
5. Note the deployed URL: `https://vesper-python-backend.onrender.com`

> **Free tier note**: Render's free tier spins down after 15 minutes of inactivity (cold start ~30s). The **Starter plan at $7/month** keeps it always on — strongly recommended for production.

---

## 7. Deploying the Frontend and API to Vercel

### 7.1 Configure `vercel.json` in the repo root

```json
{
  "version": 2,
  "buildCommand": "pnpm --filter @workspace/web build",
  "outputDirectory": "apps/web/dist",
  "installCommand": "pnpm install",
  "framework": null,
  "rewrites": [
    { "source": "/api/(.*)", "destination": "/apps/api/src/index.ts" }
  ],
  "functions": {
    "apps/api/src/index.ts": {
      "maxDuration": 60
    }
  }
}
```

### 7.2 Adapt the Express API as a Vercel serverless function

Vercel Functions wrap Express with a single handler export. Install the adapter:

```bash
pnpm --filter @workspace/api add @vercel/node
```

Export the app in `apps/api/src/index.ts`:

```typescript
import express from "express";
import { proxyRouter } from "./routes/proxy";
import { sessionsRouter } from "./routes/sessions";
// ... other imports

const app = express();
app.use(express.json({ limit: "10mb" }));
app.use("/api", proxyRouter);
app.use("/api", sessionsRouter);

// Vercel requires a default export
export default app;
```

### 7.3 Deploy

```bash
vercel --prod
```

Or connect the GitHub repo in the Vercel dashboard for automatic deployments on every push.

---

## 8. Continuous Deployment Pipeline

```
GitHub push to main
       │
       ├── Vercel (auto)
       │     ├── build: pnpm --filter @workspace/web build
       │     ├── functions: apps/api/src/index.ts
       │     └── deploy → your-domain.vercel.app
       │
       └── Render (auto via render.yaml)
             ├── docker build python-backend/
             └── deploy → vesper-python.onrender.com
```

### 8.1 GitHub Actions for type checking (optional but recommended)

Create `.github/workflows/ci.yml`:

```yaml
name: CI
on: [push, pull_request]
jobs:
  typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with: { version: 9 }
      - run: pnpm install
      - run: pnpm --filter @workspace/web tsc --noEmit
      - run: pnpm --filter @workspace/api tsc --noEmit

  python-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: "3.11" }
      - run: pip install flake8
      - run: flake8 python-backend/ --max-line-length 120
```

---

## 9. Persist AI Sessions in Supabase

Currently, AI sessions (browser cookies + API keys) are stored on the local filesystem. In production they must live in the database.

### 9.1 Store API keys in Supabase Vault

Supabase Vault encrypts secrets at rest using `pgsodium`.

```sql
-- Enable vault
create extension if not exists supabase_vault;

-- Insert a secret
select vault.create_secret(
  'sk-ant-api-...',                          -- the API key value
  'user_abc123_claude_api_key',              -- name / reference
  'Claude API key for user abc123'           -- description
);
```

In Python, read the key before sending a request:

```python
import supabase

client = supabase.create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])

result = client.rpc("vault.decrypted_secrets").execute()
# or use a direct SQL query:
# SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'user_abc123_claude_api_key'
```

### 9.2 Store browser cookie sessions

For AIs requiring browser cookies (ChatGPT, Grok, etc.), serialise the Playwright cookie jar to JSON and store it in the `ai_sessions` table. Load it back when creating a new browser context:

```python
def save_session(user_id: str, ai_id: str, cookies: list):
    supabase.table("ai_sessions").upsert({
        "user_id": user_id,
        "ai_id": ai_id,
        "auth_mode": "cookies",
        "secret_ref": json.dumps(cookies),   # in prod: store in Vault, put vault id here
    }).execute()

def load_session(user_id: str, ai_id: str) -> list:
    row = supabase.table("ai_sessions")\
        .select("secret_ref")\
        .eq("user_id", user_id)\
        .eq("ai_id", ai_id)\
        .single()\
        .execute()
    return json.loads(row.data["secret_ref"])
```

---

## 10. Cost Estimate — Ghana-based usage

Exchange rate used: **1 USD ≈ 15.5 GHS** (April 2026 average).

### Infrastructure costs per month

| Service | Plan | USD/month | GHS/month |
|---|---|---|---|
| **Vercel** | Hobby (free) | $0 | ₵0 |
| **Vercel** | Pro (custom domain, analytics) | $20 | ₵310 |
| **Supabase** | Free (500 MB DB, 1 GB storage) | $0 | ₵0 |
| **Supabase** | Pro (8 GB DB, 100 GB storage) | $25 | ₵388 |
| **Render** | Free (cold starts) | $0 | ₵0 |
| **Render** | Starter (always on, 512 MB RAM) | $7 | ₵109 |
| **Render** | Standard (1 GB RAM) | $25 | ₵388 |
| **Clerk** | Free (10 k MAU) | $0 | ₵0 |
| **Clerk** | Pro (unlimited MAU) | $25 | ₵388 |

### Recommended tier by stage

| Stage | Config | USD/month | GHS/month |
|---|---|---|---|
| **Solo / testing** | Vercel Hobby + Supabase Free + Render Free + Clerk Free | **$0** | **₵0** |
| **Small team (< 5 users)** | Vercel Hobby + Supabase Free + Render Starter + Clerk Free | **$7** | **₵109** |
| **Growth (5–50 users)** | Vercel Pro + Supabase Pro + Render Starter + Clerk Free | **$52** | **₵806** |
| **Production (50–500 users)** | Vercel Pro + Supabase Pro + Render Standard + Clerk Pro | **$95** | **₵1,473** |

### AI API costs (pay-per-use, additional)

These are charged by each AI provider directly. You pass your own API keys — Vesper does not mark them up.

| Provider | Model | Cost per 1 M tokens in / out |
|---|---|---|
| Anthropic | Claude 3.5 Sonnet | $3 / $15 |
| OpenAI | GPT-4o | $2.50 / $10 |
| Google | Gemini 1.5 Pro | $1.25 / $5 |
| Groq | Llama 3.1 70B | $0.59 / $0.79 |
| DeepSeek | R1 | $0.55 / $2.19 |
| Pollinations AI | Various | **Free** |

> **Ghana tip**: Pollinations AI is always free and requires no API key. For light usage, it covers most needs at zero cost. For heavy code generation, Groq and DeepSeek offer the best price-to-performance ratio in USD terms.

### Bandwidth note
Supabase Free includes **2 GB egress/month**. Vercel Hobby includes **100 GB**. For a team of 10 developers, both limits are comfortable unless you store large file uploads.

---

## 11. Custom Domain (optional)

### Vercel
```bash
vercel domains add vesper.yourdomain.com
# Update your domain registrar's DNS:
# CNAME  vesper  cname.vercel-dns.com
```

### Render
In the Render dashboard → your service → **Settings → Custom Domains** → add `api.yourdomain.com`.

Supabase uses its own domain for the database — no custom domain needed there.

---

## 12. Migration Checklist

- [ ] Supabase project created, schema applied
- [ ] RLS policies verified (test with a non-admin user)
- [ ] Auth provider configured (Clerk **or** Supabase Auth)
- [ ] All environment variables set in Vercel and Render dashboards
- [ ] `python-backend/Dockerfile` created and tested locally
- [ ] `render.yaml` committed and Render blueprint deployed
- [ ] `vercel.json` configured, Vercel deployment successful
- [ ] API → Python backend proxy URL updated to Render URL
- [ ] Frontend `VITE_API_BASE_URL` pointing to Vercel function URL
- [ ] AI session persistence wired to Supabase (not local filesystem)
- [ ] GitHub Actions CI passing
- [ ] Custom domain (optional) DNS propagated
- [ ] Smoke test: send a message through the full stack end-to-end
