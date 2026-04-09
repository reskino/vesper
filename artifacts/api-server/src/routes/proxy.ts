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
    res.status(proxyRes.statusCode ?? 200);
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

router.get("/proxy/ais", proxyToPython);
router.post("/proxy/ask", proxyToPython);
router.post("/proxy/execute", proxyToPython);
router.get("/sessions", proxyToPython);
router.post("/sessions/create", proxyToPython);
router.delete("/sessions/:aiId/delete", proxyToPython);
router.get("/history", proxyToPython);
router.get("/history/stats", proxyToPython);
router.get("/history/:aiId", proxyToPython);
router.delete("/history/:aiId", proxyToPython);

export default router;
