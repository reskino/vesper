/**
 * MarkdownRenderer
 *
 * Renders AI responses as rich Markdown with:
 *  • GitHub-Flavored Markdown (tables, strikethrough, task lists)
 *  • Syntax-highlighted fenced code blocks (Prism / vscDarkPlus theme)
 *  • Copy-to-clipboard on every code block
 *  • Run/Execute for runnable languages (via backend execute_code)
 *  • Save-to-workspace — writes a code block directly into the active
 *    workspace file via the writeFile API, no copy-paste required
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Button } from "@/components/ui/button";
import { Play, Copy, Check, Save, X, FolderOpen, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { useExecuteCode, useWriteFile, useCreateFile, getGetFileTreeQueryKey } from "@workspace/api-client-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

// ── Language → suggested file extension map ───────────────────────────────────

const LANG_EXT: Record<string, string> = {
  typescript: "ts", tsx: "tsx",
  javascript: "js", jsx: "jsx",
  python: "py",
  rust: "rs",
  go: "go",
  java: "java",
  cpp: "cpp", c: "c",
  csharp: "cs",
  ruby: "rb",
  php: "php",
  swift: "swift",
  kotlin: "kt",
  shell: "sh", bash: "sh",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  yaml: "yml",
  toml: "toml",
  markdown: "md",
  sql: "sql",
};

function suggestFilename(language: string): string {
  const ext = LANG_EXT[language.toLowerCase()] ?? language.toLowerCase() ?? "txt";
  return `main.${ext}`;
}

// ── Props ──────────────────────────────────────────────────────────────────────

interface MarkdownRendererProps {
  content: string;
  onCodeExecuted?: (result: any) => void;
}

// ── Main renderer ─────────────────────────────────────────────────────────────

export function MarkdownRenderer({ content, onCodeExecuted }: MarkdownRendererProps) {
  const executeCode = useExecuteCode();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm md:prose-base dark:prose-invert max-w-none
        prose-pre:p-0 prose-pre:bg-transparent
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-blockquote:border-primary/30 prose-blockquote:text-[#9898b8]"
      components={{
        code(props) {
          const { children, className } = props;
          const match    = /language-(\w+)/.exec(className || "");
          const language = match ? match[1] : "text";
          const isInline = !match && !className?.includes("language-");
          const codeStr  = String(children).replace(/\n$/, "");

          if (isInline) {
            return (
              <code className="bg-[#141420] border border-[#1e1e2e] px-1.5 py-0.5 rounded font-mono text-[0.82em] text-primary/90">
                {children}
              </code>
            );
          }

          return (
            <CodeBlock
              code={codeStr}
              language={language}
              onExecute={
                onCodeExecuted
                  ? async () => {
                      try {
                        const result = await executeCode.mutateAsync({
                          data: { code: codeStr, language },
                        });
                        onCodeExecuted(result);
                      } catch (e) {
                        console.error(e);
                      }
                    }
                  : undefined
              }
              isExecuting={executeCode.isPending}
            />
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

// ── CodeBlock ─────────────────────────────────────────────────────────────────

interface CodeBlockProps {
  code: string;
  language: string;
  onExecute?: () => void;
  isExecuting?: boolean;
}

function CodeBlock({ code, language, onExecute, isExecuting }: CodeBlockProps) {
  const { currentWorkspace } = useWorkspace();
  const writeFile  = useWriteFile();
  const createFile = useCreateFile();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [copied,   setCopied]   = useState(false);
  const [saving,   setSaving]   = useState(false);   // inline save panel open
  const [savePath, setSavePath] = useState(() => suggestFilename(language));
  const [isSaving, setIsSaving] = useState(false);
  const pathInputRef = useRef<HTMLInputElement>(null);

  // ── Copy ──────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // ── Open save panel ───────────────────────────────────────────────────────
  const openSave = () => {
    setSavePath(suggestFilename(language));
    setSaving(true);
    setTimeout(() => pathInputRef.current?.focus(), 50);
  };

  // ── Confirm save ──────────────────────────────────────────────────────────
  const confirmSave = async () => {
    if (!currentWorkspace || !savePath.trim()) return;
    const fullPath = `${currentWorkspace.relPath}/${savePath.trim().replace(/^\/+/, "")}`;
    setIsSaving(true);
    try {
      // Try write first; if the file doesn't exist yet, create it
      try {
        await writeFile.mutateAsync({ data: { path: fullPath, content: code } });
      } catch {
        await createFile.mutateAsync({ data: { path: fullPath, content: code } });
      }
      // Invalidate file tree so Explorer refreshes
      queryClient.invalidateQueries({
        predicate: q =>
          Array.isArray(q.queryKey) &&
          String(q.queryKey[0]).includes("file"),
      });
      toast({ description: `Saved → ${savePath.trim()}` });
      setSaving(false);
    } catch (err: any) {
      toast({ description: err?.message ?? "Save failed", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="relative group rounded-xl overflow-hidden my-3 border border-[#1a1a24] bg-[#080810]">

      {/* ── Header bar ──────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3 py-1.5
        bg-[#0d0d16] border-b border-[#1a1a24] text-xs font-mono text-[#7878a8]">
        <span className="text-[11px] opacity-70 select-none">{language}</span>

        <div className="flex items-center gap-1">
          {/* Execute */}
          {onExecute && (
            <button
              onClick={onExecute}
              disabled={isExecuting}
              className="flex items-center gap-1 h-6 px-2 text-[11px] rounded
                text-[#9898b8] hover:text-foreground hover:bg-[#141420]
                disabled:opacity-40 transition-all"
              title="Run code"
            >
              <Play className="h-2.5 w-2.5" />
              {isExecuting ? "Running…" : "Run"}
            </button>
          )}

          {/* Save to workspace — only when a workspace is active */}
          {currentWorkspace && (
            <button
              onClick={openSave}
              className="flex items-center gap-1 h-6 px-2 text-[11px] rounded
                text-[#9898b8] hover:text-primary hover:bg-primary/10
                transition-all"
              title={`Save to workspace "${currentWorkspace.name}"`}
            >
              <Save className="h-2.5 w-2.5" />
              Save
            </button>
          )}

          {/* Copy */}
          <button
            onClick={handleCopy}
            className="h-6 w-6 flex items-center justify-center rounded
              text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-all"
            title="Copy to clipboard"
          >
            {copied
              ? <Check className="h-2.5 w-2.5 text-green-400" />
              : <Copy className="h-2.5 w-2.5" />
            }
          </button>
        </div>
      </div>

      {/* ── Save panel (inline) ──────────────────────────────────────────── */}
      {saving && (
        <div className="px-3 py-2 bg-[#0b0b14] border-b border-[#1a1a24]
          flex items-center gap-2 flex-wrap">
          <FolderOpen className="h-3 w-3 text-primary/70 shrink-0" />
          <span className="text-[10px] text-[#7878a8] shrink-0">
            {currentWorkspace?.name} /
          </span>
          <input
            ref={pathInputRef}
            value={savePath}
            onChange={e => setSavePath(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter") confirmSave();
              if (e.key === "Escape") setSaving(false);
            }}
            placeholder={suggestFilename(language)}
            className="flex-1 min-w-[120px] h-7 px-2 text-xs font-mono
              bg-[#141420] border border-[#1e1e2e] focus:border-primary/50
              rounded-lg outline-none text-foreground placeholder:text-[#555568]
              transition-colors"
            disabled={isSaving}
          />
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={confirmSave}
              disabled={isSaving || !savePath.trim()}
              className="h-7 px-3 text-[11px] font-bold bg-primary text-primary-foreground
                rounded-lg hover:bg-primary/80 disabled:opacity-40 transition-colors
                flex items-center gap-1.5"
            >
              {isSaving
                ? <><Loader2 className="h-2.5 w-2.5 animate-spin" /> Saving…</>
                : <><Save className="h-2.5 w-2.5" /> Save</>
              }
            </button>
            <button
              onClick={() => setSaving(false)}
              className="h-7 w-7 flex items-center justify-center rounded-lg
                text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-colors"
              title="Cancel"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        </div>
      )}

      {/* ── Code content ─────────────────────────────────────────────────── */}
      <div className="max-h-[520px] overflow-auto text-[12.5px] leading-relaxed">
        <SyntaxHighlighter
          PreTag="div"
          language={language}
          style={vscDarkPlus as any}
          customStyle={{ margin: 0, padding: "0.875rem 1rem", background: "transparent" }}
        >
          {code}
        </SyntaxHighlighter>
      </div>
    </div>
  );
}
