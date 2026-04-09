import { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";
import { 
  useGetFileTree, 
  getGetFileTreeQueryKey,
  useReadFile,
  getReadFileQueryKey,
  useWriteFile,
  useListAis,
  getListAisQueryKey,
  useAskAiWithContext,
  FileNode
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { 
  Folder, FileIcon, FileCode, FileText, FileJson, 
  ChevronRight, ChevronDown, Save, Play, RefreshCw, 
  TerminalSquare, Check, CheckSquare, Square,
  Settings, Loader2, PlayCircle, MessageSquare
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { sql } from "@codemirror/lang-sql";
import { tokyoNight } from "@uiw/codemirror-theme-tokyo-night";

const getLanguageExtension = (filename: string) => {
  if (!filename) return [];
  if (filename.endsWith('.js') || filename.endsWith('.jsx') || filename.endsWith('.ts') || filename.endsWith('.tsx')) return [javascript({ jsx: true, typescript: true })];
  if (filename.endsWith('.py')) return [python()];
  if (filename.endsWith('.css')) return [css()];
  if (filename.endsWith('.html')) return [html()];
  if (filename.endsWith('.json')) return [json()];
  if (filename.endsWith('.md')) return [markdown()];
  if (filename.endsWith('.rs')) return [rust()];
  if (filename.endsWith('.sql')) return [sql()];
  return [];
};

const getFileIcon = (filename: string) => {
  if (filename.endsWith('.js') || filename.endsWith('.ts') || filename.endsWith('.jsx') || filename.endsWith('.tsx')) return <FileCode className="h-4 w-4 text-blue-400" />;
  if (filename.endsWith('.json')) return <FileJson className="h-4 w-4 text-yellow-400" />;
  if (filename.endsWith('.md')) return <FileText className="h-4 w-4 text-gray-400" />;
  return <FileIcon className="h-4 w-4 text-gray-500" />;
};

function FileTreeItem({ 
  node, 
  depth = 0, 
  onSelect, 
  selectedPath,
  checkedPaths,
  onToggleCheck
}: { 
  node: FileNode; 
  depth?: number; 
  onSelect: (path: string) => void;
  selectedPath: string | null;
  checkedPaths: Set<string>;
  onToggleCheck: (path: string, checked: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(depth === 0);
  const isSelected = selectedPath === node.path;
  const isChecked = checkedPaths.has(node.path);

  if (node.name.startsWith('.')) return null;

  if (node.type === 'directory') {
    return (
      <div>
        <div 
          className="flex items-center py-1 px-2 hover:bg-sidebar-accent cursor-pointer text-sm text-sidebar-foreground group"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <ChevronDown className="h-3.5 w-3.5 mr-1 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 mr-1 text-muted-foreground" />}
          <Folder className="h-4 w-4 mr-2 text-blue-500" />
          <span className="truncate">{node.name}</span>
        </div>
        {expanded && node.children && (
          <div>
            {node.children.map(child => (
              <FileTreeItem 
                key={child.path} 
                node={child} 
                depth={depth + 1} 
                onSelect={onSelect}
                selectedPath={selectedPath}
                checkedPaths={checkedPaths}
                onToggleCheck={onToggleCheck}
              />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div 
      className={`flex items-center justify-between py-1 px-2 cursor-pointer text-sm group ${isSelected ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/50'}`}
      style={{ paddingLeft: `${depth * 12 + 24}px` }}
    >
      <div className="flex items-center flex-1 min-w-0" onClick={() => onSelect(node.path)}>
        <div className="mr-2 opacity-50 group-hover:opacity-100 transition-opacity" onClick={(e) => { e.stopPropagation(); onToggleCheck(node.path, !isChecked); }}>
          {isChecked ? <CheckSquare className="h-3.5 w-3.5 text-primary" /> : <Square className="h-3.5 w-3.5 text-muted-foreground" />}
        </div>
        {getFileIcon(node.name)}
        <span className="truncate ml-2">{node.name}</span>
      </div>
    </div>
  );
}

export default function Editor() {
  const { toast } = useToast();
  
  // File Tree
  const { data: treeData, isLoading: treeLoading } = useGetFileTree({ path: "", depth: 10 }, {
    query: { queryKey: getGetFileTreeQueryKey({ path: "", depth: 10 }) }
  });

  // Selection state
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [checkedFiles, setCheckedFiles] = useState<Set<string>>(new Set());
  
  // Editor state
  const [editorContent, setEditorContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  // File Read
  const { data: fileData, isLoading: fileLoading } = useReadFile(
    { path: selectedFile || "" },
    { 
      query: { 
        enabled: !!selectedFile,
        queryKey: getReadFileQueryKey({ path: selectedFile || "" }),
      } 
    }
  );

  useEffect(() => {
    if (fileData) {
      setEditorContent(fileData.content);
      setIsDirty(false);
    } else {
      setEditorContent("");
      setIsDirty(false);
    }
  }, [fileData, selectedFile]);

  // File Write
  const writeFile = useWriteFile();

  const handleSave = async () => {
    if (!selectedFile) return;
    try {
      await writeFile.mutateAsync({ data: { path: selectedFile, content: editorContent } });
      setIsDirty(false);
      toast({ description: "File saved successfully" });
    } catch (e) {
      toast({ description: "Failed to save file", variant: "destructive" });
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  // AI Panel
  const { data: aisData } = useListAis({ query: { queryKey: getListAisQueryKey() } });
  const [selectedAi, setSelectedAi] = useState<string | null>(null);
  
  useEffect(() => {
    if (aisData?.ais && !selectedAi) {
      const activeAi = aisData.ais.find(a => a.hasSession);
      if (activeAi) setSelectedAi(activeAi.id);
      else if (aisData.ais.length > 0) setSelectedAi(aisData.ais[0].id);
    }
  }, [aisData, selectedAi]);

  const askAiWithContext = useAskAiWithContext();
  const [prompt, setPrompt] = useState("");
  const [aiResponse, setAiResponse] = useState<string | null>(null);

  const handleAskAi = async (action?: string) => {
    if (!selectedAi || (!prompt.trim() && !action)) return;
    if (!selectedFile && checkedFiles.size === 0) {
      toast({ description: "Select a file or check files to add as context", variant: "destructive" });
      return;
    }

    setAiResponse(null);

    const filesContext = [];
    if (selectedFile && editorContent) {
      filesContext.push({ path: selectedFile, content: editorContent });
    }

    // Include other checked files (simplified - would need actual content fetching for real implementation if not the current file)
    // For this prototype, we rely mostly on the active file or if the backend can fetch them.
    // The API might expect full content. If we don't have it, we only send paths or rely on backend.
    // According to spec: body: { aiId, prompt, files: [{path, content, language?}] }
    
    try {
      const result = await askAiWithContext.mutateAsync({
        data: {
          aiId: selectedAi,
          prompt: prompt || (action ? `Please ${action} this code.` : ""),
          action: action,
          files: filesContext
        }
      });

      if (result.success) {
        setAiResponse(result.response);
      } else {
        toast({ description: result.error || "AI Request failed", variant: "destructive" });
      }
    } catch (e) {
      toast({ description: "An error occurred during AI request", variant: "destructive" });
    }
  };

  const handleApplyCode = () => {
    if (!aiResponse || !selectedFile) return;
    
    // Extract first code block
    const match = aiResponse.match(/```[\w]*\n([\s\S]*?)```/);
    if (match && match[1]) {
      setEditorContent(match[1].trim());
      setIsDirty(true);
      toast({ description: "Applied code to editor. Don't forget to save." });
    } else {
      toast({ description: "No code block found in response", variant: "destructive" });
    }
  };

  return (
    <div className="flex h-full w-full bg-background" onKeyDown={handleKeyDown}>
      <ResizablePanelGroup direction="horizontal">
        
        {/* Left Panel: File Tree */}
        <ResizablePanel defaultSize={20} minSize={15} maxSize={30} className="bg-sidebar border-r border-border flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
            <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">Explorer</span>
          </div>
          <ScrollArea className="flex-1">
            <div className="p-2">
              {treeLoading ? (
                <div className="flex items-center justify-center p-4 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /></div>
              ) : treeData?.tree ? (
                <FileTreeItem 
                  node={treeData.tree} 
                  onSelect={setSelectedFile} 
                  selectedPath={selectedFile}
                  checkedPaths={checkedFiles}
                  onToggleCheck={(path, checked) => {
                    const newSet = new Set(checkedFiles);
                    if (checked) newSet.add(path);
                    else newSet.delete(path);
                    setCheckedFiles(newSet);
                  }}
                />
              ) : (
                <div className="p-4 text-xs text-muted-foreground text-center">No files found</div>
              )}
            </div>
          </ScrollArea>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Middle Panel: Editor */}
        <ResizablePanel defaultSize={50} className="flex flex-col bg-background min-w-0">
          <div className="h-10 border-b border-border flex items-center px-4 justify-between bg-card shrink-0">
            <div className="flex items-center gap-2 overflow-hidden">
              {selectedFile ? (
                <>
                  {getFileIcon(selectedFile)}
                  <span className="text-sm text-foreground truncate font-mono">{selectedFile} {isDirty && "*"}</span>
                </>
              ) : (
                <span className="text-sm text-muted-foreground italic">No file selected</span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={handleSave} 
                disabled={!selectedFile || !isDirty || writeFile.isPending}
                className="h-7 text-xs"
              >
                {writeFile.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Save className="h-3 w-3 mr-1" />}
                Save
              </Button>
            </div>
          </div>
          
          <div className="flex-1 overflow-auto bg-[#1a1b26]">
            {fileLoading ? (
              <div className="h-full flex items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : selectedFile ? (
              <CodeMirror
                value={editorContent}
                height="100%"
                theme={tokyoNight}
                extensions={getLanguageExtension(selectedFile)}
                onChange={(val) => {
                  setEditorContent(val);
                  setIsDirty(true);
                }}
                className="h-full text-base"
              />
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4">
                <TerminalSquare className="h-16 w-16 opacity-20" />
                <p>Select a file from the explorer to start editing.</p>
              </div>
            )}
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right Panel: AI Context */}
        <ResizablePanel defaultSize={30} minSize={20} maxSize={40} className="bg-sidebar border-l border-border flex flex-col">
          <div className="p-3 border-b border-border flex items-center justify-between shrink-0">
            <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">AI Assistant</span>
            <div className="flex items-center">
               <select 
                className="bg-background border border-border text-xs rounded px-2 py-1 outline-none text-foreground"
                value={selectedAi || ""}
                onChange={e => setSelectedAi(e.target.value)}
              >
                {aisData?.ais.map(ai => (
                  <option key={ai.id} value={ai.id}>{ai.name}</option>
                ))}
              </select>
            </div>
          </div>
          
          <ScrollArea className="flex-1">
            <div className="p-4 space-y-6">
              
              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Quick Actions</label>
                <div className="grid grid-cols-2 gap-2">
                  <Button variant="outline" size="sm" className="text-xs justify-start" onClick={() => handleAskAi("explain")} disabled={askAiWithContext.isPending || !selectedFile}>Explain Code</Button>
                  <Button variant="outline" size="sm" className="text-xs justify-start" onClick={() => handleAskAi("fix bugs")} disabled={askAiWithContext.isPending || !selectedFile}>Fix Bugs</Button>
                  <Button variant="outline" size="sm" className="text-xs justify-start" onClick={() => handleAskAi("refactor")} disabled={askAiWithContext.isPending || !selectedFile}>Refactor</Button>
                  <Button variant="outline" size="sm" className="text-xs justify-start" onClick={() => handleAskAi("write tests")} disabled={askAiWithContext.isPending || !selectedFile}>Write Tests</Button>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Custom Prompt</label>
                <Textarea 
                  placeholder="Ask a question about the code..." 
                  value={prompt}
                  onChange={e => setPrompt(e.target.value)}
                  className="min-h-[100px] text-sm resize-none bg-background"
                />
                <Button 
                  className="w-full" 
                  onClick={() => handleAskAi()}
                  disabled={askAiWithContext.isPending || !prompt.trim() || (!selectedFile && checkedFiles.size === 0)}
                >
                  {askAiWithContext.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <MessageSquare className="h-4 w-4 mr-2" />}
                  Ask AI
                </Button>
              </div>

              {aiResponse && (
                <div className="space-y-3 pt-4 border-t border-border">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Response</label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => { navigator.clipboard.writeText(aiResponse); toast({description: "Copied to clipboard"}) }}>
                        Copy
                      </Button>
                      <Button variant="secondary" size="sm" className="h-6 px-2 text-xs" onClick={handleApplyCode}>
                        Apply to File
                      </Button>
                    </div>
                  </div>
                  <div className="prose prose-sm dark:prose-invert bg-background border border-border p-3 rounded-md overflow-hidden">
                    <MarkdownRenderer content={aiResponse} />
                  </div>
                </div>
              )}

            </div>
          </ScrollArea>

        </ResizablePanel>

      </ResizablePanelGroup>
    </div>
  );
}
