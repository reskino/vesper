import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// ---------------------------------------------------------------------------
// Spawn the Python AI backend if it isn't already listening on port 5050
// ---------------------------------------------------------------------------

const PYTHON_PORT = 5050;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// dist/ → api-server/ → artifacts/ → workspace root
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const pythonBackendDir = path.join(repoRoot, "python-backend");

function isPythonRunning(): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = net.createConnection({ port: PYTHON_PORT, host: "127.0.0.1" });
    sock.once("connect", () => { sock.destroy(); resolve(true); });
    sock.once("error", () => resolve(false));
    sock.setTimeout(300);
    sock.once("timeout", () => { sock.destroy(); resolve(false); });
  });
}

async function ensurePythonBackend() {
  if (await isPythonRunning()) {
    logger.info("Python backend already running on port 5050");
    return;
  }

  logger.info({ pythonBackendDir }, "Starting Python AI backend…");

  const env = { ...process.env, PYTHON_BACKEND_PORT: String(PYTHON_PORT) };
  const child = spawn("python3", ["main.py"], {
    cwd: pythonBackendDir,
    env,
    stdio: "inherit",
    detached: false,
  });

  child.on("error", (err) => {
    logger.error({ err }, "Failed to spawn Python backend");
  });

  child.on("exit", (code, signal) => {
    logger.warn({ code, signal }, "Python backend exited");
  });

  // Wait up to 30 s for it to be ready
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
    if (await isPythonRunning()) {
      logger.info("Python backend is ready");
      return;
    }
  }

  logger.error("Python backend did not become ready within 30 s");
}

// ---------------------------------------------------------------------------
// Boot sequence
// ---------------------------------------------------------------------------

await ensurePythonBackend();

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
