"""
Vesper Autonomous Coding Agent

Works exactly like a senior engineer:
1. Plans first, then codes
2. Installs dependencies before running
3. Reads files back after writing to verify
4. Runs code, reads output carefully, fixes errors immediately
5. Tests every endpoint / feature before declaring done
6. Only says TASK_COMPLETE after personal verification

Tool call format:
<tool>{"name": "tool_name", "params": {...}}</tool>

When complete:
TASK_COMPLETE: <one-line summary of what was built and verified>
"""
import json
import re
import os
import shutil
import socket
import signal
import subprocess
import time
import logging
import base64
import urllib.request
import urllib.error
import tempfile
from typing import Optional
from pathlib import Path

import requests as _requests

from playwright_utils import send_prompt, session_exists
from file_manager import get_language
from terminal_manager import exec_command, get_cwd, WORKSPACE_ROOT
from config import FALLBACK_ORDER, set_active_model

logger = logging.getLogger(__name__)

MAX_STEPS = 25
TOOL_PATTERN = re.compile(r"<tool>(.*?)</tool>", re.DOTALL)
COMPLETE_PATTERN = re.compile(
    r"TASK[_ ]COMPLETE[:\s]+(.+)",
    re.IGNORECASE | re.DOTALL,
)

# ── Alternative tool-call formats some models produce ────────────────────────
_TOOL_NAMES_RE = (
    "execute|background_exec|kill_process|write_file|read_file|"
    "create_dir|delete|list_dir|check_port|http_get|http_post|"
    "screenshot_url|sleep|install_packages|patch_file|"
    "web_search|web_scrape"
)
ALT_TOOL_RE = re.compile(
    rf"<({_TOOL_NAMES_RE})>(.*?)(?:</(?:{_TOOL_NAMES_RE})>|(?=<(?:{_TOOL_NAMES_RE})>)|$)",
    re.DOTALL | re.IGNORECASE,
)
ALT_PARAM_RE = re.compile(
    r"<parameter(?:=(\w+))?>(.*?)</parameter>",
    re.DOTALL | re.IGNORECASE,
)


def _try_parse_alt_tool(text: str) -> list[dict]:
    """Parse alternative tool-call formats some LLMs emit."""
    results = []
    for m in ALT_TOOL_RE.finditer(text):
        tool_name = m.group(1).lower()
        body = m.group(2) or ""
        params: dict = {}
        for pm in ALT_PARAM_RE.finditer(body):
            key = (pm.group(1) or "value").strip()
            val = pm.group(2).strip()
            params[key] = val
        if not params:
            for attr_m in re.finditer(r'(\w+)=["\']([^"\']*)["\']', body):
                params[attr_m.group(1)] = attr_m.group(2)
        if params:
            results.append({"name": tool_name, "params": params})
    return results


def _trim_conversation(conv: str, max_chars: int = 40_000) -> str:
    """Remove oldest tool result blocks to stay within context window."""
    if len(conv) <= max_chars:
        return conv
    head = conv[:3000]
    tail = conv[-(max_chars - 3500):]
    return head + "\n\n[...earlier history trimmed to fit context window...]\n\n" + tail


SCREENSHOT_DIR = Path(tempfile.gettempdir()) / "agent_screenshots"
SCREENSHOT_DIR.mkdir(exist_ok=True)

_background_processes: dict[str, subprocess.Popen] = {}

RESEARCH_SCHOLAR_PROMPT = """You are Vesper Research Scholar — Vesper's elite autonomous academic and technical research agent.

You specialize in deep, rigorous, publication-quality research and professional academic/technical writing.

Your capabilities:
- Conduct extremely detailed, high-quality research on any topic
- Synthesize complex information with critical analysis
- Produce full academic-standard documents (research papers, literature reviews, technical reports, theses, whitepapers, market analysis, etc.)
- Automatically generate perfectly formatted exports (Markdown, Microsoft Word .docx, PDF, HTML, or LaTeX)

Always start every response with: **Research Scholar Mode Activated**

══════ STRICT WORKFLOW ══════
1. RESEARCH PLANNING — Create a detailed research plan, break the topic into logical sections, show the proposed document structure.
2. DEEP RESEARCH & WRITING — Perform thorough research using your full knowledge. Write in formal, high-quality academic style. Use proper headings, critical analysis, balanced arguments, and insightful conclusions. Include in-text citations and a full References section (APA 7th by default, or APA/MLA/IEEE/Harvard/Chicago as requested).
3. DOCUMENT CREATION IN WORKSPACE — Automatically create a project folder: research/[topic-name]/
   - Save the full document as main.md (clean Markdown)
   - Create: references.bib, README.md
4. EXPORT & FORMATTING — After the draft, automatically generate:
   - Microsoft Word (.docx) — formatted with headings, TOC, page numbers, professional styling (use python-docx)
   - PDF — publication-ready (use weasyprint or pandoc if available)
   - Offer LaTeX, HTML, EPUB on request

══════ TOOL FORMAT — use ONLY this JSON format ══════
<tool>{{"name": "TOOL_NAME", "params": {{...}}}}</tool>

TOOLS:
<tool>{{"name": "install_packages", "params": {{"packages": ["python-docx", "markdown"], "manager": "pip"}}}}</tool>
<tool>{{"name": "execute",          "params": {{"command": "python3 export.py", "timeout": 30}}}}</tool>
<tool>{{"name": "write_file",       "params": {{"path": "research/topic/main.md", "content": "FULL CONTENT"}}}}</tool>
<tool>{{"name": "read_file",        "params": {{"path": "research/topic/main.md"}}}}</tool>
<tool>{{"name": "create_dir",       "params": {{"path": "research/topic"}}}}</tool>
<tool>{{"name": "list_dir",         "params": {{"path": ".", "depth": 2}}}}</tool>

══════ PACKAGE SAFETY ══════
NEVER cause "error: externally-managed-environment". Always use .venv:
  python -m venv .venv && source .venv/bin/activate
  pip install python-docx markdown weasyprint

══════ OUTPUT RULES ══════
- Always produce clean, professional, publication-ready documents
- Maintain academic tone and rigor throughout
- Aim for thesis or peer-reviewed journal quality
- After finishing:
  "✅ Research complete. Full document saved in File Explorer at: research/[folder-name]/
   Available exports: main.docx, main.pdf, main.md
   Would you like me to open any file or make revisions?"

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin: confirm the research topic, clarify scope/depth/citation style if needed, then show your research plan.
"""

SEARCH_MASTER_PROMPT = """You are Vesper Search Master — Vesper's ultimate everything-search and deep research agent.

You are an expert at finding, verifying, synthesizing, and delivering the most relevant, up-to-date, and high-quality information from the web and other sources. You excel at "everything search": coding solutions, academic research, market analysis, technical documentation, news, tutorials, GitHub repos, papers, benchmarks, and more.

Always start every response with: **Search Master Mode Activated**

══════ STRICT WORKFLOW ══════
1. SEARCH PLANNING — Confirm the query, clarify scope (depth, recency, focus areas). Break down the query into sub-questions. Decide search strategies: general web, academic, GitHub, forums, official docs.
2. DEEP MULTI-SOURCE RESEARCH — Prioritize recent, authoritative sources (2025–2026 where possible). Verify facts across multiple sources. Extract usable code, examples, links, and data. Cross-reference for accuracy.
3. SYNTHESIS & OUTPUT — Deliver a clear, well-structured response with sections. Include direct links and citations. Highlight key findings, pros/cons, alternatives. For coding: provide working examples and caveats. For research: include summaries suitable for academic use.
4. EXPORT & WORKSPACE — Save the full research report under: search/[query-slug]/
   - search_report.md (clean Markdown)
   - search_report.docx (professional layout with headings and TOC, use python-docx)
   - search_report.pdf (publication-ready, use weasyprint or pandoc)

══════ STYLE & QUALITY RULES ══════
- Be accurate, objective, and transparent about source quality
- Always cite sources clearly (with links)
- For coding-related searches: include version info, compatibility notes, and alternatives
- Keep responses scannable with bullet points, tables, and code blocks
- End with:
  "✅ Search complete. Full report saved in Explorer at: search/[folder-name].
   Available: search_report.md, search_report.docx, search_report.pdf
   Would you like me to refine this, export differently, or pass it to another agent (e.g., Research Scholar or Orchestrator)?"

You can work standalone or collaborate with other Vesper agents. When the user wants to turn search results into code, a paper, or documentation, offer to hand off to the appropriate agent.

══════ TOOL FORMAT — use ONLY this JSON format ══════
<tool>{{"name": "TOOL_NAME", "params": {{...}}}}</tool>

TOOLS:
<tool>{{"name": "install_packages", "params": {{"packages": ["python-docx", "requests"], "manager": "pip"}}}}</tool>
<tool>{{"name": "execute",          "params": {{"command": "python3 export.py", "timeout": 30}}}}</tool>
<tool>{{"name": "write_file",       "params": {{"path": "search/topic/search_report.md", "content": "FULL CONTENT"}}}}</tool>
<tool>{{"name": "read_file",        "params": {{"path": "search/topic/search_report.md"}}}}</tool>
<tool>{{"name": "create_dir",       "params": {{"path": "search/topic"}}}}</tool>
<tool>{{"name": "list_dir",         "params": {{"path": ".", "depth": 2}}}}</tool>

══════ PACKAGE SAFETY ══════
NEVER cause "error: externally-managed-environment". Always use .venv:
  python -m venv .venv && source .venv/bin/activate
  pip install python-docx requests markdown weasyprint

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin: confirm the search query and scope, then show your search strategy.
"""

ORCHESTRATOR_PROMPT = """You are Vesper Orchestrator — the central, most powerful all-in-one AI agent in Vesper.

You intelligently combine the capabilities of multiple specialized agents:
- Autonomous Builder
- System Architect
- Code Surgeon (Refactoring)
- Test Guardian
- Bug Hunter
- Research Scholar
- Search Master
- Docs Weaver

You act as the team leader that decides which skills to use and in what order for any given task.

Always start every response with this exact structure:

**Vesper Orchestrator Activated**

**Task Analysis:**
[Brief understanding of what the user wants]

**Strategy & Roles:**
1. System Architect → ...
2. Search Master (if research needed) → ...
3. Autonomous Builder → ...
4. Test Guardian → ...
5. Code Surgeon / Bug Hunter → ...
6. Docs Weaver → ...

**Workspace:**
Creating/opening project folder: `[project-name]`

**Execution Steps:**
[Numbered list of actions you will take]

Then proceed to execute step by step.

══════ INTELLIGENT ROLE SWITCHING ══════
Seamlessly switch between roles during a single task:
- **System Architect** → High-level planning and structure
- **Autonomous Builder** → Create files, install deps, implement features
- **Code Surgeon** → Refactor and improve code quality
- **Test Guardian** → Write and run tests
- **Bug Hunter** → Debug and fix errors
- **Search Master** → Perform deep research when needed
- **Research Scholar** → Deep academic/technical writing
- **Docs Weaver** → Generate documentation and exports

══════ PYTHON PACKAGE INSTALLATION (follow strictly every time) ══════
Checking virtual environment status before any package installation...

Running inside Vesper on Replit (Nix-based). NEVER cause "error: externally-managed-environment" or modify /nix/store.

RULES:
✦ Virtual environments are managed AUTOMATICALLY — the install_packages tool
  creates and activates a .venv for you before every pip install. You do NOT
  need to manually run python -m venv or source activate. Just call:
    install_packages({{"packages": ["flask"]}})
  and the venv will be created if missing, then pip will install inside it.
✦ If you run Python code via execute, the .venv is also auto-activated so
  `python` resolves to the venv interpreter (packages are importable).
✦ You may still manually inspect or create the venv if needed:
    python -m venv .venv && source .venv/bin/activate
  But this is rarely necessary — install_packages handles it for you.
✦ NEVER use --break-system-packages, --user, or sudo.
✦ After installing, update pyproject.toml or requirements.txt automatically.
✦ Verify with: python -c "import package_name"
When installing: always report "Created/activated .venv and installed packages safely."

══════ PROJECT WORKSPACE ══════
Every task creates or opens a clean project folder visible in the File Explorer.
Automatically create: pyproject.toml, requirements.txt, .gitignore, README.md

══════ TOOL FORMAT — use ONLY this JSON format ══════
<tool>{{"name": "TOOL_NAME", "params": {{...}}}}</tool>

TOOLS:
<tool>{{"name": "install_packages", "params": {{"packages": ["flask", "requests"], "manager": "pip"}}}}</tool>   ← manager: pip|npm|pnpm
<tool>{{"name": "execute",          "params": {{"command": "python3 app.py", "timeout": 30}}}}</tool>
<tool>{{"name": "background_exec",  "params": {{"command": "python3 server.py", "name": "srv"}}}}</tool>
<tool>{{"name": "kill_process",     "params": {{"name": "srv"}}}}</tool>
<tool>{{"name": "write_file",       "params": {{"path": "src/app.py", "content": "FULL CONTENT HERE"}}}}</tool>
<tool>{{"name": "patch_file",       "params": {{"path": "app.py", "content": "\\n# appended section"}}}}</tool>
<tool>{{"name": "read_file",        "params": {{"path": "app.py"}}}}</tool>
<tool>{{"name": "create_dir",       "params": {{"path": "src/utils"}}}}</tool>
<tool>{{"name": "delete",           "params": {{"path": "old.py"}}}}</tool>
<tool>{{"name": "list_dir",         "params": {{"path": ".", "depth": 2}}}}</tool>
<tool>{{"name": "check_port",       "params": {{"port": 5000, "retries": 5, "wait_seconds": 1}}}}</tool>
<tool>{{"name": "http_get",         "params": {{"url": "http://localhost:5000/api/ping"}}}}</tool>
<tool>{{"name": "http_post",        "params": {{"url": "http://localhost:5000/items", "body": {{"key": "val"}}}}}}</tool>
<tool>{{"name": "screenshot_url",   "params": {{"url": "http://localhost:5000", "wait_ms": 1500}}}}</tool>
<tool>{{"name": "web_search",      "params": {{"query": "Python async patterns", "num_results": 8}}}}</tool>
<tool>{{"name": "web_scrape",      "params": {{"url": "https://docs.python.org/3/", "selector": "h2", "dynamic": false}}}}</tool>
<tool>{{"name": "sleep",            "params": {{"seconds": 2}}}}</tool>

══════ STRICT EXECUTION RULES ══════
✦ INSTALL FIRST — run install_packages before any import that could fail.
✦ COMPLETE FILES — write_file must contain the entire file. No "...", no "# rest here".
✦ READ BACK — after every write_file, call read_file to confirm disk content.
✦ ALL ERRORS ARE BLOCKING — never move forward with red output. Diagnose → fix → retest.
✦ TEST EVERY FEATURE — for APIs: http_get/http_post every route. For web: screenshot_url.
✦ PORTS 5000–5009 — use these for servers. Kill stale instances before relaunching.

══════ DONE CONDITION ══════
Emit TASK_COMPLETE only when ALL of the following are true:
  ✓ Every file written and confirmed with read_file
  ✓ Every server running and confirmed with check_port
  ✓ Every endpoint returning expected responses
  ✓ Zero errors or warnings in any output
  ✓ Virtual environment active and all packages importable

Final summary format:
"✅ Task completed successfully by Vesper Orchestrator.

Project saved in File Explorer at: [folder-path]
Virtual environment ready (.venv)
Files created/updated: [list main files]

Available actions:
- Open any file
- Run the project
- Export documentation
- Continue development
- Switch to another agent mode

What would you like to do next?"

Format: TASK_COMPLETE: <what was built> | <files created> | <tests that passed>

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin: map the project with list_dir, then state your role sequence and numbered plan.
"""

DOCS_WEAVER_PROMPT = """You are Vesper Docs Weaver — Vesper's specialist technical documentation agent.

You create beautiful, structured, comprehensive technical documentation from code, APIs, and project descriptions.

Always start every response with: **Docs Weaver Mode Activated**

══════ CAPABILITIES ══════
- Professional README files with badges, installation guides, quick-start, and examples
- Full API documentation (REST endpoints, parameters, response schemas, examples)
- Step-by-step tutorials, how-to guides, and onboarding docs
- Inline code comments, docstrings (Python, JSDoc, TSDoc)
- Architecture diagrams using Mermaid (flowcharts, sequence, ERD)
- Changelogs, migration guides, contributing guides

══════ STRICT WORKFLOW ══════
1. AUDIT — Read all relevant source files with read_file and list_dir to understand the project.
2. STRUCTURE — Plan the documentation structure. Show the user your outline before writing.
3. WRITE — Produce clean, professional, developer-friendly documentation.
4. SAVE — Write all docs to the appropriate paths (README.md, docs/, etc.).
5. VERIFY — Confirm all files exist and read them back to ensure correctness.

══════ TOOL FORMAT — use ONLY this JSON format ══════
<tool>{{"name": "TOOL_NAME", "params": {{...}}}}</tool>

TOOLS:
<tool>{{"name": "read_file",  "params": {{"path": "src/main.py"}}}}</tool>
<tool>{{"name": "write_file", "params": {{"path": "README.md", "content": "FULL CONTENT"}}}}</tool>
<tool>{{"name": "create_dir", "params": {{"path": "docs"}}}}</tool>
<tool>{{"name": "list_dir",   "params": {{"path": ".", "depth": 2}}}}</tool>
<tool>{{"name": "execute",    "params": {{"command": "echo done", "timeout": 5}}}}</tool>

══════ OUTPUT RULES ══════
- Use clear Markdown headings, tables, and code blocks
- Include copy-paste-ready examples for every API endpoint and function
- Keep language precise, concise, and developer-friendly
- End with: "✅ Documentation complete. Files saved in Explorer."

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin: scan the project structure, then confirm your documentation plan before writing.
"""

CODE_SURGEON_PROMPT = """You are Vesper Code Surgeon — Vesper's elite code refactoring and optimization specialist.

You perform surgical, precise improvements to existing code — improving quality, readability, and performance without breaking functionality.

Always start every response with: **Code Surgeon Mode Activated**

══════ CAPABILITIES ══════
- Identify and eliminate code smells, anti-patterns, and dead code
- Refactor for SOLID principles, DRY, and clean architecture
- Add TypeScript / Python type annotations and strict typing
- Optimize performance (algorithmic complexity, memory, I/O)
- Apply design patterns where they genuinely improve clarity
- Write or improve unit/integration tests
- Improve error handling and logging
- Modernize legacy code to current language standards

══════ STRICT WORKFLOW ══════
1. DIAGNOSIS — Read all target files. Identify every issue with severity (Critical / Major / Minor).
2. SURGERY PLAN — Present a numbered list of changes. Wait for user confirmation before proceeding.
3. OPERATE — Apply changes methodically. One concern at a time. Never break existing functionality.
4. VERIFY — Run tests if they exist. Check that the code still runs correctly.
5. REPORT — Summarize every change made and the improvement achieved.

══════ TOOL FORMAT — use ONLY this JSON format ══════
<tool>{{"name": "TOOL_NAME", "params": {{...}}}}</tool>

TOOLS:
<tool>{{"name": "read_file",  "params": {{"path": "src/main.py"}}}}</tool>
<tool>{{"name": "patch_file", "params": {{"path": "src/main.py", "diff": "UNIFIED DIFF"}}}}</tool>
<tool>{{"name": "write_file", "params": {{"path": "src/main.py", "content": "FULL CONTENT"}}}}</tool>
<tool>{{"name": "execute",    "params": {{"command": "python -m pytest tests/", "timeout": 60}}}}</tool>
<tool>{{"name": "list_dir",   "params": {{"path": ".", "depth": 2}}}}</tool>

══════ RULES ══════
- Never rewrite a file unless you've read it first
- Preserve all existing behavior unless explicitly asked to change it
- Comment every non-obvious change with a brief explanation
- Prefer patch_file over write_file for surgical edits
- End with: "✅ Surgery complete. X issues resolved. Code quality improved."

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin: read the target files, diagnose all issues, then present your surgery plan.
"""

SYSTEM_PROMPT = """You are Vesper Agent — a world-class, fully autonomous AI software engineer that can plan, build, test, debug, and ship complete projects. You think before you act, verify everything, and never stop until the task is proven complete. Your output quality exceeds Aider and Cursor because you reason explicitly and verify relentlessly.

Always start your response with: "Planning autonomous execution..."

══════ AUTONOMOUS WORKFLOW (Plan → Build → Test → Fix Until Done) ══════
1. PLAN   — Think step-by-step and state a clear numbered plan before writing any code.
2. MAP    — list_dir to understand the project structure first.
3. BUILD  — Create or edit files. Support multiple projects in their own folders.
             Automatically create: pyproject.toml, requirements.txt, .gitignore, README.md
4. TEST   — Run tests, verify functionality, check all endpoints and outputs.
5. FIX    — Automatically debug and fix any issue until everything works.
6. REPEAT — Loop until the task is fully completed and proven working.

After completing a task, give a final summary:
"✅ Project complete. Workspace created: [folder-name]. All files visible in Explorer. Virtual environment ready."

══════ REASONING LOOP (mandatory for every action) ══════
THINK  → What is the exact goal? What do I know? What could fail?
PLAN   → Exact ordered steps: which files, which commands, which endpoints to test.
ACT    → Call one tool. Before each write, state: FILE: <path> | CHANGE: <why>.
VERIFY → Read every result critically. Success? Loop done. Failure? Diagnose and restart.

══════ PYTHON PACKAGE INSTALLATION (follow strictly every time) ══════
Checking virtual environment status before any package installation...

You are running inside Vesper on Replit (Nix-based). NEVER cause:
  "error: externally-managed-environment" or modify /nix/store.

RULES — follow strictly:
✦ Virtual environments are managed AUTOMATICALLY — the install_packages tool
  creates and activates a .venv for you before every pip install. You do NOT
  need to manually run python -m venv or source activate. Just call:
    install_packages({{"packages": ["flask"]}})
  and the venv will be created if missing, then pip will install inside it.
✦ If you run Python code via execute, the .venv is also auto-activated so
  `python` resolves to the venv interpreter (packages are importable).
✦ NEVER use --break-system-packages, --user, or sudo.
✦ NEVER touch /nix/store or run nix-env directly.
✦ After installing, update pyproject.toml or requirements.txt automatically.
✦ Verify with: python -c "import package_name"
✦ Workflow for installs:
    Step 1: Check for existing .venv
    Step 2: Create & activate if missing
    Step 3: Install inside venv
    Step 4: Verify import works
    Step 5: Update requirements.txt / pyproject.toml

══════ START PROTOCOL ══════
Before writing a single line of code:
1. list_dir({{"path": ".", "depth": 3}})  ← map the entire project
2. read_file any relevant existing files (entry point, config, package.json)
3. Write a numbered plan: what to build, files to create, packages needed

══════ TOOL FORMAT — use ONLY this JSON format ══════
<tool>{{"name": "TOOL_NAME", "params": {{...}}}}</tool>

Wrong formats are silently ignored: <write_file path=...>, ```tool ...```

TOOLS:
<tool>{{"name": "install_packages", "params": {{"packages": ["flask", "requests"], "manager": "pip"}}}}</tool>   ← manager: pip|npm|pnpm
<tool>{{"name": "execute",          "params": {{"command": "python3 app.py", "timeout": 30}}}}</tool>
<tool>{{"name": "background_exec",  "params": {{"command": "python3 server.py", "name": "srv"}}}}</tool>
<tool>{{"name": "kill_process",     "params": {{"name": "srv"}}}}</tool>
<tool>{{"name": "write_file",       "params": {{"path": "src/app.py", "content": "FULL CONTENT HERE"}}}}</tool>
<tool>{{"name": "patch_file",       "params": {{"path": "app.py", "content": "\\n# appended section"}}}}</tool>
<tool>{{"name": "read_file",        "params": {{"path": "app.py"}}}}</tool>
<tool>{{"name": "create_dir",       "params": {{"path": "src/utils"}}}}</tool>
<tool>{{"name": "delete",           "params": {{"path": "old.py"}}}}</tool>
<tool>{{"name": "list_dir",         "params": {{"path": ".", "depth": 2}}}}</tool>
<tool>{{"name": "check_port",       "params": {{"port": 5000, "retries": 5, "wait_seconds": 1}}}}</tool>
<tool>{{"name": "http_get",         "params": {{"url": "http://localhost:5000/api/ping"}}}}</tool>
<tool>{{"name": "http_post",        "params": {{"url": "http://localhost:5000/items", "body": {{"key": "val"}}}}}}</tool>
<tool>{{"name": "screenshot_url",   "params": {{"url": "http://localhost:5000", "wait_ms": 1500}}}}</tool>
<tool>{{"name": "web_search",      "params": {{"query": "Python async patterns", "num_results": 8}}}}</tool>
<tool>{{"name": "web_scrape",      "params": {{"url": "https://docs.python.org/3/", "selector": "h2", "dynamic": false}}}}</tool>
<tool>{{"name": "sleep",            "params": {{"seconds": 2}}}}</tool>

══════ STRICT EXECUTION RULES ══════
✦ INSTALL FIRST — run install_packages before any import that could fail.
✦ COMPLETE FILES — write_file must contain the entire file. No "...", no "# rest here".
✦ READ BACK — after every write_file, call read_file to confirm disk content matches intent.
✦ ALL ERRORS ARE BLOCKING — never move forward with red output. Diagnose → fix → retest.
✦ TEST EVERY FEATURE — for APIs: http_get/http_post every route. For web: screenshot_url.
✦ PORTS 5000–5009 — use these for servers. Kill stale instances before relaunching.
✦ IF UNCERTAIN — read the file first. Never guess at existing code structure.

══════ ERROR RECOVERY PLAYBOOK ══════
ImportError / ModuleNotFoundError → install_packages the missing module, retry
SyntaxError / IndentationError    → fix the exact line, read_file to confirm, retry
Port already in use               → kill_process by name, sleep 1s, background_exec again
Test returns wrong response       → read_file the handler, trace the logic, fix and retest
Process exits immediately         → read stdout/stderr, fix the crash, relaunch
externally-managed-environment    → create .venv first, activate, then install inside it

══════ DONE CONDITION ══════
Emit TASK_COMPLETE only when ALL of the following are true:
  ✓ Every file written and confirmed with read_file
  ✓ Every server running and confirmed with check_port
  ✓ Every endpoint returning expected responses (http_get/http_post)
  ✓ Zero errors or warnings in any output
  ✓ Web UIs confirmed with screenshot_url (if applicable)
  ✓ Virtual environment active and all packages importable

Format: TASK_COMPLETE: <what was built> | <files created> | <tests that passed>

WORKING DIRECTORY: {cwd}
WORKSPACE ROOT: {workspace_root}
MAX STEPS: {max_steps}

Begin: map the project with list_dir, read any relevant files, then state your numbered plan.
"""


import threading as _threading

_agent_status: dict = {
    "running": False, "task": None, "steps": [],
    "result": None, "current_action": None, "files_written": [],
}
_stop_requested: bool = False

# ── Per-agent state for multi-agent mode ──────────────────────────────────────
_thread_local   = _threading.local()
_multi_states:  dict[str, dict] = {}   # agent_id → status dict
_multi_stops:   dict[str, bool] = {}   # agent_id → stop flag
_multi_lock     = _threading.Lock()


def get_status() -> dict:
    return dict(_agent_status)


def stop_agent() -> bool:
    global _stop_requested
    if _agent_status.get("running"):
        _stop_requested = True
        return True
    return False


def get_multi_status(agent_id: str) -> dict:
    with _multi_lock:
        return dict(_multi_states.get(agent_id, {}))


def stop_multi_agent(agent_id: str) -> bool:
    with _multi_lock:
        if agent_id in _multi_states and _multi_states[agent_id].get("running"):
            _multi_stops[agent_id] = True
            return True
    return False


def list_multi_agents() -> list:
    with _multi_lock:
        return [dict(s) for s in _multi_states.values()]


def clear_multi_agent(agent_id: str) -> bool:
    with _multi_lock:
        if agent_id in _multi_states and not _multi_states[agent_id].get("running"):
            del _multi_states[agent_id]
            _multi_stops.pop(agent_id, None)
            return True
    return False


def _pick_ai(ai_id: str) -> Optional[str]:
    candidates = [ai_id] + [a for a in FALLBACK_ORDER if a != ai_id]
    for ai in candidates:
        if session_exists(ai):
            return ai
    return None


def _set_action(action: str) -> None:
    """Update the current_action field that the UI polls (single or multi-agent aware)."""
    aid = getattr(_thread_local, "agent_id", "")
    if aid:
        with _multi_lock:
            if aid in _multi_states:
                _multi_states[aid]["current_action"] = action
    else:
        _agent_status["current_action"] = action


# ─── Venv helpers ────────────────────────────────────────────────────────────

def _find_workspace_venv(cwd: str) -> Optional[str]:
    """Return the .venv/bin/python path if a venv exists at cwd, else None."""
    venv_py = Path(cwd) / ".venv" / "bin" / "python"
    return str(venv_py) if venv_py.exists() else None


def _get_venv_extra_env(cwd: str) -> dict:
    """
    Build env overrides that activate the workspace .venv.
    Sets VIRTUAL_ENV, prepends .venv/bin to PATH, and removes PYTHONHOME
    so `python` and `pip` inside shell commands resolve to venv binaries.
    """
    venv_bin = Path(cwd) / ".venv" / "bin"
    if not venv_bin.exists():
        return {}
    venv_path = str(Path(cwd) / ".venv")
    current_path = os.environ.get("PATH", "")
    return {
        "VIRTUAL_ENV": venv_path,
        "PATH": f"{venv_bin}:{current_path}",
        "PYTHONHOME": "",   # suppress any system PYTHONHOME
    }


def _ensure_workspace_venv(cwd: str, uv_path: Optional[str] = None) -> str:
    """
    Create a .venv at cwd if it does not exist (or is broken).
    Returns a human-readable status line.
    """
    venv_py = Path(cwd) / ".venv" / "bin" / "python"
    if venv_py.exists():
        return ".venv already exists"

    uv = uv_path or shutil.which("uv")
    venv_dir = str(Path(cwd) / ".venv")

    if uv:
        r = exec_command(f'"{uv}" venv "{venv_dir}"', cwd=cwd, timeout=90)
    else:
        r = exec_command(f'python3 -m venv "{venv_dir}"', cwd=cwd, timeout=120)

    if r["exitCode"] == 0:
        return f"Created .venv at {venv_dir}"
    return f"Warning: could not create .venv (exit {r['exitCode']}): {(r['stderr'] or '')[:200]}"


# ─── Tool implementations ────────────────────────────────────────────────────

def _tool_install_packages(params: dict, cwd: str) -> str:
    packages = params.get("packages", [])
    manager = params.get("manager", "pip")

    if isinstance(packages, str):
        packages = [p.strip() for p in packages.replace(",", " ").split() if p.strip()]
    if not packages:
        return 'ERROR: No packages specified. Provide a list: {"packages": ["flask", "requests"]}'

    pkg_str = " ".join(f'"{p}"' if " " in p else p for p in packages)

    if manager in ("pip", "pip3"):
        # ── Ensure a safe .venv exists before installing ──────────────────────
        uv = shutil.which("uv")
        venv_status = _ensure_workspace_venv(cwd, uv)
        logger.info("venv ensure: %s", venv_status)

        venv_pip = Path(cwd) / ".venv" / "bin" / "pip"
        venv_py  = Path(cwd) / ".venv" / "bin" / "python"

        if venv_pip.exists():
            # Direct venv pip — most reliable, no activation needed
            cmd = f'"{venv_pip}" install {pkg_str} --quiet --no-warn-script-location'
        elif uv and venv_py.exists():
            # uv pip install targeting the venv python
            cmd = f'"{uv}" pip install {pkg_str} --python "{venv_py}"'
        else:
            # Last resort: bare pip with venv env activated via PATH override
            cmd = f"pip install {pkg_str} --quiet --no-warn-script-location"

        extra_env = _get_venv_extra_env(cwd)
        res = exec_command(cmd, cwd=cwd, timeout=180, extra_env=extra_env)

    elif manager == "npm":
        cmd = f"npm install {pkg_str}"
        res = exec_command(cmd, cwd=cwd, timeout=180)

    elif manager in ("pnpm",):
        cmd = f"pnpm add {pkg_str}"
        res = exec_command(cmd, cwd=cwd, timeout=180)

    else:
        cmd = f"pip install {pkg_str} --quiet --no-warn-script-location"
        res = exec_command(cmd, cwd=cwd, timeout=180)

    out = (res["stdout"] or "").strip()
    err = (res["stderr"] or "").strip()
    combined = "\n".join(filter(None, [out, err]))[:600]

    if res["exitCode"] == 0:
        return f"✓ Installed: {', '.join(packages)} (in workspace .venv)\n{combined}".strip()
    else:
        return f"✗ Install failed (exit {res['exitCode']}):\n{combined}\nTry fixing the package names and retry."


def _tool_execute(params: dict, cwd: str) -> str:
    command = params.get("command", "")
    work_dir = params.get("cwd")
    timeout = int(params.get("timeout", 60))
    if work_dir and not os.path.isabs(work_dir):
        work_dir = os.path.join(WORKSPACE_ROOT, work_dir)
    effective_cwd = work_dir or cwd

    # Activate workspace .venv if present so `python` resolves to venv python
    extra_env = _get_venv_extra_env(effective_cwd)

    res = exec_command(command, cwd=effective_cwd, timeout=timeout, extra_env=extra_env or None)
    parts = []
    if res["stdout"]:
        parts.append(f"STDOUT:\n{res['stdout']}")
    if res["stderr"]:
        parts.append(f"STDERR:\n{res['stderr']}")
    parts.append(f"Exit code: {res['exitCode']}")
    return "\n".join(parts) if parts else "(no output)"


def _inject_venv_pth(work_dir: str) -> None:
    """Write a .pth file into the workspace venv so the workspace root is always
    on sys.path — even inside uvicorn's multiprocessing-spawned subprocess."""
    venv_dir = os.path.join(work_dir, ".venv")
    if not os.path.isdir(venv_dir):
        return
    lib_dir = os.path.join(venv_dir, "lib")
    if not os.path.isdir(lib_dir):
        return
    for entry in os.listdir(lib_dir):
        site_pkgs = os.path.join(lib_dir, entry, "site-packages")
        if os.path.isdir(site_pkgs):
            pth_file = os.path.join(site_pkgs, "_vesper_workspace.pth")
            try:
                with open(pth_file, "w") as f:
                    f.write(work_dir + "\n")
            except Exception as exc:
                logger.warning("Could not write .pth file: %s", exc)
            break


def _tool_background_exec(params: dict, cwd: str) -> str:
    command = params.get("command", "")
    name = params.get("name", command[:40])
    work_dir = params.get("cwd")
    if work_dir and not os.path.isabs(work_dir):
        work_dir = os.path.join(WORKSPACE_ROOT, work_dir)
    work_dir = work_dir or cwd

    if name in _background_processes:
        try:
            _background_processes[name].terminate()
            time.sleep(0.3)
        except Exception:
            pass

    # Inject the workspace directory into the venv's .pth file so that ALL
    # Python processes using that venv (including uvicorn's reloader subprocess)
    # can import packages from the workspace root.  PYTHONPATH alone is not
    # reliable here because Replit's sitecustomize can override sys.path before
    # PYTHONPATH entries are added.
    _inject_venv_pth(work_dir)

    # Rewrite bare `uvicorn` invocations to use the venv's Python interpreter
    # explicitly (`python3 -m uvicorn`). The `uvicorn` console script uses
    # `#!/usr/bin/env python3` which resolves to the *system* Python when called
    # directly — meaning uvicorn can't import itself or its dependencies.
    venv_python = os.path.join(work_dir, ".venv", "bin", "python3")
    if os.path.isfile(venv_python):
        import re as _re
        command = _re.sub(
            r"(?<![/\w])uvicorn\b",
            f"{venv_python} -m uvicorn",
            command,
            count=1,
        )

    proc = subprocess.Popen(
        command,
        shell=True,
        cwd=work_dir,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        preexec_fn=os.setsid,
    )
    _background_processes[name] = proc

    time.sleep(1.2)
    if proc.poll() is not None:
        out = proc.stdout.read() if proc.stdout else ""
        err = proc.stderr.read() if proc.stderr else ""
        return (
            f"Process '{name}' exited immediately (code {proc.returncode}) — it crashed.\n"
            f"STDOUT: {out[:400]}\nSTDERR: {err[:400]}\n"
            f"Fix the error and try again."
        )

    return (
        f"✓ Started '{name}' in background (PID {proc.pid}).\n"
        f"Next: use sleep({{'seconds': 2}}) then check_port to confirm it's ready, "
        f"then http_get to test an endpoint."
    )


def _tool_kill_process(params: dict, cwd: str) -> str:
    name = params.get("name", "")
    pid = params.get("pid")
    if pid:
        try:
            os.kill(int(pid), signal.SIGTERM)
            return f"Sent SIGTERM to PID {pid}"
        except Exception as e:
            return f"Error killing PID {pid}: {e}"
    if name in _background_processes:
        proc = _background_processes.pop(name)
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        except Exception:
            proc.terminate()
        return f"✓ Terminated '{name}'"
    return f"No background process named '{name}'. Running: {list(_background_processes.keys())}"


def _tool_write_file(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        return "ERROR: path is required"
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE_ROOT, path)
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(content, encoding="utf-8")
    size = len(content.encode())
    lines = content.count("\n") + 1
    rel = params.get("path", path)
    # Track written files in status (single-agent or multi-agent aware)
    aid = getattr(_thread_local, "agent_id", "")
    if aid:
        with _multi_lock:
            if aid in _multi_states:
                files = _multi_states[aid].get("files_written", [])
                if rel not in files:
                    files.append(rel)
                    _multi_states[aid]["files_written"] = files
    else:
        files = _agent_status.get("files_written", [])
        if rel not in files:
            files.append(rel)
            _agent_status["files_written"] = files
    return (
        f"✓ Written: {rel} ({lines} lines, {size} bytes)\n"
        f"→ Verify with read_file to confirm content is correct."
    )


def _tool_patch_file(params: dict, cwd: str) -> str:
    """Append content to a file."""
    path = params.get("path", "")
    content = params.get("content", "")
    if not path:
        return "ERROR: path is required"
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    p = Path(full)
    if not p.exists():
        return f"ERROR: File not found: {path}. Use write_file to create it first."
    existing = p.read_text(encoding="utf-8")
    p.write_text(existing + content, encoding="utf-8")
    lines = (existing + content).count("\n") + 1
    return f"✓ Patched (appended to): {path} — now {lines} lines total."


def _tool_read_file(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    p = Path(full)
    if not p.exists():
        return f"ERROR: File not found: {path}"
    content = p.read_text(encoding="utf-8", errors="replace")
    if len(content) > 8000:
        content = content[:8000] + "\n\n[Truncated at 8000 chars]"
    lang = get_language(path)
    lines = content.count("\n") + 1
    return f"```{lang}\n# File: {params.get('path', path)} ({lines} lines)\n{content}\n```"


def _tool_create_dir(params: dict, cwd: str) -> str:
    path = params.get("path", "")
    if not os.path.isabs(path):
        path = os.path.join(WORKSPACE_ROOT, path)
    Path(path).mkdir(parents=True, exist_ok=True)
    return f"✓ Directory created: {params.get('path')}"


def _tool_delete(params: dict, cwd: str) -> str:
    import shutil
    path = params.get("path", "")
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    p = Path(full)
    if p.is_dir():
        shutil.rmtree(full)
    elif p.is_file():
        p.unlink()
    else:
        return f"Not found: {path}"
    return f"✓ Deleted: {path}"


def _tool_list_dir(params: dict, cwd: str) -> str:
    path = params.get("path", ".")
    depth = int(params.get("depth", 2))
    if not os.path.isabs(path):
        full = os.path.join(WORKSPACE_ROOT, path)
    else:
        full = path
    if not os.path.exists(full):
        return f"Directory not found: {path}"

    def _fmt(directory: str, cur_depth: int) -> list[str]:
        lines = []
        try:
            entries = sorted(os.scandir(directory), key=lambda e: (e.is_file(), e.name))
        except PermissionError:
            return ["(permission denied)"]
        for entry in entries:
            if entry.name.startswith("."):
                continue
            indent = "  " * cur_depth
            if entry.is_dir():
                lines.append(f"{indent}{entry.name}/")
                if cur_depth < depth:
                    lines.extend(_fmt(entry.path, cur_depth + 1))
            else:
                size = entry.stat().st_size
                lines.append(f"{indent}{entry.name}  ({size}B)")
        return lines

    result = _fmt(full, 0)
    return f"{path}/\n" + "\n".join(result) if result else f"{path}/ (empty)"


def _tool_check_port(params: dict, cwd: str) -> str:
    host = params.get("host", "localhost")
    port = int(params.get("port", 8080))
    retries = int(params.get("retries", 1))
    wait_seconds = float(params.get("wait_seconds", 1.0))

    for attempt in range(retries):
        try:
            sock = socket.create_connection((host, port), timeout=2)
            sock.close()
            return f"✓ Port {port} is OPEN — server is running and accepting connections."
        except (ConnectionRefusedError, OSError):
            if attempt < retries - 1:
                time.sleep(wait_seconds)
    return (
        f"✗ Port {port} is CLOSED after {retries} attempt(s) — server not running or still starting.\n"
        f"Check background_exec output or try adding more sleep time."
    )


def _tool_http_get(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    timeout = float(params.get("timeout", 10))
    headers = params.get("headers", {})
    try:
        resp = _requests.get(url, headers=headers, timeout=timeout)
        body = resp.text
        if len(body) > 3000:
            body = body[:3000] + "\n[Truncated]"
        status_emoji = "✓" if resp.status_code < 400 else "✗"
        return (
            f"{status_emoji} HTTP GET {url}\n"
            f"Status: {resp.status_code}\n"
            f"Body:\n{body}"
        )
    except _requests.exceptions.ConnectionError:
        return f"✗ Connection refused to {url} — is the server running? Use check_port first."
    except _requests.exceptions.Timeout:
        return f"✗ Request timed out after {timeout}s — server may be overloaded or starting."
    except Exception as e:
        return f"✗ ERROR: {e}"


def _tool_http_post(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    body = params.get("body", {})
    timeout = float(params.get("timeout", 10))
    headers = params.get("headers", {})
    try:
        resp = _requests.post(url, json=body, headers=headers, timeout=timeout)
        resp_body = resp.text
        if len(resp_body) > 3000:
            resp_body = resp_body[:3000] + "\n[Truncated]"
        status_emoji = "✓" if resp.status_code < 400 else "✗"
        return (
            f"{status_emoji} HTTP POST {url}\n"
            f"Request body: {json.dumps(body)}\n"
            f"Status: {resp.status_code}\n"
            f"Response:\n{resp_body}"
        )
    except _requests.exceptions.ConnectionError:
        return f"✗ Connection refused to {url} — server not running?"
    except _requests.exceptions.Timeout:
        return f"✗ Request timed out after {timeout}s"
    except Exception as e:
        return f"✗ ERROR: {e}"


def _tool_screenshot_url(params: dict, cwd: str) -> str:
    url = params.get("url", "")
    wait_ms = int(params.get("wait_ms", 1500))

    try:
        from playwright.sync_api import sync_playwright
        from config import find_chromium

        with sync_playwright() as p:
            exe = find_chromium()
            browser = p.chromium.launch(
                headless=True,
                executable_path=exe,
                args=["--no-sandbox", "--disable-setuid-sandbox",
                      "--disable-dev-shm-usage", "--disable-gpu"],
            )
            page = browser.new_page(viewport={"width": 1280, "height": 720})
            try:
                response = page.goto(url, wait_until="networkidle", timeout=20000)
                status = response.status if response else 0
                if wait_ms > 0:
                    page.wait_for_timeout(wait_ms)
                title = page.title()
                visible_text = page.evaluate(
                    "() => (document.body ? document.body.innerText : '').slice(0, 3000)"
                )
                screenshot_bytes = page.screenshot(full_page=False)
                fname = f"screenshot_{int(time.time()*1000)}.png"
                fpath = SCREENSHOT_DIR / fname
                fpath.write_bytes(screenshot_bytes)

                status_emoji = "✓" if status < 400 else "✗"
                result = (
                    f"{status_emoji} Screenshot: {url}\n"
                    f"HTTP Status: {status} | Page Title: {title}\n"
                    f"Screenshot API path: /api/agent/screenshot/{fname}\n\n"
                    f"VISIBLE CONTENT:\n{visible_text}"
                )
                if status >= 400:
                    result += f"\n\n⚠ HTTP {status} error returned — check server logs."
                return result
            except Exception as e:
                return f"✗ ERROR loading {url}: {e}"
            finally:
                browser.close()
    except Exception as e:
        return f"✗ ERROR with browser: {e}"


def _tool_sleep(params: dict, cwd: str) -> str:
    seconds = float(params.get("seconds", 2))
    seconds = min(seconds, 30)
    time.sleep(seconds)
    return f"✓ Waited {seconds:.1f}s"


def _tool_web_scrape(params: dict, cwd: str) -> str:
    """
    Scrape a URL and return its text content, links, and optionally selected elements.

    Params:
        url      (str, required)  - Full URL to scrape
        selector (str, optional)  - CSS selector to extract specific elements
        dynamic  (bool, optional) - Use headless browser for JS-heavy pages (default false)
    """
    url = params.get("url", "").strip()
    if not url:
        return "ERROR: 'url' parameter is required"
    if not url.startswith(("http://", "https://")):
        url = "https://" + url

    selector = params.get("selector") or None
    dynamic = bool(params.get("dynamic", False))

    try:
        from web_scraper import scrape
        return scrape(url, selector=selector, dynamic=dynamic)
    except Exception as e:
        return f"✗ ERROR scraping {url}: {e}"


def _tool_web_search(params: dict, cwd: str) -> str:
    """
    Search the web via DuckDuckGo and return top results with titles, URLs, and snippets.

    Params:
        query       (str, required) - Search query
        num_results (int, optional) - Number of results (default 8, max 10)
    """
    query = params.get("query", "").strip()
    if not query:
        return "ERROR: 'query' parameter is required"

    num_results = int(params.get("num_results", 8))

    try:
        from web_scraper import search
        return search(query, num_results=num_results)
    except Exception as e:
        return f"✗ ERROR searching '{query}': {e}"


# ─── Tool dispatcher ─────────────────────────────────────────────────────────

TOOL_MAP = {
    "install_packages": _tool_install_packages,
    "execute":          _tool_execute,
    "background_exec":  _tool_background_exec,
    "kill_process":     _tool_kill_process,
    "write_file":       _tool_write_file,
    "patch_file":       _tool_patch_file,
    "read_file":        _tool_read_file,
    "create_dir":       _tool_create_dir,
    "delete":           _tool_delete,
    "list_dir":         _tool_list_dir,
    "check_port":       _tool_check_port,
    "http_get":         _tool_http_get,
    "http_post":        _tool_http_post,
    "screenshot_url":   _tool_screenshot_url,
    "web_scrape":       _tool_web_scrape,
    "web_search":       _tool_web_search,
    "sleep":            _tool_sleep,
}


def _execute_tool(tool_name: str, params: dict, cwd: str) -> str:
    fn = TOOL_MAP.get(tool_name)
    if fn is None:
        available = ", ".join(TOOL_MAP.keys())
        return (
            f"ERROR: Unknown tool '{tool_name}'.\n"
            f"Available: {available}\n"
            f"Use the exact tool name from the AVAILABLE TOOLS list."
        )
    try:
        _set_action(f"{tool_name}: {_describe_params(tool_name, params)}")
        return fn(params, cwd)
    except Exception as e:
        logger.error(f"Tool '{tool_name}' error: {e}", exc_info=True)
        return f"ERROR in {tool_name}: {e}"


def _describe_params(tool_name: str, params: dict) -> str:
    """Human-readable summary of what a tool call is doing."""
    if tool_name in ("write_file", "read_file", "patch_file", "delete"):
        return str(params.get("path", ""))
    if tool_name in ("execute", "background_exec"):
        return str(params.get("command", ""))[:60]
    if tool_name in ("http_get", "http_post", "screenshot_url", "web_scrape"):
        return str(params.get("url", ""))
    if tool_name == "web_search":
        return str(params.get("query", ""))[:60]
    if tool_name == "install_packages":
        pkgs = params.get("packages", [])
        if isinstance(pkgs, list):
            return ", ".join(pkgs)
        return str(pkgs)
    if tool_name == "check_port":
        return f"port {params.get('port', '')}"
    if tool_name == "sleep":
        return f"{params.get('seconds', '')}s"
    return str(params)[:60]


# ─── Agent loop ───────────────────────────────────────────────────────────────

def run_agent(
    ai_id: str,
    task: str,
    working_dir: Optional[str] = None,
    max_steps: int = MAX_STEPS,
    model_id: Optional[str] = None,
    agent_type: str = "builder",
    agent_id: str = "",
) -> dict:
    global _agent_status, _stop_requested

    # ── Thread-local agent ID (used by _set_action & _tool_write_file) ────────
    _thread_local.agent_id = agent_id

    cwd = working_dir or get_cwd()
    if not os.path.isabs(cwd):
        cwd = os.path.join(WORKSPACE_ROOT, cwd)

    _initial = {
        "running": True,
        "task": task,
        "steps": [],
        "result": None,
        "current_action": "Starting up…",
        "files_written": [],
        "agent_id": agent_id,
    }

    if agent_id:
        with _multi_lock:
            _multi_states[agent_id] = dict(_initial)
            _multi_stops[agent_id] = False

        def _rst() -> dict:
            with _multi_lock:
                return dict(_multi_states.get(agent_id, {}))
        def _wst(s: dict) -> None:
            with _multi_lock:
                _multi_states[agent_id] = s
        def _upd_steps(s: list) -> None:
            with _multi_lock:
                if agent_id in _multi_states:
                    _multi_states[agent_id]["steps"] = list(s)
        def _is_stop() -> bool:
            return _multi_stops.get(agent_id, False)
    else:
        _stop_requested = False
        _agent_status = dict(_initial)

        def _rst() -> dict:
            return dict(_agent_status)
        def _wst(s: dict) -> None:
            global _agent_status
            _agent_status = s
        def _upd_steps(s: list) -> None:
            _agent_status["steps"] = list(s)
        def _is_stop() -> bool:
            return _stop_requested

    if model_id:
        set_active_model(ai_id, model_id)

    actual_ai = _pick_ai(ai_id)
    if not actual_ai:
        _wst({
            "running": False,
            "task": task,
            "steps": [],
            "result": {
                "success": False,
                "error": (
                    "No AI session found. Go to the Sessions page and connect an AI provider first. "
                    "Pollinations AI works for free — no key needed."
                ),
                "summary": None,
            },
            "current_action": None,
            "files_written": [],
            "agent_id": agent_id,
        })
        return _rst()

    steps = []
    prompt_template = (
        ORCHESTRATOR_PROMPT    if agent_type == "orchestrator"
        else RESEARCH_SCHOLAR_PROMPT if agent_type == "scholar"
        else SEARCH_MASTER_PROMPT    if agent_type == "search_master"
        else DOCS_WEAVER_PROMPT      if agent_type == "docs_weaver"
        else CODE_SURGEON_PROMPT     if agent_type == "code_surgeon"
        else SYSTEM_PROMPT
    )
    system = prompt_template.format(
        cwd=cwd,
        workspace_root=WORKSPACE_ROOT,
        max_steps=max_steps,
    )
    conversation = (
        f"{system}\n\n{'═'*50}\n"
        f"TASK: {task}\n"
        f"{'═'*50}\n\n"
        f"Start by thinking through your approach, then call your first tool:"
    )

    start_time = time.time()
    last_response: str = ""
    consecutive_no_tool = 0

    _set_action("Thinking…")

    for step_num in range(max_steps):
        step_start = time.time()

        if _is_stop():
            _wst({
                "running": False,
                "task": task,
                "steps": steps,
                "result": {
                    "success": False,
                    "summary": None,
                    "error": "Agent stopped by user.",
                    "totalElapsedMs": int((time.time() - start_time) * 1000),
                },
                "current_action": None,
                "files_written": _rst().get("files_written", []),
                "agent_id": agent_id,
            })
            return _rst()

        conversation = _trim_conversation(conversation)

        _set_action(f"Thinking (step {step_num + 1}/{max_steps})…")
        success, ai_response, error = send_prompt(actual_ai, conversation)

        if not success or not ai_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": f"AI call failed: {error}",
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
            _upd_steps(steps)
            break

        # ── Repetition guard ──────────────────────────────────────────────────
        if ai_response.strip() == last_response.strip() and last_response:
            steps.append({
                "step": step_num + 1,
                "type": "error",
                "content": (
                    "Agent is stuck in a loop — the model produced the same response twice.\n"
                    "This usually means the model isn't following the required <tool>...</tool> format.\n"
                    "Recommendation: Switch to a stronger model (Claude, GPT-4o, or Gemini 2.5 Flash)."
                ),
                "elapsedMs": int((time.time() - step_start) * 1000),
            })
            _upd_steps(steps)
            break
        last_response = ai_response

        steps.append({
            "step": step_num + 1,
            "type": "thought",
            "content": ai_response,
            "elapsedMs": int((time.time() - step_start) * 1000),
        })
        _upd_steps(steps)

        # ── Check for task completion ─────────────────────────────────────────
        complete_match = COMPLETE_PATTERN.search(ai_response)
        if complete_match:
            summary_lines = complete_match.group(1).strip().splitlines()
            summary = next((l.strip() for l in summary_lines if l.strip()), "Task complete.")
            _wst({
                "running": False,
                "task": task,
                "steps": steps,
                "result": {
                    "success": True,
                    "summary": summary,
                    "error": None,
                    "totalElapsedMs": int((time.time() - start_time) * 1000),
                },
                "current_action": None,
                "files_written": _rst().get("files_written", []),
                "agent_id": agent_id,
            })
            return _rst()

        # ── Parse tool calls ─────────────────────────────────────────────────
        primary_tool_jsons = TOOL_PATTERN.findall(ai_response)
        alt_tool_dicts: list[dict] = []
        if not primary_tool_jsons:
            alt_tool_dicts = _try_parse_alt_tool(ai_response)

        if not primary_tool_jsons and not alt_tool_dicts:
            consecutive_no_tool += 1
            steps_remaining = max_steps - step_num - 1

            if consecutive_no_tool >= 3:
                # Give up — model can't follow format
                steps.append({
                    "step": step_num + 1,
                    "type": "error",
                    "content": (
                        "Model failed to use tools 3 times in a row.\n"
                        "This model doesn't follow the required format reliably.\n"
                        "Switch to Claude, GPT-4o, or Gemini 2.5 Flash for better results."
                    ),
                    "elapsedMs": 0,
                })
                _upd_steps(steps)
                break

            # Nudge the model
            conversation += (
                f"\n\nAssistant: {ai_response}"
                f"\n\nSystem: ⚠ No tool call found and task is not complete."
                f" You MUST call a tool to make progress. Required format:\n\n"
                f'<tool>{{"name": "write_file", "params": {{"path": "hello.py", "content": "print(\'hi\')"}}}}</tool>\n\n'
                f'Or to install packages:\n'
                f'<tool>{{"name": "install_packages", "params": {{"packages": ["flask"]}}}}</tool>\n\n'
                f"When done and verified:\nTASK_COMPLETE: brief one-line summary\n\n"
                f"Steps remaining: {steps_remaining}. Call a tool NOW."
                f"\n\nAssistant:"
            )
            continue

        consecutive_no_tool = 0

        # ── Execute all tool calls in this response ───────────────────────────
        tool_results_parts: list[str] = []

        def _run_tool_call(tool_name: str, tool_params: dict) -> None:
            tool_start = time.time()
            tool_result = _execute_tool(tool_name, tool_params, cwd)
            elapsed = int((time.time() - tool_start) * 1000)
            steps.append({
                "step": step_num + 1,
                "type": "tool",
                "tool": tool_name,
                "params": tool_params,
                "result": tool_result,
                "elapsedMs": elapsed,
            })
            _upd_steps(steps)
            tool_results_parts.append(f"[Tool: {tool_name}]\n{tool_result}")

        for tool_json in primary_tool_jsons:
            try:
                tool_data = json.loads(tool_json.strip())
            except json.JSONDecodeError as e:
                err_msg = f"JSON parse error in tool call: {e}\nRaw: {tool_json[:200]}"
                steps.append({
                    "step": step_num + 1,
                    "type": "error",
                    "content": err_msg,
                    "elapsedMs": 0,
                })
                _upd_steps(steps)
                tool_results_parts.append(f"[ERROR] {err_msg}")
                continue
            _run_tool_call(tool_data.get("name", ""), tool_data.get("params", {}))

        for tool_data in alt_tool_dicts:
            _run_tool_call(tool_data.get("name", ""), tool_data.get("params", {}))

        tool_results_block = "\n\n---\n\n".join(tool_results_parts)
        steps_remaining = max_steps - step_num - 1

        conversation += (
            f"\n\nAssistant: {ai_response}"
            f"\n\nTool Results:\n{tool_results_block}"
            f"\n\nSystem: Continue working. Steps remaining: {steps_remaining}."
            f"\n• If there were errors above, fix them immediately and re-run."
            f"\n• If a file was written, read it back to verify."
            f"\n• If a server was started, check_port then http_get to test endpoints."
            f"\n• Say TASK_COMPLETE only after ALL features are verified working."
            f"\n\nAssistant:"
        )

        _set_action(f"Step {step_num + 2}/{max_steps} — Analyzing results…")

    # Ran out of steps
    _wst({
        "running": False,
        "task": task,
        "steps": steps,
        "result": {
            "success": False,
            "summary": None,
            "error": f"Reached maximum steps ({max_steps}) without completing. Try increasing Max Steps or use a smarter model.",
            "totalElapsedMs": int((time.time() - start_time) * 1000),
        },
        "current_action": None,
        "files_written": _rst().get("files_written", []),
        "agent_id": agent_id,
    })
    return _rst()


def get_screenshot_path(filename: str) -> Optional[Path]:
    """Return the full path for a screenshot file, or None if not found."""
    path = SCREENSHOT_DIR / filename
    if path.exists() and path.suffix == ".png":
        return path
    return None
