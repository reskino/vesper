import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import rateLimit from "express-rate-limit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Trust the first reverse-proxy hop (Replit's load balancer / preview proxy).
// Required so express-rate-limit can read X-Forwarded-For correctly and so
// req.protocol returns "https" behind the Replit mTLS proxy.
app.set("trust proxy", 1);

// ── Security headers ────────────────────────────────────────────────────────
// Helmet sets X-Content-Type-Options, X-Frame-Options, HSTS, etc.
// Content-Security-Policy is disabled here because the frontend is served by
// Vite / the preview proxy — enabling it server-side would break the dev HMR.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  }),
);

// ── Gzip compression ────────────────────────────────────────────────────────
// Compress JSON API responses before sending (saves bandwidth, speeds up
// slow-network / mobile clients). Skip small payloads (< 1 KB).
app.use(
  compression({
    level: 6,        // balanced speed vs ratio
    threshold: 1024, // don't bother compressing tiny responses
  }),
);

// ── Rate limiting ───────────────────────────────────────────────────────────
// Protect expensive endpoints from abuse and runaway client loops.

// General API limit — generous, covers file tree / health polling
const generalLimiter = rateLimit({
  windowMs: 60_000,       // 1-minute window
  max: 300,               // 300 req / min per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Too many requests — please slow down." },
  skip: (req) => req.path === "/api/healthz", // never throttle health checks
});

// AI chat / proxy limit — each request fans out to external AI providers
const chatLimiter = rateLimit({
  windowMs: 60_000,
  max: 60,  // 60 AI requests / min per IP  (~1/sec sustained)
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Chat rate limit exceeded — wait a moment before sending more messages." },
});

// Agent runs — each run spawns a long-lived background process
const agentLimiter = rateLimit({
  windowMs: 60_000,
  max: 10,  // 10 agent runs / min per IP
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "Agent run rate limit exceeded — please wait before launching another run." },
});

// Apply general limiter to all /api routes, then tighter limits to hot paths
app.use("/api", generalLimiter);
app.use("/api/proxy/chat", chatLimiter);
app.use("/api/proxy/ask",  chatLimiter);
app.use("/api/agent/run",  agentLimiter);

// ── Request logging ─────────────────────────────────────────────────────────
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          // Strip query strings from logs to avoid leaking API keys
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// ── Body parsing ─────────────────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Routes ───────────────────────────────────────────────────────────────────
app.use("/api", router);

// ── Global error handler ─────────────────────────────────────────────────────
// Catches unhandled errors thrown from route handlers and returns a clean JSON
// response instead of leaking stack traces to the client.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  const isProd = process.env.NODE_ENV === "production";
  logger.error({ err }, "Unhandled route error");
  res.status(500).json({
    error: isProd ? "Internal server error" : err.message,
    ...(isProd ? {} : { stack: err.stack }),
  });
});

export default app;
