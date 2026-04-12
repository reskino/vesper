import { useState, useRef, useEffect } from "react";
import { useTerminalExec, useGetTerminalCwd, getGetTerminalCwdQueryKey } from "@workspace/api-client-react";
import { Loader2, TerminalSquare, Trash2, Copy, ChevronRight } from "lucide-react";
import { toast } from "sonner";

interface HistoryEntry {
  id: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsedMs: number;
  cwd: string;
}

const QUICK_CMDS = ["ls", "pwd", "python3 --version", "node --version", "pip list", "git status"];

export default function TerminalPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [command, setCommand] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const idCounter = useRef(0);

  const { data: cwdInfo } = useGetTerminalCwd({
    query: { queryKey: getGetTerminalCwdQueryKey(), refetchInterval: 5000 }
  });
  const cwd = cwdInfo?.cwd || "/home/runner/workspace";
  const cwd$ = cwd.replace("/home/runner/workspace", "~");

  const execMutation = useTerminalExec();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const run = (cmd?: string) => {
    const c = (cmd ?? command).trim();
    if (!c) return;
    setCommandHistory(prev => [c, ...prev.slice(0, 99)]);
    setHistoryIndex(-1);
    setCommand("");
    const id = ++idCounter.current;
    execMutation.mutate(
      { data: { command: c } },
      {
        onSuccess: data => setHistory(prev => [...prev, { id, command: c, stdout: data.stdout, stderr: data.stderr, exitCode: data.exitCode, elapsedMs: data.elapsedMs, cwd: data.cwd }]),
        onError: err => setHistory(prev => [...prev, { id, command: c, stdout: "", stderr: String(err), exitCode: 1, elapsedMs: 0, cwd }]),
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") { run(); }
    else if (e.key === "ArrowUp") {
      e.preventDefault();
      const idx = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(idx);
      setCommand(commandHistory[idx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const idx = Math.max(historyIndex - 1, -1);
      setHistoryIndex(idx);
      setCommand(idx === -1 ? "" : commandHistory[idx] || "");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setHistory([]);
    }
  };

  const copy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("Copied to clipboard");
  };

  return (
    <div className="flex flex-col h-full bg-[#0d1117] text-sm font-mono" onClick={() => inputRef.current?.focus()}>

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#21262d] bg-[#161b22] shrink-0 gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <TerminalSquare className="h-4 w-4 text-emerald-400 shrink-0" />
          <span className="text-emerald-400 font-semibold text-sm">Terminal</span>
          <span className="bg-[#21262d] text-[#8b949e] text-xs px-2 py-0.5 rounded-full font-mono truncate max-w-[180px] sm:max-w-xs">
            {cwd$}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {cwdInfo && (
            <span className="hidden sm:block text-xs text-[#8b949e]">
              {cwdInfo.python} · Node {cwdInfo.node}
            </span>
          )}
          <button
            className="h-7 w-7 flex items-center justify-center rounded-lg text-[#8b949e] hover:text-red-400 hover:bg-[#21262d] transition-colors"
            onClick={e => { e.stopPropagation(); setHistory([]); }}
            title="Clear (Ctrl+L)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Quick commands — mobile only */}
      <div className="sm:hidden flex gap-1.5 px-3 py-2 overflow-x-auto border-b border-[#21262d] bg-[#161b22] shrink-0">
        {QUICK_CMDS.map(c => (
          <button
            key={c}
            className="bg-[#21262d] hover:bg-[#30363d] text-emerald-400 text-[10px] px-2.5 py-1 rounded-full shrink-0 transition-colors"
            onClick={e => { e.stopPropagation(); run(c); }}
          >
            {c}
          </button>
        ))}
      </div>

      {/* Output */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {history.length === 0 && (
          <div className="text-[#8b949e] text-xs pt-1 leading-relaxed">
            Type a command and press Enter.{" "}
            <span className="text-[#58a6ff]">Ctrl+L</span> to clear.{" "}
            <span className="text-[#58a6ff]">↑↓</span> for history.
          </div>
        )}

        {history.map(entry => (
          <div key={entry.id} className="space-y-1">
            {/* Command */}
            <div className="flex items-start gap-2 group">
              <span className="text-[#58a6ff] shrink-0 text-xs pt-0.5">
                {entry.cwd.replace("/home/runner/workspace", "~")} $
              </span>
              <span className="text-white break-all flex-1 text-xs leading-relaxed">{entry.command}</span>
              <button
                className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
                onClick={() => copy(entry.command)}
              >
                <Copy className="h-3 w-3 text-[#8b949e] hover:text-white" />
              </button>
            </div>

            {entry.stdout && (
              <pre className="text-emerald-300 whitespace-pre-wrap break-all text-xs leading-relaxed pl-2 border-l border-emerald-900/40">
                {entry.stdout}
              </pre>
            )}
            {entry.stderr && (
              <pre className="text-red-400 whitespace-pre-wrap break-all text-xs leading-relaxed pl-2 border-l border-red-900/40">
                {entry.stderr}
              </pre>
            )}

            {/* Exit badge */}
            <div className="flex items-center gap-2 text-[10px] pl-0.5">
              <span className={`px-1.5 py-0.5 rounded font-mono ${
                entry.exitCode === 0 ? "bg-emerald-900/40 text-emerald-400" : "bg-red-900/40 text-red-400"
              }`}>
                {entry.exitCode === 0 ? "✓" : "✗"} {entry.exitCode}
              </span>
              <span className="text-[#8b949e]">{entry.elapsedMs}ms</span>
            </div>
          </div>
        ))}

        {execMutation.isPending && (
          <div className="flex items-center gap-2 text-[#8b949e] text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running...
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="shrink-0 border-t border-[#21262d] bg-[#0d1117] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-[#58a6ff] text-xs shrink-0">{cwd$} $</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={e => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-0 outline-none text-white text-xs caret-emerald-400 placeholder:text-[#484f58]"
            placeholder="Enter command..."
            autoFocus
            autoComplete="off"
            spellCheck={false}
          />
          <button
            className="h-7 w-7 flex items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors disabled:opacity-40 shrink-0"
            onClick={() => run()}
            disabled={execMutation.isPending || !command.trim()}
          >
            {execMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
