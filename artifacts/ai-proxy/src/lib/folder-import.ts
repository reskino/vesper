/**
 * folder-import.ts — browser-side folder import utilities.
 *
 * Supports two methods:
 *   A) <input webkitdirectory> — broad browser support (Safari, Firefox, Chrome)
 *   B) window.showDirectoryPicker() — modern API, better UX, falls back to A
 *
 * Both produce the same ImportedFileNode tree structure and context builder.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface ImportedFileNode {
  name: string;
  path: string;           // relative path from project root
  isFolder: boolean;
  content?: string;       // undefined for folders
  size?: number;          // bytes
  skipped?: boolean;      // true if binary, too large, or in a skip-dir
  children?: ImportedFileNode[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Directories that are never read (huge / irrelevant) */
const SKIP_DIRS = new Set([
  ".git", "node_modules", ".cache", "__pycache__", "dist", "build",
  ".next", ".nuxt", ".turbo", "coverage", "venv", ".venv", "env",
  ".mypy_cache", ".pytest_cache", ".tox", "target", ".gradle",
]);

/** Files whose content is always included first (highest priority for AI) */
const PRIORITY_FILES = [
  "package.json", "requirements.txt", "pyproject.toml", "go.mod",
  "Cargo.toml", "composer.json", "pom.xml", "build.gradle",
  "README.md", "readme.md", ".env.example",
  "main.py", "app.py", "server.py", "index.ts", "index.js",
  "main.ts", "main.go", "main.rs", "App.tsx", "App.jsx",
];

const MAX_FILE_BYTES   = 150_000;   // 150 KB — skip larger files
const CONTEXT_MAX_FILES = 60;       // max files included in AI context
const CONTEXT_MAX_BYTES = 400_000;  // ~400 KB total context ceiling

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function isBinary(text: string): boolean {
  // Detect binary by presence of null bytes in first 512 chars
  const sample = text.slice(0, 512);
  return sample.includes("\0");
}

async function safeReadFile(file: File): Promise<{ content: string; skipped: boolean }> {
  if (file.size > MAX_FILE_BYTES) {
    return {
      content: `[File too large: ${(file.size / 1024).toFixed(0)} KB — skipped for AI context]`,
      skipped: true,
    };
  }
  try {
    const text = await file.text();
    if (isBinary(text)) {
      return { content: "[Binary file — skipped]", skipped: true };
    }
    return { content: text, skipped: false };
  } catch {
    return { content: "[Failed to read]", skipped: true };
  }
}

function insertNode(root: ImportedFileNode, parts: string[], leaf: ImportedFileNode): void {
  // parts = ["src", "components", "Button.tsx"]  (without root name)
  let current = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const dirName = parts[i];
    if (!current.children) current.children = [];
    let dir = current.children.find(c => c.isFolder && c.name === dirName);
    if (!dir) {
      dir = { name: dirName, path: parts.slice(0, i + 1).join("/"), isFolder: true, children: [] };
      current.children.push(dir);
    }
    current = dir;
  }
  if (!current.children) current.children = [];
  current.children.push(leaf);
}

function sortTree(node: ImportedFileNode): ImportedFileNode {
  if (!node.children) return node;
  node.children.sort((a, b) => {
    if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  node.children.forEach(sortTree);
  return node;
}

// ─────────────────────────────────────────────────────────────────────────────
// Option A — <input webkitdirectory>
// ─────────────────────────────────────────────────────────────────────────────

export async function readFolderFromInput(
  fileList: FileList,
  onProgress?: (loaded: number, total: number, current: string) => void,
): Promise<ImportedFileNode> {
  const files = Array.from(fileList);
  if (files.length === 0) throw new Error("No files selected");

  // Derive root name from first file's webkitRelativePath
  const rootName = files[0].webkitRelativePath.split("/")[0] || "project";
  const root: ImportedFileNode = { name: rootName, path: "", isFolder: true, children: [] };

  let loaded = 0;
  for (const file of files) {
    loaded++;
    const relativePath = file.webkitRelativePath; // "project/src/App.tsx"
    const parts = relativePath.split("/");
    onProgress?.(loaded, files.length, parts[parts.length - 1]);

    // Skip directories in the block-list
    if (parts.some(p => SKIP_DIRS.has(p))) continue;

    // parts[0] is root name — drop it, rest is the relative path within root
    const innerParts = parts.slice(1); // ["src", "App.tsx"]
    if (innerParts.length === 0) continue;

    const { content, skipped } = await safeReadFile(file);
    const leaf: ImportedFileNode = {
      name: innerParts[innerParts.length - 1],
      path: innerParts.join("/"),
      isFolder: false,
      content,
      size: file.size,
      skipped,
    };
    insertNode(root, innerParts, leaf);
  }

  return sortTree(root);
}

// ─────────────────────────────────────────────────────────────────────────────
// Option B — File System Access API (showDirectoryPicker)
// ─────────────────────────────────────────────────────────────────────────────

export function isFSAccessSupported(): boolean {
  return typeof window !== "undefined" && "showDirectoryPicker" in window;
}

async function traverseDir(
  handle: FileSystemDirectoryHandle,
  basePath: string,
  onProgress?: (msg: string) => void,
): Promise<ImportedFileNode> {
  const node: ImportedFileNode = {
    name: handle.name,
    path: basePath,
    isFolder: true,
    children: [],
  };

  if (SKIP_DIRS.has(handle.name)) {
    node.skipped = true;
    return node;
  }

  const entries: Array<[string, FileSystemHandle]> = [];
  for await (const entry of (handle as any).values()) {
    entries.push([entry.name, entry]);
  }

  for (const [name, childHandle] of entries) {
    const childPath = basePath ? `${basePath}/${name}` : name;
    if (childHandle.kind === "directory") {
      const child = await traverseDir(childHandle as FileSystemDirectoryHandle, childPath, onProgress);
      node.children!.push(child);
    } else {
      onProgress?.(`Reading ${childPath}`);
      const file = await (childHandle as FileSystemFileHandle).getFile();
      const { content, skipped } = await safeReadFile(file);
      node.children!.push({
        name,
        path: childPath,
        isFolder: false,
        content,
        size: file.size,
        skipped,
      });
    }
  }

  return sortTree(node);
}

export async function openFolderWithPicker(
  onProgress?: (msg: string) => void,
): Promise<ImportedFileNode | null> {
  if (!isFSAccessSupported()) return null;
  try {
    const dir = await (window as any).showDirectoryPicker({ mode: "read" });
    return traverseDir(dir, "", onProgress);
  } catch (e: any) {
    if (e.name === "AbortError") return null;
    throw e;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Stats helpers
// ─────────────────────────────────────────────────────────────────────────────

export function countProjectFiles(node: ImportedFileNode): number {
  if (!node.isFolder) return node.skipped ? 0 : 1;
  return (node.children ?? []).reduce((n, c) => n + countProjectFiles(c), 0);
}

export function countTotalFiles(node: ImportedFileNode): number {
  if (!node.isFolder) return 1;
  return (node.children ?? []).reduce((n, c) => n + countTotalFiles(c), 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Context builder — converts the tree into a rich AI context string
// ─────────────────────────────────────────────────────────────────────────────

function collectFiles(node: ImportedFileNode, acc: ImportedFileNode[] = []): ImportedFileNode[] {
  if (!node.isFolder && !node.skipped && node.content) {
    acc.push(node);
  }
  for (const child of node.children ?? []) {
    collectFiles(child, acc);
  }
  return acc;
}

function treeText(node: ImportedFileNode, depth = 0): string {
  const indent = "  ".repeat(depth);
  const icon = node.isFolder ? "📁" : (node.skipped ? "⊘" : "📄");
  const sizeNote = node.size && node.size > 1024
    ? ` (${(node.size / 1024).toFixed(0)}KB${node.skipped ? " skipped" : ""})`
    : "";
  const lines = [`${indent}${icon} ${node.name}${sizeNote}`];
  for (const child of node.children ?? []) {
    lines.push(treeText(child, depth + 1));
  }
  return lines.join("\n");
}

export function buildProjectContext(root: ImportedFileNode): string {
  const allFiles = collectFiles(root);

  // Priority sort: important config/entry files first, then smallest files first
  const prioIndex = (name: string) => {
    const i = PRIORITY_FILES.indexOf(name);
    return i === -1 ? PRIORITY_FILES.length : i;
  };

  const sorted = [...allFiles].sort((a, b) => {
    const pa = prioIndex(a.name);
    const pb = prioIndex(b.name);
    if (pa !== pb) return pa - pb;
    return (a.size ?? 0) - (b.size ?? 0);
  });

  const parts: string[] = [
    `## Imported Project: "${root.name}"`,
    "",
    "### Directory Structure",
    "```",
    treeText(root),
    "```",
    "",
    "### File Contents",
  ];

  let totalBytes = 0;
  let fileCount = 0;

  for (const file of sorted) {
    if (fileCount >= CONTEXT_MAX_FILES || totalBytes >= CONTEXT_MAX_BYTES) {
      const remaining = sorted.length - fileCount;
      if (remaining > 0) {
        parts.push(`\n> [${remaining} more file${remaining > 1 ? "s" : ""} not shown to stay within context limits]`);
      }
      break;
    }

    const ext = file.name.split(".").pop() ?? "";
    const block = `\n**${file.path || file.name}**\n\`\`\`${ext}\n${file.content}\n\`\`\``;
    parts.push(block);
    totalBytes += (file.content?.length ?? 0);
    fileCount++;
  }

  return parts.join("\n");
}
