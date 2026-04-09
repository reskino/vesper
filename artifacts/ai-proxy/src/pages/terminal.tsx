import { useState, useRef, useEffect } from "react";
import { useTerminalExec, useGetTerminalCwd, getGetTerminalCwdQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, TerminalSquare, ChevronRight, Trash2, Copy } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface HistoryEntry {
  id: number;
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number;
  elapsedMs: number;
  cwd: string;
}

function TerminalLine({ text, isError }: { text: string; isError?: boolean }) {
  return (
    <pre className={`whitespace-pre-wrap break-all font-mono text-sm leading-5 ${isError ? "text-red-400" : "text-green-200"}`}>
      {text}
    </pre>
  );
}

export default function TerminalPage() {
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [command, setCommand] = useState("");
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [commandHistory, setCommandHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();
  const idCounter = useRef(0);

  const { data: cwdInfo } = useGetTerminalCwd({ query: { queryKey: getGetTerminalCwdQueryKey(), refetchInterval: 5000 } });
  const cwd = cwdInfo?.cwd || "/home/runner/workspace";

  const execMutation = useTerminalExec();

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history]);

  const promptStr = `${cwd.replace("/home/runner/workspace", "~")} $`;

  const handleRun = () => {
    const cmd = command.trim();
    if (!cmd) return;

    setCommandHistory((prev) => [cmd, ...prev.slice(0, 99)]);
    setHistoryIndex(-1);
    setCommand("");

    const entryId = ++idCounter.current;

    execMutation.mutate(
      { data: { command: cmd } },
      {
        onSuccess: (data) => {
          setHistory((prev) => [
            ...prev,
            {
              id: entryId,
              command: cmd,
              stdout: data.stdout,
              stderr: data.stderr,
              exitCode: data.exitCode,
              elapsedMs: data.elapsedMs,
              cwd: data.cwd,
            },
          ]);
        },
        onError: (err) => {
          setHistory((prev) => [
            ...prev,
            {
              id: entryId,
              command: cmd,
              stdout: "",
              stderr: String(err),
              exitCode: 1,
              elapsedMs: 0,
              cwd,
            },
          ]);
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleRun();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const newIdx = Math.min(historyIndex + 1, commandHistory.length - 1);
      setHistoryIndex(newIdx);
      setCommand(commandHistory[newIdx] || "");
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      const newIdx = Math.max(historyIndex - 1, -1);
      setHistoryIndex(newIdx);
      setCommand(newIdx === -1 ? "" : commandHistory[newIdx] || "");
    } else if (e.key === "l" && e.ctrlKey) {
      e.preventDefault();
      setHistory([]);
    }
  };

  const handleCopy = (text: string) => {
    navigator.clipboard.writeText(text);
    toast({ title: "Copied" });
  };

  const handleClear = () => setHistory([]);

  return (
    <div
      className="flex flex-col h-full bg-[#0d1117] text-green-300"
      onClick={() => inputRef.current?.focus()}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[#30363d] bg-[#161b22] shrink-0">
        <div className="flex items-center gap-2">
          <TerminalSquare className="h-4 w-4 text-green-400" />
          <span className="font-mono text-sm text-green-400 font-semibold">Terminal</span>
          <Badge variant="outline" className="font-mono text-xs text-muted-foreground border-[#30363d]">
            {cwd.replace("/home/runner/workspace", "~")}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {cwdInfo && (
            <span className="text-xs text-muted-foreground font-mono mr-3">
              {cwdInfo.python} · Node {cwdInfo.node}
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-red-400"
            onClick={(e) => { e.stopPropagation(); handleClear(); }}
            title="Clear terminal (Ctrl+L)"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Output area */}
      <div className="flex-1 overflow-y-auto px-4 py-3 font-mono text-sm space-y-2">
        {history.length === 0 && (
          <div className="text-muted-foreground text-xs pt-2">
            Type a command below. Try: <span className="text-green-400">ls</span>,{" "}
            <span className="text-green-400">python3 --version</span>,{" "}
            <span className="text-green-400">pip install requests</span>,{" "}
            <span className="text-green-400">node -e "console.log('hello')"</span>
          </div>
        )}

        {history.map((entry) => (
          <div key={entry.id} className="space-y-1">
            {/* Command line */}
            <div className="flex items-start gap-1 group">
              <span className="text-blue-400 shrink-0">
                {entry.cwd.replace("/home/runner/workspace", "~")} $
              </span>
              <span className="text-white break-all">{entry.command}</span>
              <button
                className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={() => handleCopy(entry.command)}
              >
                <Copy className="h-3 w-3 text-muted-foreground hover:text-white" />
              </button>
            </div>

            {/* stdout */}
            {entry.stdout && <TerminalLine text={entry.stdout} />}

            {/* stderr */}
            {entry.stderr && <TerminalLine text={entry.stderr} isError />}

            {/* Exit code + timing */}
            <div className="flex items-center gap-2 text-xs">
              <Badge
                variant="outline"
                className={`font-mono h-4 text-xs px-1 border-0 ${
                  entry.exitCode === 0
                    ? "bg-green-900/40 text-green-400"
                    : "bg-red-900/40 text-red-400"
                }`}
              >
                exit {entry.exitCode}
              </Badge>
              <span className="text-muted-foreground">{entry.elapsedMs}ms</span>
            </div>
          </div>
        ))}

        {execMutation.isPending && (
          <div className="flex items-center gap-2 text-muted-foreground text-xs">
            <Loader2 className="h-3 w-3 animate-spin" />
            Running...
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="shrink-0 border-t border-[#30363d] bg-[#0d1117] px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="text-blue-400 font-mono text-sm shrink-0">{promptStr}</span>
          <input
            ref={inputRef}
            type="text"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            onKeyDown={handleKeyDown}
            className="flex-1 bg-transparent border-0 outline-none font-mono text-sm text-white caret-green-400 placeholder:text-[#484f58]"
            placeholder="Enter command..."
            autoFocus
            spellCheck={false}
            autoComplete="off"
          />
          <Button
            size="sm"
            variant="ghost"
            className="text-green-400 hover:bg-green-900/20 font-mono h-7 px-3"
            onClick={handleRun}
            disabled={execMutation.isPending || !command.trim()}
          >
            {execMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ChevronRight className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
