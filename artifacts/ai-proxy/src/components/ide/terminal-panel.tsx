/**
 * TerminalPanel — xterm.js powered terminal UI
 *
 * Features:
 *  - xterm.js: ANSI colours, scrollback buffer, clipboard, font rendering
 *  - Commands sent to Flask backend via POST /api/terminal/exec (persistent CWD)
 *  - Smart "Run" button: detects active file extension → right interpreter
 *  - Tab autocomplete: uses compgen to complete file/command names
 *  - Arrow Up/Down: local command history (200 entries)
 *  - Ctrl+C: interrupt running command
 *  - Ctrl+L: clear viewport
 *  - Ctrl+V / Ctrl+Shift+V: paste from clipboard
 *  - FitAddon: auto-resize to container
 *  - Theme-aware header: uses CSS variables (dark & light)
 */
import { useEffect, useRef, useCallback, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useTerminalExec, useGetTerminalCwd, getGetTerminalCwdQueryKey } from "@workspace/api-client-react";
import { TerminalSquare, Trash2, X, Play, Zap, StopCircle, Maximize2, Minimize2 } from "lucide-react";
import { useIDE } from "@/contexts/ide-context";
import { useTheme } from "@/contexts/theme-context";
import { useWorkspace } from "@/contexts/workspace-context";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

// ── ANSI helpers ─────────────────────────────────────────────────────────────
const ANSI = {
  reset:   "\x1b[0m",
  bold:    "\x1b[1m",
  dim:     "\x1b[2m",
  cyan:    "\x1b[36m",
  green:   "\x1b[32m",
  yellow:  "\x1b[33m",
  red:     "\x1b[31m",
  blue:    "\x1b[34m",
  magenta: "\x1b[35m",
  white:   "\x1b[97m",
};

/** Shorten /home/runner/workspace to ~ */
const tilde = (p: string) => p.replace(/^\/home\/runner\/workspace/, "~");

/** Shell prompt */
const makePrompt = (cwd: string) =>
  `${ANSI.bold}${ANSI.blue}${tilde(cwd)}${ANSI.reset} ${ANSI.bold}${ANSI.green}$${ANSI.reset} `;

// ── Language runner map ───────────────────────────────────────────────────────
type RunFn = (fullPath: string, baseName: string, stem: string) => string;

const RUNNERS: Record<string, RunFn> = {
  // Scripting
  py:    (p)       => `python3 "${p}"`,
  pyw:   (p)       => `python3 "${p}"`,
  js:    (p)       => `node "${p}"`,
  mjs:   (p)       => `node "${p}"`,
  cjs:   (p)       => `node "${p}"`,
  ts:    (p)       => `npx tsx "${p}"`,
  tsx:   (p)       => `npx tsx "${p}"`,
  jsx:   (p)       => `node "${p}"`,
  rb:    (p)       => `ruby "${p}"`,
  pl:    (p)       => `perl "${p}"`,
  php:   (p)       => `php "${p}"`,
  lua:   (p)       => `lua "${p}"`,
  r:     (p)       => `Rscript "${p}"`,
  R:     (p)       => `Rscript "${p}"`,
  jl:    (p)       => `julia "${p}"`,
  ex:    (p)       => `elixir "${p}"`,
  exs:   (p)       => `elixir "${p}"`,
  swift: (p)       => `swift "${p}"`,
  scala: (p)       => `scala "${p}"`,
  groovy:(p)       => `groovy "${p}"`,
  // Shell
  sh:    (p)       => `bash "${p}"`,
  bash:  (p)       => `bash "${p}"`,
  zsh:   (p)       => `zsh "${p}"`,
  fish:  (p)       => `fish "${p}"`,
  // Compiled — build+run
  go:    (p)       => `go run "${p}"`,
  java:  (p, b, s) => `cd "$(dirname "${p}")" && javac "${b}" && java "${s}"`,
  kt:    (p, _, s) => `kotlinc "${p}" -include-runtime -d /tmp/${s}.jar && java -jar /tmp/${s}.jar`,
  c:     (p, _, s) => `gcc "${p}" -o /tmp/${s} -lm && /tmp/${s}`,
  cpp:   (p, _, s) => `g++ -std=c++17 "${p}" -o /tmp/${s} -lm && /tmp/${s}`,
  cc:    (p, _, s) => `g++ -std=c++17 "${p}" -o /tmp/${s} -lm && /tmp/${s}`,
  cs:    (p, _, s) => `mcs "${p}" -out:/tmp/${s}.exe && mono /tmp/${s}.exe`,
  rs:    (p, _, s) => `rustc "${p}" -o /tmp/${s} && /tmp/${s}`,
  zig:   (p)       => `zig run "${p}"`,
  nim:   (p, _, s) => `nim compile --run "${p}"`,
  // Data / config run helpers
  sql:   (p)       => `sqlite3 < "${p}"`,
  // Markup helpers
  html:  (p)       => `python3 -m http.server 8000 --directory "$(dirname "${p}")"`,
  // Makefile / build
  mk:    ()        => `make`,
};

function getRunCommand(filePath: string): string | null {
  const baseName = filePath.split("/").pop() ?? "";
  const dotIdx   = baseName.lastIndexOf(".");
  if (dotIdx === -1) return null;
  const ext  = baseName.slice(dotIdx + 1);
  const stem = baseName.slice(0, dotIdx);
  const fn   = RUNNERS[ext];
  if (!fn) return null;
  return fn(filePath, baseName, stem);
}

// ── Quick command chips ───────────────────────────────────────────────────────
const QUICK_CMDS = [
  "ls -la",
  "pwd",
  "git status",
  "git log --oneline -10",
  "python3 --version",
  "node --version",
  "pip list | head -20",
  "npm list --depth=0",
  "df -h",
  "ps aux | head -10",
];

// ── Terminal theme ────────────────────────────────────────────────────────────
const DARK_THEME  = {
  background:        "#080810",
  foreground:        "#d4d4d8",
  black:             "#1a1a2e",
  brightBlack:       "#52526e",
  red:               "#f87171",  brightRed:         "#fca5a5",
  green:             "#4ade80",  brightGreen:       "#86efac",
  yellow:            "#facc15",  brightYellow:      "#fde047",
  blue:              "#60a5fa",  brightBlue:        "#93c5fd",
  magenta:           "#c084fc",  brightMagenta:     "#d8b4fe",
  cyan:              "#22d3ee",  brightCyan:        "#67e8f9",
  white:             "#e2e8f0",  brightWhite:       "#f8fafc",
  cursor:            "#4ade80",  cursorAccent:      "#080810",
  selectionBackground: "rgba(96,165,250,0.25)",
};

const LIGHT_THEME = {
  background:        "#f8f9fc",
  foreground:        "#1e293b",
  black:             "#334155",  brightBlack:       "#64748b",
  red:               "#dc2626",  brightRed:         "#ef4444",
  green:             "#16a34a",  brightGreen:       "#22c55e",
  yellow:            "#ca8a04",  brightYellow:      "#eab308",
  blue:              "#2563eb",  brightBlue:        "#3b82f6",
  magenta:           "#7c3aed",  brightMagenta:     "#8b5cf6",
  cyan:              "#0891b2",  brightCyan:        "#06b6d4",
  white:             "#f1f5f9",  brightWhite:       "#ffffff",
  cursor:            "#2563eb",  cursorAccent:      "#f8f9fc",
  selectionBackground: "rgba(37,99,235,0.2)",
};

// ─────────────────────────────────────────────────────────────────────────────
interface RtkSavings {
  savedChars: number;
  savingsPct: number;
  commandsTotal: number;
  commandsReduced: number;
}

export function TerminalPanel() {
  const { setShowTerminal, activeFilePath } = useIDE();
  const { isDark } = useTheme();
  const { currentWorkspace } = useWorkspace();

  const containerRef = useRef<HTMLDivElement>(null);
  const termRef      = useRef<Terminal | null>(null);
  const fitRef       = useRef<FitAddon | null>(null);

  const lineRef      = useRef("");
  const historyRef   = useRef<string[]>([]);
  const histIdxRef   = useRef(-1);
  const abortRef     = useRef<AbortController | null>(null);
  const cwdRef       = useRef("/home/runner/workspace");
  const [isExecuting, setIsExecuting] = useState(false);

  // Tab-complete candidates
  const tabCandidatesRef = useRef<string[]>([]);
  const tabPartialRef    = useRef<string>("");

  // RTK savings badge
  const [rtkSavings, setRtkSavings] = useState<RtkSavings | null>(null);

  useEffect(() => {
    const poll = async () => {
      try {
        const res = await fetch(`${BASE_URL}/api/terminal/savings`);
        if (res.ok) {
          const data = await res.json();
          if (data.commandsTotal > 0) setRtkSavings(data);
        }
      } catch {}
    };
    poll();
    const id = setInterval(poll, 8000);
    return () => clearInterval(id);
  }, []);

  const execMutation = useTerminalExec();
  const { data: cwdInfo } = useGetTerminalCwd({
    query: { queryKey: getGetTerminalCwdQueryKey(), refetchInterval: 10_000 },
  });

  // ── Boot terminal ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: isDark ? DARK_THEME : LIGHT_THEME,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      fontSize: 13,
      lineHeight: 1.4,
      letterSpacing: 0.3,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      allowProposedApi: true,
      convertEol: true,
    });

    const fit   = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.loadAddon(new SearchAddon());
    term.open(containerRef.current);
    fit.fit();
    termRef.current = term;
    fitRef.current  = fit;

    // Welcome banner
    term.writeln(`${ANSI.bold}${ANSI.magenta}  Vesper Terminal${ANSI.reset}  ${ANSI.dim}xterm.js · any language supported${ANSI.reset}`);
    term.writeln(`${ANSI.dim}  Tab autocomplete · Ctrl+C interrupt · Ctrl+L clear · ↑↓ history · Ctrl+V paste${ANSI.reset}`);
    term.writeln("");
    term.write(makePrompt(cwdRef.current));

    // ── Key handler ───────────────────────────────────────────────────────────
    term.onKey(({ key, domEvent: ev }) => {
      const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;

      // ── Ctrl combos ─────────────────────────────────────────────────────────
      if (ev.ctrlKey) {
        if (ev.key === "c") {
          abortRef.current?.abort();
          term.writeln("^C");
          lineRef.current = "";
          histIdxRef.current = -1;
          term.write(makePrompt(cwdRef.current));
          return;
        }
        if (ev.key === "l") {
          term.clear();
          lineRef.current = "";
          term.write(makePrompt(cwdRef.current));
          return;
        }
        // Ctrl+V — paste
        if (ev.key === "v") {
          navigator.clipboard?.readText().then(text => {
            if (!text) return;
            lineRef.current += text;
            term.write(text);
          }).catch(() => {});
          return;
        }
        return;
      }

      // ── Enter ───────────────────────────────────────────────────────────────
      if (ev.key === "Enter") {
        const cmd = lineRef.current.trim();
        term.writeln("");
        lineRef.current = "";
        histIdxRef.current = -1;
        tabCandidatesRef.current = [];
        if (cmd) runCommand(cmd);
        else term.write(makePrompt(cwdRef.current));
        return;
      }

      // ── Backspace ────────────────────────────────────────────────────────────
      if (ev.key === "Backspace") {
        if (lineRef.current.length > 0) {
          lineRef.current = lineRef.current.slice(0, -1);
          term.write("\b \b");
          tabCandidatesRef.current = [];
        }
        return;
      }

      // ── Tab autocomplete ─────────────────────────────────────────────────────
      if (ev.key === "Tab") {
        ev.preventDefault();
        handleTab();
        return;
      }

      // ── Arrow Up ─────────────────────────────────────────────────────────────
      if (ev.key === "ArrowUp") {
        const h = historyRef.current;
        if (!h.length) return;
        const idx = Math.min(histIdxRef.current + 1, h.length - 1);
        histIdxRef.current = idx;
        replaceCurrentLine(term, h[idx]);
        return;
      }

      // ── Arrow Down ───────────────────────────────────────────────────────────
      if (ev.key === "ArrowDown") {
        const h = historyRef.current;
        const idx = Math.max(histIdxRef.current - 1, -1);
        histIdxRef.current = idx;
        replaceCurrentLine(term, idx === -1 ? "" : h[idx]);
        return;
      }

      // ── Printable characters ─────────────────────────────────────────────────
      if (printable && key) {
        lineRef.current += key;
        term.write(key);
        tabCandidatesRef.current = [];
      }
    });

    // ── ResizeObserver ────────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(containerRef.current!);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []); // boot once

  // ── Sync theme changes to running terminal (xterm v5) ──────────────────────
  useEffect(() => {
    if (termRef.current) {
      try { termRef.current.options.theme = isDark ? DARK_THEME : LIGHT_THEME; } catch {}
    }
  }, [isDark]);

  // ── Sync CWD ───────────────────────────────────────────────────────────────
  useEffect(() => {
    if (cwdInfo?.cwd) cwdRef.current = cwdInfo.cwd;
  }, [cwdInfo]);

  // ── Helper: replace current line on terminal ────────────────────────────────
  const replaceCurrentLine = (term: Terminal, text: string) => {
    term.write(`\r${makePrompt(cwdRef.current)}${" ".repeat(lineRef.current.length)}`);
    term.write(`\r${makePrompt(cwdRef.current)}${text}`);
    lineRef.current = text;
  };

  // ── Run a command via HTTP API ──────────────────────────────────────────────
  const runCommand = useCallback(async (cmd: string, timeout = 120) => {
    const term = termRef.current;
    if (!term) return;

    if (historyRef.current[0] !== cmd)
      historyRef.current = [cmd, ...historyRef.current].slice(0, 200);

    term.write(`${ANSI.dim}  running…${ANSI.reset}\r`);
    const abort = new AbortController();
    abortRef.current = abort;
    setIsExecuting(true);

    try {
      const result = await execMutation.mutateAsync({ data: { command: cmd, timeout } });

      term.write("\r" + " ".repeat(20) + "\r");
      if (result.cwd) cwdRef.current = result.cwd;

      if (result.stdout) {
        term.write(result.stdout);
        if (!result.stdout.endsWith("\n")) term.writeln("");
      }
      if (result.stderr) {
        term.write(`${ANSI.red}${result.stderr}${ANSI.reset}`);
        if (!result.stderr.endsWith("\n")) term.writeln("");
      }
      if (result.exitCode !== 0) {
        term.writeln(`${ANSI.dim}[exit ${result.exitCode}] ${result.elapsedMs}ms${ANSI.reset}`);
      } else if (result.elapsedMs > 200) {
        term.writeln(`${ANSI.dim}[✓ ${result.elapsedMs}ms]${ANSI.reset}`);
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return;
      term.write("\r" + " ".repeat(20) + "\r");
      term.writeln(`${ANSI.red}Error: ${String(err?.message ?? err)}${ANSI.reset}`);
    } finally {
      abortRef.current = null;
      setIsExecuting(false);
    }

    term.write(makePrompt(cwdRef.current));
  }, [execMutation]);

  // ── Tab autocomplete ────────────────────────────────────────────────────────
  const handleTab = useCallback(async () => {
    const term = termRef.current;
    if (!term) return;

    const line    = lineRef.current;
    const words   = line.split(" ");
    const partial = words[words.length - 1] ?? "";
    const prefix  = words.slice(0, -1).join(" ");

    // Ask the backend for completions
    try {
      const result = await execMutation.mutateAsync({
        data: { command: `compgen -f ${JSON.stringify(partial)} 2>/dev/null | head -40`, timeout: 5 },
      });
      const matches = result.stdout.trim().split("\n").filter(Boolean).sort();

      if (matches.length === 0) {
        // No match — do nothing
      } else if (matches.length === 1) {
        // Single match — complete it (add trailing / for dirs)
        const completion = matches[0];
        // Check if it's a directory
        const statResult = await execMutation.mutateAsync({
          data: { command: `[ -d ${JSON.stringify(completion)} ] && echo DIR || echo FILE`, timeout: 5 },
        });
        const isDir = statResult.stdout.trim() === "DIR";
        const completed = isDir ? completion + "/" : completion;
        const newLine = prefix ? `${prefix} ${completed}` : completed;
        replaceCurrentLine(term, newLine);
        lineRef.current = newLine;
      } else {
        // Multiple matches — show them, then restore the prompt
        term.writeln("");
        // Find common prefix
        let common = matches[0];
        for (const m of matches.slice(1)) {
          let i = 0;
          while (i < common.length && i < m.length && common[i] === m[i]) i++;
          common = common.slice(0, i);
        }
        // Show in columns
        const cols = Math.max(1, Math.floor(term.cols / (Math.max(...matches.map(m => m.length)) + 2)));
        for (let i = 0; i < matches.length; i += cols) {
          term.writeln(matches.slice(i, i + cols).map(m => m.padEnd(Math.max(...matches.map(m => m.length)) + 2)).join(""));
        }
        // Advance to common prefix
        if (common.length > partial.length) {
          const newLine = prefix ? `${prefix} ${common}` : common;
          lineRef.current = newLine;
          term.write(makePrompt(cwdRef.current) + newLine);
        } else {
          term.write(makePrompt(cwdRef.current) + line);
        }
      }
    } catch {}
  }, [execMutation]);

  // ── Run quick chip ──────────────────────────────────────────────────────────
  const runQuick = useCallback((cmd: string) => {
    const term = termRef.current;
    if (!term) return;
    term.writeln(cmd);
    lineRef.current = "";
    runCommand(cmd);
  }, [runCommand]);

  // ── Clear ──────────────────────────────────────────────────────────────────
  const clear = useCallback(() => {
    termRef.current?.clear();
    termRef.current?.write(makePrompt(cwdRef.current));
  }, []);

  const activeFileAbsPath = activeFilePath ? `/home/runner/workspace/${activeFilePath}` : null;
  const baseRunCmd = activeFileAbsPath ? getRunCommand(activeFileAbsPath) : null;

  const runCmd = (() => {
    if (!baseRunCmd || !activeFileAbsPath) return null;
    const wsCwd = currentWorkspace
      ? `/home/runner/workspace/${currentWorkspace.relPath}`
      : `/home/runner/workspace`;
    const ext = (activeFilePath?.split(".").pop() ?? "").toLowerCase();
    if (["py", "pyw"].includes(ext)) {
      const req    = `${wsCwd}/requirements.txt`;
      const venvPy = `${wsCwd}/.venv/bin/python`;
      const install = `[ -f "${req}" ] && "${venvPy}" -m pip install -q -r "${req}" --disable-pip-version-check 2>&1 | grep -v 'already satisfied'`;
      const runWithVenv = baseRunCmd.replace(/^python3?(?=\s)/, `"${venvPy}"`);
      return `${install}\n${runWithVenv}`;
    }
    if (["js", "mjs", "cjs", "ts", "tsx"].includes(ext)) {
      const pkg = `${wsCwd}/package.json`;
      return `[ -f "${pkg}" ] && npm install --silent 2>/dev/null ; ${baseRunCmd}`;
    }
    return baseRunCmd;
  })();

  const runFile = useCallback(() => {
    if (!runCmd || !termRef.current) return;
    const displayCmd = runCmd.split("\n").pop() ?? runCmd;
    termRef.current.writeln(displayCmd);
    lineRef.current = "";
    runCommand(runCmd, 55);
  }, [runCmd, runCommand]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: isDark ? "#080810" : "#f8f9fc" }}>
      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-border bg-surface shrink-0 gap-2">
        {/* Left: icon + label + workspace + cwd + runtime info */}
        <div className="flex items-center gap-2 min-w-0">
          <TerminalSquare className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="text-emerald-500 font-bold text-xs shrink-0">TERMINAL</span>
          {currentWorkspace && (
            <span className="bg-violet-500/15 text-violet-300 text-[10px] px-2 py-0.5 rounded-full font-mono truncate max-w-[80px] sm:max-w-[120px]">
              {currentWorkspace.name}
            </span>
          )}
          <span className="hidden sm:block bg-muted text-muted-foreground text-[10px] px-2 py-0.5 rounded-full font-mono truncate max-w-[180px]">
            {tilde(cwdRef.current)}
          </span>
          {cwdInfo && (
            <span className="hidden lg:inline text-[10px] text-muted-foreground/85 font-mono shrink-0">
              {cwdInfo.python} · Node {cwdInfo.node}
            </span>
          )}
          {/* RTK token savings badge */}
          {rtkSavings && rtkSavings.savingsPct >= 10 && (
            <span
              title={`RTK token reduction: ${rtkSavings.commandsReduced}/${rtkSavings.commandsTotal} commands compressed. Saved ~${Math.round(rtkSavings.savedChars / 4).toLocaleString()} tokens this session.`}
              className="hidden md:flex items-center gap-1 bg-amber-500/10 border border-amber-500/20 text-amber-400 text-[10px] px-1.5 py-0.5 rounded-full font-mono shrink-0 cursor-default"
            >
              <Zap className="h-2.5 w-2.5" />
              -{rtkSavings.savingsPct}% tokens
            </span>
          )}
        </div>

        {/* Right: quick chips + run button + clear + close */}
        <div className="flex items-center gap-1 shrink-0">
          {/* Smart Run button — only shown when a runnable file is active */}
          {runCmd && (
            <button
              onClick={runFile}
              title={`Run: ${runCmd}`}
              className="flex items-center gap-1.5 h-7 sm:h-6 px-2.5 rounded-md
                bg-emerald-500/15 hover:bg-emerald-500/25 text-emerald-500
                text-[10px] font-bold transition-colors shrink-0 touch-manipulation"
            >
              <Play className="h-3 w-3" />
              <span className="hidden sm:inline">Run {activeFilePath?.split("/").pop()}</span>
              <span className="sm:hidden">Run</span>
            </button>
          )}

          {/* Quick command chips */}
          <div className="hidden md:flex items-center gap-1 overflow-x-auto max-w-[280px]">
            {QUICK_CMDS.slice(0, 5).map(c => (
              <button
                key={c}
                onClick={() => runQuick(c)}
                title={`Run: ${c}`}
                className="bg-muted hover:bg-border text-muted-foreground hover:text-foreground
                  text-[10px] px-2 py-0.5 rounded-full shrink-0 transition-colors font-mono"
              >
                {c}
              </button>
            ))}
          </div>

          {isExecuting && (
            <button
              onClick={() => { abortRef.current?.abort(); termRef.current?.writeln("^C"); lineRef.current = ""; setIsExecuting(false); termRef.current?.write(makePrompt(cwdRef.current)); }}
              title="Kill running process (Ctrl+C)"
              className="flex items-center gap-1.5 h-7 sm:h-6 px-2 rounded-md bg-red-500/15 hover:bg-red-500/25 text-red-400 text-[10px] font-bold transition-colors shrink-0 touch-manipulation"
            >
              <StopCircle className="h-3 w-3" />
              Kill
            </button>
          )}
          <button
            onClick={clear}
            title="Clear (Ctrl+L)"
            className="h-7 w-7 sm:h-6 sm:w-6 flex items-center justify-center rounded
              text-muted-foreground hover:text-destructive hover:bg-muted transition-colors touch-manipulation"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            onClick={() => setShowTerminal(false)}
            title="Close terminal (Ctrl+`)"
            className="h-7 w-7 sm:h-6 sm:w-6 flex items-center justify-center rounded hidden sm:flex
              text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* ── xterm.js mount ──────────────────────────────────────────────────── */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-1 py-1"
        style={{ backgroundColor: isDark ? "#080810" : "#f8f9fc" }}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
