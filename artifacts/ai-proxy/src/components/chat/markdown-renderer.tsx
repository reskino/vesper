import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { Button } from '@/components/ui/button';
import { Play, Copy, Check } from 'lucide-react';
import { useState } from 'react';
import { useExecuteCode } from '@workspace/api-client-react';

interface MarkdownRendererProps {
  content: string;
  onCodeExecuted?: (result: any) => void;
}

export function MarkdownRenderer({ content, onCodeExecuted }: MarkdownRendererProps) {
  const executeCode = useExecuteCode();

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      className="prose prose-sm md:prose-base dark:prose-invert max-w-none prose-pre:p-0 prose-pre:bg-transparent"
      components={{
        code(props) {
          const { children, className, node, ...rest } = props;
          const match = /language-(\w+)/.exec(className || '');
          const isInline = !match && !className?.includes('language-');
          const language = match ? match[1] : 'text';
          const codeString = String(children).replace(/\n$/, '');

          if (isInline) {
            return (
              <code className="bg-muted px-1.5 py-0.5 rounded-sm font-mono text-sm" {...rest}>
                {children}
              </code>
            );
          }

          return (
            <CodeBlock 
              code={codeString} 
              language={language} 
              onExecute={onCodeExecuted ? async () => {
                try {
                  const result = await executeCode.mutateAsync({
                    data: { code: codeString, language }
                  });
                  onCodeExecuted(result);
                } catch (e) {
                  console.error(e);
                }
              } : undefined}
              isExecuting={executeCode.isPending}
            />
          );
        }
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function CodeBlock({ code, language, onExecute, isExecuting }: { code: string; language: string; onExecute?: () => void; isExecuting?: boolean }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative group rounded-md overflow-hidden my-4 border border-border bg-black">
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-900 border-b border-zinc-800 text-xs font-mono text-zinc-400">
        <span>{language}</span>
        <div className="flex items-center gap-2">
          {onExecute && (
            <Button
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-zinc-400 hover:text-white hover:bg-zinc-800"
              onClick={onExecute}
              disabled={isExecuting}
            >
              <Play className="h-3 w-3 mr-1" />
              {isExecuting ? 'Running...' : 'Execute'}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-zinc-400 hover:text-white hover:bg-zinc-800"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
          </Button>
        </div>
      </div>
      <div className="max-h-[500px] overflow-auto text-[13px] leading-relaxed">
        <SyntaxHighlighter
          PreTag="div"
          children={code}
          language={language}
          style={vscDarkPlus as any}
          customStyle={{
            margin: 0,
            padding: '1rem',
            background: 'transparent',
          }}
        />
      </div>
    </div>
  );
}
