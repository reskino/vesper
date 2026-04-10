import { useEffect, useRef, useState } from "react";
import {
  useListAis, getListAisQueryKey, useSetModel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useIDE } from "@/contexts/ide-context";
import { VesperLogo } from "@/components/vesper-logo";
import { useToast } from "@/hooks/use-toast";
import {
  Plus, TerminalSquare, MessageSquare, Settings, Loader2,
  ChevronDown, Check, Zap, ChevronUp, PanelRight, PanelBottom,
} from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Link } from "wouter";

// ── Status dot ────────────────────────────────────────────────────────────────
function StatusDot({ hasSession }: { hasSession: boolean }) {
  return (
    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${hasSession ? "bg-emerald-400" : "bg-amber-400"}`} />
  );
}

// ── Model tier badge ───────────────────────────────────────────────────────────
function TierBadge({ tier }: { tier?: string }) {
  if (!tier || tier === "free")
    return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Free</span>;
  if (tier === "pro")
    return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">Pro</span>;
  return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-500/15 text-violet-400">Plus</span>;
}

// ── Model selector dropdown ───────────────────────────────────────────────────
function ModelSelector() {
  const { selectedAi, setSelectedAi } = useIDE();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const setModelMutation = useSetModel();
  const { data: aisData, isLoading } = useListAis({
    query: { queryKey: getListAisQueryKey(), staleTime: 15_000, refetchInterval: 30_000 },
  });

  const [open, setOpen] = useState(false);
  const [expandedAi, setExpandedAi] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const isAuto = selectedAi === "__auto__";
  const ais = aisData?.ais ?? [];
  const currentAi = isAuto ? null : ais.find((a: any) => a.id === selectedAi);
  const activeModel = currentAi?.models?.find((m: any) => m.id === currentAi.currentModel) ?? currentAi?.models?.[0];
  const anyConnected = ais.some((a: any) => a.hasSession);

  const handleSetModel = (aiId: string, modelId: string) => {
    setModelMutation.mutate(
      { data: { aiId, modelId } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
          const ai = ais.find((a: any) => a.id === aiId);
          const m = ai?.models?.find((m: any) => m.id === modelId);
          toast({ description: `Switched to ${m?.name ?? modelId}` });
        },
      }
    );
  };

  if (isLoading) return (
    <div className="flex items-center gap-1.5 text-[#52526e] text-xs">
      <Loader2 className="h-3 w-3 animate-spin" /> Loading…
    </div>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 h-7 px-3 rounded-lg bg-[#141420] hover:bg-[#1e1e2e] border border-[#1a1a24] text-sm font-semibold text-foreground transition-all"
      >
        {isAuto ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${anyConnected ? "bg-emerald-400" : "bg-primary animate-pulse"}`} />
            <span>Auto</span>
            <span className="hidden sm:inline text-[11px] text-[#52526e] font-normal">· Best available</span>
          </>
        ) : (
          <>
            {currentAi && <StatusDot hasSession={currentAi.hasSession} />}
            <span>{currentAi?.name ?? "Select AI"}</span>
            {activeModel && (
              <span className="hidden sm:inline text-[11px] text-[#52526e] font-normal">· {activeModel.name}</span>
            )}
          </>
        )}
        <ChevronDown className="h-3 w-3 text-[#52526e]" />
      </button>

      {open && (
        <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 w-72 z-50 rounded-xl border border-[#1a1a24] bg-[#0d0d12] shadow-2xl overflow-hidden max-h-[min(480px,65vh)] flex flex-col">
          <div className="overflow-y-auto flex-1 p-1.5 space-y-0.5">

            {/* Auto option */}
            <div
              className={`flex items-center gap-2.5 rounded-lg cursor-pointer transition-colors ${isAuto ? "bg-primary/10" : "hover:bg-[#141420]"}`}
              onClick={() => { setSelectedAi("__auto__"); setOpen(false); }}
            >
              <div className="flex items-center gap-2.5 flex-1 px-3 py-2.5">
                <Zap className={`h-3.5 w-3.5 ${isAuto ? "text-primary" : "text-[#52526e]"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isAuto ? "text-primary" : "text-foreground"}`}>Auto</p>
                  <p className="text-[10px] text-[#52526e]">Best available AI with fallback</p>
                </div>
                {isAuto && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
            </div>

            <div className="mx-2 border-t border-[#1a1a24] my-1" />
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#3a3a5c]">Direct Providers</p>

            {ais.map((ai: any) => {
              const isSel = !isAuto && selectedAi === ai.id;
              const isExp = expandedAi === ai.id;
              const mdl = ai.models?.find((m: any) => m.id === ai.currentModel) ?? ai.models?.[0];
              return (
                <div key={ai.id}>
                  <div className={`flex items-center gap-2.5 rounded-lg transition-colors ${isSel ? "bg-primary/10" : "hover:bg-[#141420]"}`}>
                    <button
                      className="flex items-center gap-2.5 flex-1 px-3 py-2.5 text-left"
                      onClick={() => { setSelectedAi(ai.id); setOpen(false); setExpandedAi(null); }}
                    >
                      <StatusDot hasSession={ai.hasSession} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isSel ? "text-primary" : "text-foreground"}`}>{ai.name}</p>
                        {mdl ? (
                          <p className="text-[10px] text-[#52526e] font-mono truncate">{mdl.name}</p>
                        ) : (
                          <p className="text-[10px] text-amber-400/80">Not connected</p>
                        )}
                      </div>
                      {isSel && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                    {ai.models?.length > 1 && (
                      <button
                        className="pr-3 py-3 text-[#52526e] hover:text-foreground transition-colors"
                        onClick={e => { e.stopPropagation(); setExpandedAi(isExp ? null : ai.id); }}
                      >
                        {isExp ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                  {isExp && ai.models && (
                    <div className="ml-3 mr-2 mb-1 rounded-lg border border-[#1a1a24] overflow-hidden bg-[#0a0a0c]">
                      {ai.models.map((m: any) => (
                        <button
                          key={m.id}
                          className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors ${
                            ai.currentModel === m.id
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-[#52526e] hover:bg-[#141420] hover:text-foreground"
                          }`}
                          onClick={e => { e.stopPropagation(); handleSetModel(ai.id, m.id); setOpen(false); setExpandedAi(null); }}
                        >
                          <span className={`h-1.5 w-1.5 rounded-full ${ai.currentModel === m.id ? "bg-primary" : "bg-[#1a1a24]"}`} />
                          <span className="flex-1 text-left">{m.name}</span>
                          <TierBadge tier={m.tier} />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Icon button ───────────────────────────────────────────────────────────────
function IconBtn({ icon: Icon, label, active, onClick, shortcut }: {
  icon: React.ElementType; label: string; active?: boolean; onClick: () => void; shortcut?: string;
}) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>
        <button
          onClick={onClick}
          className={`h-7 w-7 flex items-center justify-center rounded-lg transition-all
            ${active
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-[#52526e] hover:text-[#a0a0c0] hover:bg-[#141420]"
            }`}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}{shortcut && <span className="ml-1 text-[#52526e]">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────
export function TopBar() {
  const { showChat, toggleChat, showTerminal, toggleTerminal, triggerNewChat } = useIDE();

  return (
    <header className="shrink-0 h-10 flex items-center px-3 gap-3 bg-[#0a0a0c] border-b border-[#1a1a24] z-20 select-none">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <VesperLogo size={22} />
        <span className="hidden sm:block font-extrabold text-sm text-foreground tracking-tight">Vesper</span>
      </div>

      <div className="w-px h-4 bg-[#1a1a24] shrink-0" />

      {/* Model selector — centered */}
      <div className="flex-1 flex items-center justify-center">
        <ModelSelector />
      </div>

      {/* Right actions */}
      <div className="flex items-center gap-1 shrink-0">
        <IconBtn icon={Plus} label="New Chat" shortcut="Ctrl+N" onClick={triggerNewChat} />
        <IconBtn icon={PanelRight} label="Toggle Chat" shortcut="Ctrl+J" active={showChat} onClick={toggleChat} />
        <IconBtn icon={TerminalSquare} label="Toggle Terminal" shortcut="Ctrl+`" active={showTerminal} onClick={toggleTerminal} />
        <div className="w-px h-4 bg-[#1a1a24] mx-1" />
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Link href="/sessions">
              <button className="h-7 w-7 flex items-center justify-center rounded-lg text-[#52526e] hover:text-[#a0a0c0] hover:bg-[#141420] transition-all" aria-label="Settings">
                <Settings className="h-4 w-4" />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Sessions & Settings</TooltipContent>
        </Tooltip>
      </div>
    </header>
  );
}
