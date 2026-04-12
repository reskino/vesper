/**
 * Project template definitions.
 *
 * Each template specifies a set of files to create inside a new workspace.
 * The `create()` helper posts them to the API and switches to the workspace.
 */

export interface TemplateFile {
  path:    string;
  content: string;
}

export interface ProjectTemplate {
  id:          string;
  name:        string;
  description: string;
  language:    "python" | "js" | "multi";
  badge:       string;         // short label shown on the card
  emoji:       string;         // icon emoji
  files:       TemplateFile[];
}

// ─── Template definitions ────────────────────────────────────────────────────

export const TEMPLATES: ProjectTemplate[] = [
  // ── Demo Project ────────────────────────────────────────────────────────────
  {
    id:          "vesper-demo",
    name:        "Vesper Demo",
    description: "Multi-file project that showcases the editor, terminal, and AI chat.",
    language:    "python",
    badge:       "Starter",
    emoji:       "✨",
    files: [
      {
        path: "main.py",
        content: `"""
Vesper Demo — entry point.

Run this file with:
    python main.py

Then ask the AI to explain, refactor, or extend the code!
"""

from utils import greet, fibonacci


def main() -> None:
    print(greet("Vesper"))
    print()

    n = 10
    print(f"First {n} Fibonacci numbers:")
    print(fibonacci(n))


if __name__ == "__main__":
    main()
`,
      },
      {
        path: "utils.py",
        content: `"""Utility helpers for the Vesper demo project."""


def greet(name: str) -> str:
    """Return a friendly greeting."""
    return f"👋  Hello from {name}!  Ready to code?"


def fibonacci(n: int) -> list[int]:
    """Return the first *n* Fibonacci numbers."""
    if n <= 0:
        return []
    seq: list[int] = [0, 1]
    while len(seq) < n:
        seq.append(seq[-1] + seq[-2])
    return seq[:n]
`,
      },
      {
        path: "README.md",
        content: `# Vesper Demo Project

Welcome to your first Vesper workspace! 🎉

## What's here

| File | Purpose |
|------|---------|
| \`main.py\` | Entry point — run this |
| \`utils.py\` | Helper functions |

## Running the project

Open the **Terminal** (Ctrl+\`) and type:

\`\`\`bash
python main.py
\`\`\`

## Try the AI

Open the **Chat** panel and ask:
- *"Explain how fibonacci() works"*
- *"Add a function that checks whether a number is prime"*
- *"Write unit tests for utils.py"*
`,
      },
    ],
  },

  // ── Python Script ────────────────────────────────────────────────────────────
  {
    id:          "python-script",
    name:        "Python Script",
    description: "Simple data-processing script with type hints and a CLI entry point.",
    language:    "python",
    badge:       "Python",
    emoji:       "🐍",
    files: [
      {
        path: "main.py",
        content: `"""Simple data-processing script.

Usage:
    python main.py [--count N]
"""

import argparse


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Data processor")
    p.add_argument("--count", type=int, default=5, help="Number of items to process")
    return p.parse_args()


def process(items: list[str]) -> list[str]:
    """Apply a trivial transform to each item."""
    return [item.strip().title() for item in items]


def main() -> None:
    args = parse_args()
    raw = [f"item {i}" for i in range(args.count)]
    result = process(raw)
    for r in result:
        print(r)


if __name__ == "__main__":
    main()
`,
      },
      {
        path: "requirements.txt",
        content: `# Add your dependencies here, e.g.:
# requests>=2.31
# pandas>=2.0
`,
      },
    ],
  },

  // ── FastAPI Backend ──────────────────────────────────────────────────────────
  {
    id:          "fastapi-backend",
    name:        "FastAPI Backend",
    description: "Production-ready async REST API with Pydantic models and auto docs.",
    language:    "python",
    badge:       "FastAPI",
    emoji:       "⚡",
    files: [
      {
        path: "main.py",
        content: `"""FastAPI backend — run with:  uvicorn main:app --reload"""

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="My API", version="0.1.0")


# ── Models ────────────────────────────────────────────────────────────────────

class Item(BaseModel):
    id:    int
    name:  str
    price: float


# In-memory store
ITEMS: dict[int, Item] = {
    1: Item(id=1, name="Widget",  price=9.99),
    2: Item(id=2, name="Gadget",  price=24.99),
}


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/")
def root():
    return {"message": "Hello from FastAPI!", "docs": "/docs"}


@app.get("/items", response_model=list[Item])
def list_items():
    return list(ITEMS.values())


@app.get("/items/{item_id}", response_model=Item)
def get_item(item_id: int):
    item = ITEMS.get(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@app.post("/items", response_model=Item, status_code=201)
def create_item(item: Item):
    if item.id in ITEMS:
        raise HTTPException(status_code=409, detail="Item already exists")
    ITEMS[item.id] = item
    return item
`,
      },
      {
        path: "requirements.txt",
        content: `fastapi>=0.110
uvicorn[standard]>=0.29
pydantic>=2.0
`,
      },
    ],
  },

  // ── Express API ──────────────────────────────────────────────────────────────
  {
    id:          "express-api",
    name:        "Express API",
    description: "Lightweight Node.js REST API with Express and JSON endpoints.",
    language:    "js",
    badge:       "Node.js",
    emoji:       "🟢",
    files: [
      {
        path: "index.js",
        content: `/**
 * Express API — run with:  node index.js
 */

const express = require("express");

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// In-memory data store
const items = [
  { id: 1, name: "Widget",  price: 9.99 },
  { id: 2, name: "Gadget",  price: 24.99 },
];

// ── Routes ────────────────────────────────────────────────────────────────────

app.get("/", (_req, res) => {
  res.json({ message: "Hello from Express!", version: "1.0.0" });
});

app.get("/items", (_req, res) => {
  res.json(items);
});

app.get("/items/:id", (req, res) => {
  const item = items.find(i => i.id === Number(req.params.id));
  if (!item) return res.status(404).json({ error: "Not found" });
  res.json(item);
});

app.post("/items", (req, res) => {
  const { name, price } = req.body;
  if (!name || price == null) {
    return res.status(400).json({ error: "name and price are required" });
  }
  const item = { id: items.length + 1, name, price: Number(price) };
  items.push(item);
  res.status(201).json(item);
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(\`Server running at http://localhost:\${PORT}\`);
});
`,
      },
      {
        path: "package.json",
        content: `{
  "name": "express-api",
  "version": "1.0.0",
  "main": "index.js",
  "scripts": {
    "start": "node index.js",
    "dev":   "node --watch index.js"
  },
  "dependencies": {
    "express": "^4.19.0"
  }
}
`,
      },
    ],
  },
];

// ─── Template lookup ─────────────────────────────────────────────────────────

export function getTemplate(id: string): ProjectTemplate | undefined {
  return TEMPLATES.find(t => t.id === id);
}

// ─── File creation helper ────────────────────────────────────────────────────

const BASE = () =>
  (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

/**
 * Write a single file at `workspaceRelPath/file.path` via the API.
 * Uses the same `writeFile` endpoint as the editor.
 */
async function writeTemplateFile(
  workspaceRelPath: string,
  file: TemplateFile,
): Promise<void> {
  const fullPath = workspaceRelPath
    ? `${workspaceRelPath}/${file.path}`
    : file.path;

  await apiFetch("/files/write", {
    method:  "POST",
    body:    JSON.stringify({ path: fullPath, content: file.content }),
  });
}

/**
 * Create all template files inside an already-created workspace.
 * Errors are surfaced so the caller can toast them.
 */
export async function scaffoldTemplate(
  workspaceRelPath: string,
  template: ProjectTemplate,
): Promise<void> {
  await Promise.all(
    template.files.map(f => writeTemplateFile(workspaceRelPath, f)),
  );
}
