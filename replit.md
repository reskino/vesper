# Vesper — AI-Native IDE & Proxy Platform

## Overview
Vesper is a full-stack, AI-native IDE and unified AI proxy platform designed to streamline interaction with multiple AI providers (ChatGPT, Claude, Grok, Gemini, etc.) through a single, VS Code-like browser interface. It features an autonomous coding agent capable of file manipulation and terminal command execution. The platform aims to provide a comprehensive environment for AI-assisted development, integrating advanced tools like a code graph visualizer, multi-agent swarm orchestration, and intelligent web scraping, all while optimizing AI token usage.

## User Preferences
Not specified.

## System Architecture
Vesper is built as a pnpm monorepo consisting of three main services:
1.  **Python AI Backend (Flask 3)**: Handles AI provider integrations, Playwright sessions, file management, and terminal operations. It uses `flask-compress` for gzip compression.
2.  **API Gateway (Express 5)**: Acts as the central entry point, implementing security features (Helmet, `express-rate-limit`), compression, and a global error handler. It correctly processes `X-Forwarded-For` headers.
3.  **Frontend (React 19/Vite 7)**: A single-page application with aggressive code-splitting for performance, lazy-loading heavy components (e.g., sidebar panels), and targeting modern `es2020` for smaller bundles.

**Core Technical Implementations & Features:**
*   **Autonomous Coding Agent**: Employs a "think → tool call → observe" loop, capable of interacting with the workspace and terminal.
*   **Per-Project Workspace System**: Each project operates in an isolated subdirectory with its own `.venv` for Python and `node_modules` for JavaScript, ensuring dependency isolation. Workspaces are managed via dedicated API endpoints for creation, listing, and dependency installation.
*   **Code Graph Visualization (Graphifyy)**: Integrates the `graphifyy` Python package to generate interactive knowledge graphs from codebases, supporting 20 languages. The frontend uses D3 for visualization, allowing users to explore code structure, cluster analysis, and suggested insights.
*   **Multi-Agent Swarm Orchestration**: Allows spawning and managing multiple AI agents concurrently, each with a specific role (e.g., `builder`, `scholar`, `search_master`, `orchestrator`) and an independent task, running in isolated daemon threads.
*   **Web Scraping (Scrapling Integration)**: Provides adaptive web scraping capabilities through Scrapling, offering fast fetching, dynamic content handling via Playwright, and a robust fallback mechanism. Agent tools `web_search` and `web_scrape` leverage this functionality.
*   **RTK Token Reduction**: Implements strategies (filtering, grouping, truncation, deduplication) to compress terminal command outputs before they reach the LLM, significantly reducing token consumption. A live badge indicates token savings.
*   **Python Virtual Environment Management**: Automatically creates and manages isolated `.venv` environments for each Python workspace, ensuring safe execution and dependency management using `uv` (preferred) or `pip`. The frontend provides UI for monitoring and managing venv health.
*   **UI/UX**:
    *   **Toast Notifications**: Uses Sonner for sleek, custom-themed toast notifications (`bottom-right`, `rounded-xl`).
    *   **Loading Indicators**: Features animated "ThinkingDots" for AI activity and a rich 10-line code-skeleton placeholder for Monaco Editor during file loading.
    *   **IDE Enhancements**: Custom Vesper Monaco theme, persisted editor preferences, Command Palette (`Ctrl+P` file search / `Ctrl+Shift+P` or `Ctrl+K` command mode) with recent-files section and fuzzy search, keyboard shortcut reference modal (`?`), activity bar, F5 run-file shortcut, auto-save after 1.5s inactivity, breadcrumb path bar, minimap toggle (persisted), tab drag-to-reorder, Escape key dismisses output panel, re-run button in output panel, enhanced status bar (selection char/line count in violet, total lines).
    *   **File Explorer**: Workspace-aware file tree with language badges, desktop search bar, folders-first alphabetical sorting at every level, explicit hidden-name filter (`.venv`, `.git`, `__pycache__`, `node_modules` hidden; `.env`/`.gitignore` visible), and dedicated panels for dependency installation.
    *   **Terminal**: Workspace name badge in header, kill-process button while commands execute, code-block copy/run buttons with prominent styling in markdown renderer.
    *   **Run-file system**: Detects server files (uvicorn/flask patterns) and runs them in the background (`&` + 6s startup capture) to avoid HTTP 504 proxy timeouts. Regular scripts get a 55s timeout. Output panel shows "● Server Running" status with clickable server URL and copy-output button.
    *   **Chat Export**: Allows exporting chat history to PDF, Word (.docx), or saving as Markdown to the workspace.

## External Dependencies
*   **AI Providers**: ChatGPT, Claude, Grok, Gemini, OpenAI API, Anthropic.
*   **Python Libraries**: flask, flask-cors, flask-sqlalchemy, playwright, openai, anthropic, gunicorn, flask-compress, python-docx, graphifyy, Scrapling (via `curl_cffi`, `playwright`).
*   **Node.js Libraries**: express, vite, react, react-query, codemirror, monaco-editor, xterm, tailwindcss, Helmet, express-rate-limit, Sonner.
*   **System Dependencies**: playwright-driver (chromium), PostgreSQL, OpenSSL, uv (Python package manager).
*   **APIs**: DuckDuckGo (for `web_search`).