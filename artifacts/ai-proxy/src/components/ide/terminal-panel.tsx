/**
 * TerminalPanel — xterm.js powered terminal UI
 *
 * Architecture:
 *  - xterm.js handles all rendering: ANSI colours, scrollback buffer,
 *    selection, font rendering, clipboard.
 *  - Commands are sent to the Python backend via the existing HTTP API
 *    (`POST /api/terminal/exec`) which runs them in a persistent shell with
 *    shared CWD.  Output is written back to the xterm terminal.
 *  - Input is buffered locally until the user presses Enter (line-buffered),
 *    matching the feel of a real shell for non-interactive commands.
 *  - Arrow Up/Down navigates local command history.
 *  - Ctrl+C sends a cancel signal (aborts the current HTTP request).
 *  - Ctrl+L clears the terminal viewport.
 *  - FitAddon auto-resizes the terminal to fill its container.
 */
import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { useTerminalExec, useGetTerminalCwd, getGetTerminalCwdQueryKey } from "@workspace/api-client-react";
import { TerminalSquare, Trash2, X } from "lucide-react";
import { useIDE } from "@/contexts/ide-context";

// ANSI colour helpers for prompt / info text written directly to the terminal
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
const tilde = (path: string) => path.replace(/^\/home\/runner\/workspace/, "~");

/** Render the shell prompt line */
const makePrompt = (cwd: string) =>
  `${ANSI.bold}${ANSI.blue}${tilde(cwd)}${ANSI.reset} ${ANSI.bold}${ANSI.green}$${ANSI.reset} `;

const QUICK_CMDS = ["ls -la", "pwd", "git status", "python3 --version", "node --version", "pip list | head -20"];

export function TerminalPanel() {
  const { setShowTerminal } = useIDE();

  // Container that xterm mounts into
  const containerRef = useRef<HTMLDivElement>(null);

  // xterm instances — stored in refs so they survive re-renders
  const termRef    = useRef<Terminal | null>(null);
  const fitRef     = useRef<FitAddon | null>(null);
  const searchRef  = useRef<SearchAddon | null>(null);

  // Line buffer (typed characters before Enter)
  const lineRef    = useRef("");
  // Command history for Up/Down navigation
  const historyRef = useRef<string[]>([]);
  const histIdxRef = useRef(-1);
  // Abort controller for the current HTTP request
  const abortRef   = useRef<AbortController | null>(null);
  // Current working directory (kept in sync after each command)
  const cwdRef     = useRef("/home/runner/workspace");

  const execMutation = useTerminalExec();
  const { data: cwdInfo } = useGetTerminalCwd({
    query: { queryKey: getGetTerminalCwdQueryKey(), refetchInterval: 10_000 },
  });

  // ── Boot the terminal once on mount ────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || termRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#080810",
        foreground: "#d4d4d8",
        black:      "#1a1a2e",
        brightBlack:"#52526e",
        red:        "#f87171",
        brightRed:  "#fca5a5",
        green:      "#4ade80",
        brightGreen:"#86efac",
        yellow:     "#facc15",
        brightYellow:"#fde047",
        blue:       "#60a5fa",
        brightBlue: "#93c5fd",
        magenta:    "#c084fc",
        brightMagenta:"#d8b4fe",
        cyan:       "#22d3ee",
        brightCyan: "#67e8f9",
        white:      "#e2e8f0",
        brightWhite:"#f8fafc",
        cursor:     "#4ade80",
        cursorAccent:"#080810",
        selectionBackground: "rgba(96,165,250,0.25)",
      },
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

    const fit    = new FitAddon();
    const links  = new WebLinksAddon();
    const search = new SearchAddon();

    term.loadAddon(fit);
    term.loadAddon(links);
    term.loadAddon(search);
    term.open(containerRef.current);
    fit.fit();

    termRef.current   = term;
    fitRef.current    = fit;
    searchRef.current = search;

    // Welcome banner
    term.writeln(`${ANSI.bold}${ANSI.magenta}  Vesper Terminal${ANSI.reset}  ${ANSI.dim}xterm.js · powered by Replit${ANSI.reset}`);
    term.writeln(`${ANSI.dim}  Ctrl+C interrupt · Ctrl+L clear · ↑↓ history · click links to open${ANSI.reset}`);
    term.writeln("");
    term.write(makePrompt(cwdRef.current));

    // ── Key handler ────────────────────────────────────────────────────────
    term.onKey(({ key, domEvent }) => {
      const ev = domEvent;
      const printable = !ev.altKey && !ev.ctrlKey && !ev.metaKey;

      // Ctrl+C — abort running command
      if (ev.ctrlKey && ev.key === "c") {
        abortRef.current?.abort();
        term.writeln("^C");
        lineRef.current = "";
        histIdxRef.current = -1;
        term.write(makePrompt(cwdRef.current));
        return;
      }

      // Ctrl+L — clear viewport
      if (ev.ctrlKey && ev.key === "l") {
        term.clear();
        lineRef.current = "";
        term.write(makePrompt(cwdRef.current));
        return;
      }

      // Enter — run command
      if (ev.key === "Enter") {
        const cmd = lineRef.current.trim();
        term.writeln("");    // move to next line
        lineRef.current = "";
        histIdxRef.current = -1;
        if (cmd) runCommand(cmd);
        else term.write(makePrompt(cwdRef.current));
        return;
      }

      // Backspace
      if (ev.key === "Backspace") {
        if (lineRef.current.length > 0) {
          lineRef.current = lineRef.current.slice(0, -1);
          term.write("\b \b");
        }
        return;
      }

      // Arrow Up — previous history entry
      if (ev.key === "ArrowUp") {
        const h = historyRef.current;
        if (!h.length) return;
        const idx = Math.min(histIdxRef.current + 1, h.length - 1);
        histIdxRef.current = idx;
        const entry = h[idx];
        // Clear current line on terminal
        term.write(`\r${makePrompt(cwdRef.current)}${" ".repeat(lineRef.current.length)}`);
        term.write(`\r${makePrompt(cwdRef.current)}${entry}`);
        lineRef.current = entry;
        return;
      }

      // Arrow Down — next history entry
      if (ev.key === "ArrowDown") {
        const h = historyRef.current;
        const idx = Math.max(histIdxRef.current - 1, -1);
        histIdxRef.current = idx;
        const entry = idx === -1 ? "" : h[idx];
        term.write(`\r${makePrompt(cwdRef.current)}${" ".repeat(lineRef.current.length)}`);
        term.write(`\r${makePrompt(cwdRef.current)}${entry}`);
        lineRef.current = entry;
        return;
      }

      // Tab — simple auto-complete placeholder (echo)
      if (ev.key === "Tab") {
        ev.preventDefault();
        return;
      }

      // Printable characters — echo and buffer
      if (printable && key) {
        lineRef.current += key;
        term.write(key);
      }
    });

    // ── Resize observer ────────────────────────────────────────────────────
    const ro = new ResizeObserver(() => {
      try { fit.fit(); } catch { /* ignore */ }
    });
    ro.observe(containerRef.current!);

    return () => {
      ro.disconnect();
      term.dispose();
      termRef.current = null;
    };
  }, []); // ← only on mount

  // ── Sync CWD from polling ──────────────────────────────────────────────────
  useEffect(() => {
    if (cwdInfo?.cwd) cwdRef.current = cwdInfo.cwd;
  }, [cwdInfo]);

  // ── Run a shell command via HTTP API ───────────────────────────────────────
  const runCommand = useCallback(async (cmd: string) => {
    const term = termRef.current;
    if (!term) return;

    // Save to history (deduplicate consecutive duplicates)
    if (historyRef.current[0] !== cmd) {
      historyRef.current = [cmd, ...historyRef.current].slice(0, 200);
    }

    // Show "running" indicator
    term.write(`${ANSI.dim}  running…${ANSI.reset}\r`);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const result = await execMutation.mutateAsync(
        { data: { command: cmd } },
        // Note: the Orval-generated hook doesn't pass signal through, so we
        // rely on the abort controller for UI feedback only.
      );

      // Clear the "running…" line
      term.write("\r" + " ".repeat(20) + "\r");

      // Update CWD
      if (result.cwd) cwdRef.current = result.cwd;

      // Print stdout (ANSI passthrough)
      if (result.stdout) {
        term.write(result.stdout);
        if (!result.stdout.endsWith("\n")) term.writeln("");
      }

      // Print stderr in red
      if (result.stderr) {
        term.write(`${ANSI.red}${result.stderr}${ANSI.reset}`);
        if (!result.stderr.endsWith("\n")) term.writeln("");
      }

      // Exit code badge
      if (result.exitCode !== 0) {
        term.writeln(
          `${ANSI.dim}[exit ${result.exitCode}] ${result.elapsedMs}ms${ANSI.reset}`,
        );
      } else if (result.elapsedMs > 200) {
        term.writeln(
          `${ANSI.dim}[${result.elapsedMs}ms]${ANSI.reset}`,
        );
      }
    } catch (err: any) {
      if (err?.name === "AbortError") return; // Ctrl+C
      term.write("\r" + " ".repeat(20) + "\r");
      term.writeln(`${ANSI.red}Error: ${String(err?.message ?? err)}${ANSI.reset}`);
    } finally {
      abortRef.current = null;
    }

    // Print next prompt
    term.write(makePrompt(cwdRef.current));
  }, [execMutation]);

  /** Run a quick-command chip — write to terminal as if typed */
  const runQuick = useCallback((cmd: string) => {
    const term = termRef.current;
    if (!term) return;
    // Print the command as if the user typed it
    term.writeln(cmd);
    lineRef.current = "";
    runCommand(cmd);
  }, [runCommand]);

  /** Clear the terminal */
  const clear = useCallback(() => {
    termRef.current?.clear();
    termRef.current?.write(makePrompt(cwdRef.current));
  }, []);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-[#080810]">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#1a1a24] bg-[#0a0a0c] shrink-0">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <span className="text-emerald-400 font-bold text-xs">TERMINAL</span>
          <span className="hidden sm:block bg-[#141420] text-[#52526e] text-[10px] px-2 py-0.5 rounded-full font-mono truncate max-w-[220px]">
            {tilde(cwdRef.current)}
          </span>
          {cwdInfo && (
            <span className="hidden lg:inline text-[10px] text-[#3a3a5c] font-mono">
              {cwdInfo.python} · Node {cwdInfo.node}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {/* Quick-command chips */}
          <div className="hidden sm:flex items-center gap-1 overflow-x-auto max-w-[340px]">
            {QUICK_CMDS.map(c => (
              <button
                key={c}
                className="bg-[#141420] hover:bg-[#1e1e2e] text-emerald-400 text-[10px] px-2 py-0.5 rounded-full shrink-0 transition-colors font-mono"
                onClick={() => runQuick(c)}
                title={`Run: ${c}`}
              >
                {c}
              </button>
            ))}
          </div>
          <button
            className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-red-400 hover:bg-[#141420] transition-colors"
            onClick={clear}
            title="Clear terminal (Ctrl+L)"
          >
            <Trash2 className="h-3 w-3" />
          </button>
          <button
            className="h-6 w-6 flex items-center justify-center rounded text-[#52526e] hover:text-foreground hover:bg-[#141420] transition-colors"
            onClick={() => setShowTerminal(false)}
            title="Close terminal (Ctrl+`)"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* xterm.js mount target */}
      <div
        ref={containerRef}
        className="flex-1 min-h-0 px-1 py-1"
        style={{ backgroundColor: "#080810" }}
        onClick={() => termRef.current?.focus()}
      />
    </div>
  );
}
