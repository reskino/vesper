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

export default router;
