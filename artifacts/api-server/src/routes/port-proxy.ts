import { Router, type IRouter, type Request, type Response } from "express";
import http from "http";

const router: IRouter = Router();

const ALLOWED_PORTS_MIN = 1024;
const ALLOWED_PORTS_MAX = 65535;

router.use("/port-proxy", (req: Request, res: Response) => {
  const pathAfterMount = req.url.startsWith("/") ? req.url.slice(1) : req.url;
  const slashIdx = pathAfterMount.indexOf("/");
  const portStr = slashIdx === -1 ? pathAfterMount.split("?")[0] : pathAfterMount.slice(0, slashIdx);
  const port = parseInt(portStr, 10);

  if (Number.isNaN(port) || port < ALLOWED_PORTS_MIN || port > ALLOWED_PORTS_MAX) {
    res.status(400).json({ error: `Invalid port: must be ${ALLOWED_PORTS_MIN}-${ALLOWED_PORTS_MAX}` });
    return;
  }

  const targetPath = slashIdx === -1 ? "/" : pathAfterMount.slice(slashIdx);

  const options: http.RequestOptions = {
    hostname: "127.0.0.1",
    port,
    path: targetPath,
    method: req.method,
    headers: {
      ...req.headers,
      host: `127.0.0.1:${port}`,
    },
  };

  delete options.headers!["accept-encoding"];

  const proxyReq = http.request(options, (proxyRes) => {
    const statusCode = proxyRes.statusCode ?? 200;
    const headers = { ...proxyRes.headers };
    delete headers["x-frame-options"];
    delete headers["content-security-policy"];

    res.writeHead(statusCode, headers);
    proxyRes.pipe(res);
  });

  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.status(502).json({ error: `Cannot connect to localhost:${port} - is the server running?` });
    }
  });

  if (req.method !== "GET" && req.method !== "HEAD") {
    req.pipe(proxyReq);
  } else {
    proxyReq.end();
  }
});

export default router;
