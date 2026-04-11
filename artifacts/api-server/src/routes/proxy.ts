import { Router, type IRouter, type Request, type Response } from "express";
import http from "http";

const router: IRouter = Router();

const PYTHON_HOST = "127.0.0.1";
const PYTHON_PORT = parseInt(process.env["PYTHON_BACKEND_PORT"] ?? "5050");

function proxyToPython(req: Request, res: Response) {
  const path = req.url;
  const method = req.method;
  const body = method !== "GET" && method !== "DELETE" ? JSON.stringify(req.body) : undefined;

  const options: http.RequestOptions = {
    hostname: PYTHON_HOST,
    port: PYTHON_PORT,
    path: `/api${path}`,
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
  };

  if (body) {
    options.headers = {
      ...options.headers,
      "Content-Length": Buffer.byteLength(body),
    };
  }

  const proxyReq = http.request(options, (proxyRes) => {
    const statusCode = proxyRes.statusCode ?? 200;
    const contentType = proxyRes.headers["content-type"] ?? "";

    // For binary responses (images etc.) stream raw bytes through
    if (contentType.startsWith("image/") || contentType === "application/octet-stream") {
      res.status(statusCode);
      res.setHeader("Content-Type", contentType);
      if (proxyRes.headers["cache-control"]) res.setHeader("Cache-Control", proxyRes.headers["cache-control"]);
      proxyRes.pipe(res);
      return;
    }

    res.status(statusCode);
    const chunks: Buffer[] = [];
    proxyRes.on("data", (chunk: Buffer) => chunks.push(chunk));
    proxyRes.on("end", () => {
      const rawBody = Buffer.concat(chunks).toString("utf8");
      try {
        res.json(JSON.parse(rawBody));
      } catch {
        res.send(rawBody);
      }
    });
  });

  proxyReq.on("error", (err) => {
    req.log.error({ err }, "Python backend proxy error");
    res.status(503).json({
      error: "Python AI backend is not running. Start it with: cd python-backend && python main.py",
    });
  });

  if (body) {
    proxyReq.write(body);
  }
  proxyReq.end();
}

// AI Proxy routes
router.get("/proxy/ais", proxyToPython);
router.post("/proxy/ask", proxyToPython);
router.post("/proxy/ask-with-context", proxyToPython);
router.post("/proxy/execute", proxyToPython);
router.post("/proxy/set-model", proxyToPython);
router.post("/proxy/route", proxyToPython);
router.post("/proxy/validate-models", proxyToPython);

// Session routes
router.get("/sessions", proxyToPython);
router.post("/sessions/create", proxyToPython);
router.post("/sessions/import", proxyToPython);
router.post("/sessions/import-key", proxyToPython);
router.delete("/sessions/:aiId/delete", proxyToPython);
router.get("/sessions/browser-status/:aiId", proxyToPython);
router.get("/sessions/browser-screenshot/:aiId", proxyToPython);
router.post("/sessions/browser-action/:aiId", proxyToPython);
router.get("/sessions/verify/:aiId", proxyToPython);

// History routes
router.get("/history", proxyToPython);
router.get("/history/stats", proxyToPython);
router.get("/history/:aiId", proxyToPython);
router.delete("/history/:aiId", proxyToPython);

// File system routes
router.get("/files/tree", proxyToPython);
router.get("/files/read", proxyToPython);
router.post("/files/write", proxyToPython);
router.post("/files/create", proxyToPython);
router.delete("/files/delete", proxyToPython);
router.post("/files/rename", proxyToPython);

// Terminal routes
router.post("/terminal/exec", proxyToPython);
router.get("/terminal/cwd", proxyToPython);
router.get("/terminal/savings", proxyToPython);

// Web scraper routes
router.post("/scraper/scrape", proxyToPython);
router.get("/scraper/search", proxyToPython);
router.post("/scraper/search", proxyToPython);

// Agent routes (single)
router.post("/agent/run", proxyToPython);
router.post("/agent/stop", proxyToPython);
router.get("/agent/status", proxyToPython);
router.get("/agent/screenshot/:filename", proxyToPython);

// Graph analysis (Graphify) routes
router.get("/graph/jobs", proxyToPython);
router.post("/graph/analyze", proxyToPython);
router.get("/graph/jobs/:jobId", proxyToPython);
router.delete("/graph/jobs/:jobId", proxyToPython);
router.post("/graph/clear-done", proxyToPython);

// Multi-agent swarm routes
router.get("/agents", proxyToPython);
router.post("/agents/spawn", proxyToPython);
router.post("/agents/clear-done", proxyToPython);
router.get("/agents/:agentId", proxyToPython);
router.post("/agents/:agentId/stop", proxyToPython);
router.delete("/agents/:agentId", proxyToPython);

export default router;
