import { X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface TerminalOutputProps {
  result: {
    stdout: string;
    stderr: string;
    exitCode: number;
    elapsedMs: number;
  };
  onClose: () => void;
}

export function TerminalOutput({ result, onClose }: TerminalOutputProps) {
  const isError = result.exitCode !== 0 || !!result.stderr;

  return (
    <div className="border-t border-border bg-[#0d0d0d] font-mono text-sm text-gray-300 flex flex-col max-h-[40vh]">
      <div className="flex items-center justify-between px-4 py-2 bg-[#1a1a1a] border-b border-[#333]">
        <div className="flex items-center gap-3">
          <span className="font-semibold text-gray-200">Terminal</span>
          <span className={`px-1.5 py-0.5 rounded text-[10px] ${isError ? 'bg-red-900/30 text-red-400' : 'bg-green-900/30 text-green-400'}`}>
            Exit: {result.exitCode}
          </span>
          <span className="text-gray-500 text-xs">{result.elapsedMs}ms</span>
        </div>
        <Button variant="ghost" size="icon" className="h-6 w-6 hover:bg-[#333]" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="p-4 overflow-auto flex-1">
        {result.stdout && (
          <pre className="whitespace-pre-wrap text-gray-300 break-words">{result.stdout}</pre>
        )}
        {result.stderr && (
          <pre className="whitespace-pre-wrap text-red-400 mt-2 break-words">{result.stderr}</pre>
        )}
        {!result.stdout && !result.stderr && (
          <span className="text-gray-500 italic">No output</span>
        )}
      </div>
    </div>
  );
}
