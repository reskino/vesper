import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import archiver from "archiver";
import unzipper from "unzipper";
import path from "path";
import fs from "fs";
import fsp from "fs/promises";
import { execSync, exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
const router: IRouter = Router();

const WORKSPACE_ROOT = process.env["WORKSPACE_ROOT"] ?? "/home/runner/workspace";

// Directories/files to skip when exporting
const EXPORT_SKIP = new Set([
  "node_modules", ".git", "__pycache__", ".venv", "venv",
  ".local", "dist", ".next", ".nuxt", "build", "coverage",
  ".tsbuildinfo",
]);

// ─── Multer setup (memory storage for < 200MB) ───────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 200 * 1024 * 1024 },
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

function safeJoin(base: string, rel: string): string {
  const resolved = path.resolve(base, rel);
  if (!resolved.startsWith(base)) throw new Error("Path escape attempt");
  return resolved;
}

async function extractZip(buffer: Buffer, destDir: string): Promise<string[]> {
  await fsp.mkdir(destDir, { recursive: true });
  const extracted: string[] = [];

  await new Promise<void>((resolve, reject) => {
    const stream = unzipper.Parse();
    stream.on("entry", async (entry: unzipper.Entry) => {
      const filePath = path.join(destDir, entry.path);
      if (entry.type === "Directory") {
        await fsp.mkdir(filePath, { recursive: true });
        entry.autodrain();
      } else {
        await fsp.mkdir(path.dirname(filePath), { recursive: true });
        const writeStream = fs.createWriteStream(filePath);
        entry.pipe(writeStream);
        extracted.push(entry.path);
      }
    });
    stream.on("finish", resolve);
    stream.on("error", reject);

    const { Readable } = require("stream");
    Readable.from(buffer).pipe(stream);
  });

  return extracted;
}

function shouldSkip(name: string): boolean {
  return EXPORT_SKIP.has(name) || name.startsWith(".");
}

// ─── POST /files/upload ───────────────────────────────────────────────────────
router.post(
  "/files/upload",
  upload.array("files"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const targetDir = (req.body?.targetDir as string) || "";
      const files = req.files as Express.Multer.File[];

      if (!files || files.length === 0) {
        res.status(400).json({ error: "No files uploaded" });
        return;
      }

      const results: { path: string; type: string; extracted?: string[] }[] = [];

      for (const file of files) {
        // originalname may contain a relative path (when folder is uploaded via webkitdirectory)
        const relativeName = file.originalname.replace(/\\/g, "/");
        const destPath = safeJoin(WORKSPACE_ROOT, path.join(targetDir, relativeName));
        await fsp.mkdir(path.dirname(destPath), { recursive: true });

        const isZip =
          file.mimetype === "application/zip" ||
          file.mimetype === "application/x-zip-compressed" ||
          relativeName.endsWith(".zip");

        if (isZip) {
          // Extract zip
          const zipName = path.basename(relativeName, ".zip");
          const extractDest = safeJoin(
            WORKSPACE_ROOT,
            path.join(targetDir, path.dirname(relativeName), zipName)
          );
          const extracted = await extractZip(file.buffer, extractDest);
          results.push({
            path: path.relative(WORKSPACE_ROOT, extractDest),
            type: "zip_extracted",
            extracted,
          });
        } else {
          // Regular file
          await fsp.writeFile(destPath, file.buffer);
          results.push({
            path: path.relative(WORKSPACE_ROOT, destPath),
            type: "file",
          });
        }
      }

      res.json({ uploaded: files.length, results });
    } catch (err) {
      req.log.error({ err }, "Upload error");
      res.status(500).json({ error: String(err) });
    }
  }
);

// ─── POST /files/import-github ────────────────────────────────────────────────
router.post("/files/import-github", async (req: Request, res: Response): Promise<void> => {
  try {
    const { repoUrl, targetDir, branch } = req.body as {
      repoUrl: string;
      targetDir?: string;
      branch?: string;
    };

    if (!repoUrl) {
      res.status(400).json({ error: "repoUrl is required" });
      return;
    }

    // Extract repo name
    const repoName = repoUrl
      .replace(/\.git$/, "")
      .split("/")
      .pop() ?? "repo";

    const destPath = safeJoin(
      WORKSPACE_ROOT,
      path.join(targetDir ?? "", repoName)
    );

    // Remove existing dir if present
    if (fs.existsSync(destPath)) {
      await fsp.rm(destPath, { recursive: true, force: true });
    }

    let cmd = `git clone --depth 50`;
    if (branch) cmd += ` --branch ${branch}`;
    cmd += ` "${repoUrl}" "${destPath}"`;

    const { stdout, stderr } = await execAsync(cmd, { timeout: 120_000 });

    res.json({
      success: true,
      targetDir: path.relative(WORKSPACE_ROOT, destPath),
      repoName,
      stdout,
      stderr,
    });
  } catch (err: unknown) {
    req.log.error({ err }, "GitHub import error");
    const message = err instanceof Error ? err.message : String(err);
    const stderr = (err as { stderr?: string }).stderr ?? "";
    res.status(500).json({ success: false, error: message, stderr });
  }
});

// ─── GET /files/export ────────────────────────────────────────────────────────
router.get("/files/export", async (req: Request, res: Response): Promise<void> => {
  try {
    const relativePath = (req.query["path"] as string) || "";
    const exportRoot = relativePath
      ? safeJoin(WORKSPACE_ROOT, relativePath)
      : WORKSPACE_ROOT;

    if (!fs.existsSync(exportRoot)) {
      res.status(404).json({ error: "Path not found" });
      return;
    }

    const exportName = path.basename(exportRoot) || "workspace";
    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${exportName}.zip"`
    );

    const archive = archiver("zip", { zlib: { level: 6 } });
    archive.on("error", (err) => {
      req.log.error({ err }, "Archiver error");
    });
    archive.pipe(res);

    const stat = await fsp.stat(exportRoot);
    if (stat.isFile()) {
      archive.file(exportRoot, { name: path.basename(exportRoot) });
    } else {
      // Walk directory, skip blacklisted names
      const addDir = async (dirPath: string, archivePath: string) => {
        const entries = await fsp.readdir(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (shouldSkip(entry.name)) continue;
          const fullPath = path.join(dirPath, entry.name);
          const arcPath = path.join(archivePath, entry.name);
          if (entry.isDirectory()) {
            await addDir(fullPath, arcPath);
          } else {
            archive.file(fullPath, { name: arcPath });
          }
        }
      };
      await addDir(exportRoot, "");
    }

    await archive.finalize();
  } catch (err) {
    req.log.error({ err }, "Export error");
    if (!res.headersSent) {
      res.status(500).json({ error: String(err) });
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//   GitHub token management (server-side only, never returned to client in full)
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL_DIR = path.join(WORKSPACE_ROOT, ".local");
const TOKEN_FILE = path.join(LOCAL_DIR, "github_token.json");

async function readToken(): Promise<string | null> {
  try {
    const data = JSON.parse(await fsp.readFile(TOKEN_FILE, "utf-8"));
    return data.token ?? null;
  } catch {
    return null;
  }
}

async function writeToken(token: string): Promise<void> {
  await fsp.mkdir(LOCAL_DIR, { recursive: true });
  await fsp.writeFile(TOKEN_FILE, JSON.stringify({ token }), "utf-8");
}

// Build authenticated remote URL
function authUrl(repoUrl: string, token: string): string {
  try {
    const u = new URL(repoUrl.endsWith(".git") ? repoUrl : repoUrl + ".git");
    u.username = token;
    u.password = "x-oauth-basic";
    return u.toString();
  } catch {
    return repoUrl;
  }
}

// ─── POST /files/git-token ────────────────────────────────────────────────────
router.post("/files/git-token", async (req: Request, res: Response): Promise<void> => {
  try {
    const { token } = req.body as { token: string };
    if (!token) {
      res.status(400).json({ error: "token is required" });
      return;
    }
    await writeToken(token.trim());
    res.json({ success: true, masked: `****${token.trim().slice(-4)}` });
  } catch (err) {
    req.log.error({ err }, "Save token error");
    res.status(500).json({ error: String(err) });
  }
});

// ─── DELETE /files/git-token ─────────────────────────────────────────────────
router.delete("/files/git-token", async (_req: Request, res: Response): Promise<void> => {
  try {
    await fsp.unlink(TOKEN_FILE).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// ─── GET /files/git-token/status ─────────────────────────────────────────────
router.get("/files/git-token/status", async (_req: Request, res: Response): Promise<void> => {
  const token = await readToken();
  if (token) {
    res.json({ set: true, masked: `****${token.slice(-4)}` });
  } else {
    res.json({ set: false, masked: null });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//   Git operations
// ─────────────────────────────────────────────────────────────────────────────

// ─── GET /files/git-status ────────────────────────────────────────────────────
router.get("/files/git-status", async (req: Request, res: Response): Promise<void> => {
  try {
    const relativePath = (req.query["path"] as string) || "";
    const dir = relativePath ? safeJoin(WORKSPACE_ROOT, relativePath) : WORKSPACE_ROOT;

    if (!fs.existsSync(dir)) {
      res.status(404).json({ error: "Directory not found" });
      return;
    }

    // Check if git repo
    try {
      await execAsync("git rev-parse --git-dir", { cwd: dir, timeout: 10_000 });
    } catch {
      res.json({ isRepo: false, branch: null, status: null, remote: null });
      return;
    }

    const [branchRes, statusRes, remoteRes] = await Promise.allSettled([
      execAsync("git branch --show-current", { cwd: dir, timeout: 10_000 }),
      execAsync("git status --short", { cwd: dir, timeout: 10_000 }),
      execAsync("git remote get-url origin", { cwd: dir, timeout: 10_000 }),
    ]);

    res.json({
      isRepo: true,
      branch: branchRes.status === "fulfilled" ? branchRes.value.stdout.trim() : null,
      status: statusRes.status === "fulfilled" ? statusRes.value.stdout : null,
      remote: remoteRes.status === "fulfilled" ? remoteRes.value.stdout.trim() : null,
    });
  } catch (err) {
    req.log.error({ err }, "Git status error");
    res.status(500).json({ error: String(err) });
  }
});

// ─── POST /files/git-pull ─────────────────────────────────────────────────────
router.post("/files/git-pull", async (req: Request, res: Response): Promise<void> => {
  try {
    const { path: relativePath } = req.body as { path?: string };
    const dir = relativePath ? safeJoin(WORKSPACE_ROOT, relativePath) : WORKSPACE_ROOT;

    if (!fs.existsSync(dir)) {
      res.status(404).json({ success: false, error: "Directory not found" });
      return;
    }

    const token = await readToken();

    // If token present, update remote to authenticated URL first
    if (token) {
      try {
        const { stdout: remoteUrl } = await execAsync(
          "git remote get-url origin",
          { cwd: dir, timeout: 10_000 }
        );
        const authenticatedUrl = authUrl(remoteUrl.trim(), token);
        await execAsync(
          `git remote set-url origin "${authenticatedUrl}"`,
          { cwd: dir, timeout: 10_000 }
        );
      } catch {
        // No remote or other error — proceed anyway
      }
    }

    const { stdout, stderr } = await execAsync(
      "git pull --rebase=false",
      { cwd: dir, timeout: 120_000 }
    );

    res.json({ success: true, stdout, stderr });
  } catch (err: unknown) {
    req.log.error({ err }, "Git pull error");
    const stderr = (err as { stderr?: string }).stderr ?? "";
    res.status(500).json({ success: false, error: String(err), stderr });
  }
});

// ─── POST /files/git-push ─────────────────────────────────────────────────────
router.post("/files/git-push", async (req: Request, res: Response): Promise<void> => {
  try {
    const {
      path: relativePath,
      message,
      branch,
      addAll = true,
    } = req.body as {
      path?: string;
      message?: string;
      branch?: string;
      addAll?: boolean;
    };

    const dir = relativePath ? safeJoin(WORKSPACE_ROOT, relativePath) : WORKSPACE_ROOT;

    if (!fs.existsSync(dir)) {
      res.status(404).json({ success: false, error: "Directory not found" });
      return;
    }

    const token = await readToken();
    const commitMsg = message?.trim() || `Update: ${new Date().toISOString()}`;

    // Set authenticated remote URL
    if (token) {
      try {
        const { stdout: remoteUrl } = await execAsync(
          "git remote get-url origin",
          { cwd: dir, timeout: 10_000 }
        );
        const authenticatedUrl = authUrl(remoteUrl.trim(), token);
        await execAsync(
          `git remote set-url origin "${authenticatedUrl}"`,
          { cwd: dir, timeout: 10_000 }
        );
      } catch {
        // No remote — push will fail with a useful error
      }
    }

    const steps: { step: string; stdout: string; stderr: string }[] = [];

    if (addAll) {
      const addResult = await execAsync("git add -A", { cwd: dir, timeout: 30_000 });
      steps.push({ step: "git add -A", stdout: addResult.stdout, stderr: addResult.stderr });
    }

    // Check if there's anything to commit
    const { stdout: diffStat } = await execAsync(
      "git diff --cached --name-only",
      { cwd: dir, timeout: 10_000 }
    );

    if (diffStat.trim()) {
      const commitResult = await execAsync(
        `git commit -m "${commitMsg.replace(/"/g, '\\"')}"`,
        { cwd: dir, timeout: 30_000 }
      );
      steps.push({ step: "git commit", stdout: commitResult.stdout, stderr: commitResult.stderr });
    } else {
      steps.push({ step: "git commit", stdout: "Nothing to commit, working tree clean", stderr: "" });
    }

    const pushBranch = branch || "";
    const pushCmd = pushBranch
      ? `git push origin ${pushBranch}`
      : "git push";
    const pushResult = await execAsync(pushCmd, { cwd: dir, timeout: 120_000 });
    steps.push({ step: pushCmd, stdout: pushResult.stdout, stderr: pushResult.stderr });

    res.json({ success: true, steps });
  } catch (err: unknown) {
    req.log.error({ err }, "Git push error");
    const stderr = (err as { stderr?: string }).stderr ?? "";
    res.status(500).json({ success: false, error: String(err), stderr });
  }
});

// ─── POST /files/git-init ─────────────────────────────────────────────────────
router.post("/files/git-init", async (req: Request, res: Response): Promise<void> => {
  try {
    const { path: relativePath, remoteUrl, branch } = req.body as {
      path?: string;
      remoteUrl?: string;
      branch?: string;
    };

    const dir = relativePath ? safeJoin(WORKSPACE_ROOT, relativePath) : WORKSPACE_ROOT;
    await fsp.mkdir(dir, { recursive: true });

    const { stdout: initOut, stderr: initErr } = await execAsync(
      "git init",
      { cwd: dir, timeout: 15_000 }
    );

    const steps: { step: string; stdout: string; stderr: string }[] = [
      { step: "git init", stdout: initOut, stderr: initErr },
    ];

    if (branch) {
      try {
        const r = await execAsync(`git checkout -b "${branch}"`, { cwd: dir, timeout: 10_000 });
        steps.push({ step: `git checkout -b ${branch}`, stdout: r.stdout, stderr: r.stderr });
      } catch (e) {
        steps.push({ step: `git checkout -b ${branch}`, stdout: "", stderr: String(e) });
      }
    }

    if (remoteUrl) {
      const token = await readToken();
      const finalUrl = token ? authUrl(remoteUrl.trim(), token) : remoteUrl.trim();
      const r = await execAsync(`git remote add origin "${finalUrl}"`, { cwd: dir, timeout: 10_000 });
      steps.push({ step: "git remote add origin", stdout: r.stdout, stderr: r.stderr });
    }

    res.json({ success: true, steps });
  } catch (err: unknown) {
    req.log.error({ err }, "Git init error");
    const stderr = (err as { stderr?: string }).stderr ?? "";
    res.status(500).json({ success: false, error: String(err), stderr });
  }
});

export default router;
