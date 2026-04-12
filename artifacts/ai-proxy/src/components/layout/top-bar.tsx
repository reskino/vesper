/**
 * TopBar — global header.
 *
 * Desktop: Logo | divider | ModelSelector (centered) | icon actions
 * Mobile:  Logo + "Vesper" | ModelSelector (compact) | New-chat button
 *          (panel-toggle icons are hidden on mobile — bottom nav handles them)
 */
import { useEffect, useRef, useState } from "react";
import {
  useListAis, getListAisQueryKey, useSetModel,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useIDE } from "@/contexts/ide-context";
import { VesperLogo } from "@/components/vesper-logo";
import { toast } from "sonner";
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

// ── Tier badge ────────────────────────────────────────────────────────────────
function TierBadge({ tier }: { tier?: string }) {
  if (!tier || tier === "free")
    return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-emerald-500/15 text-emerald-400">Free</span>;
  if (tier === "pro")
    return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-amber-500/15 text-amber-400">Pro</span>;
  return <span className="text-[9px] font-bold px-1 py-0.5 rounded bg-violet-500/15 text-violet-400">Plus</span>;
}

// ── Model selector ────────────────────────────────────────────────────────────
export function ModelSelector({ compact = false }: { compact?: boolean }) {
  const { selectedAi, setSelectedAi } = useIDE();
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

  const isAuto     = selectedAi === "__auto__";
  const ais        = aisData?.ais ?? [];
  const currentAi  = isAuto ? null : ais.find((a: any) => a.id === selectedAi);
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
          toast.success(`Switched to ${m?.name ?? modelId}`);
        },
      }
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-1.5 text-[#9898b8] text-xs">
        <Loader2 className="h-3 w-3 animate-spin" />
        {!compact && "Loading…"}
      </div>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(o => !o)}
        className={`flex items-center gap-2 rounded-xl bg-[#0f0f16] hover:bg-[#141420]
          border border-[#1e1e2e] hover:border-[#252535]
          font-semibold text-foreground transition-all duration-150
          shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]
          ${compact ? "h-8 px-2.5 text-xs" : "h-8 px-3 text-[13px]"}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label="Select AI model"
      >
        {isAuto ? (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${anyConnected ? "bg-emerald-400" : "bg-primary animate-pulse"}`} />
            <span>Auto</span>
            {!compact && (
              <span className="hidden sm:inline text-[11px] text-[#9898b8] font-normal">
                · {anyConnected ? `${ais.filter((a: any) => a.hasSession).length} AI${ais.filter((a: any) => a.hasSession).length !== 1 ? "s" : ""} ready` : "Best available"}
              </span>
            )}
          </>
        ) : (
          <>
            {currentAi && <StatusDot hasSession={currentAi.hasSession} />}
            <span className="truncate max-w-[100px]">{currentAi?.name ?? "Select AI"}</span>
            {!compact && activeModel && (
              <span className="hidden sm:inline text-[11px] text-[#9898b8] font-normal">· {activeModel.name}</span>
            )}
          </>
        )}
        <ChevronDown className="h-3 w-3 text-[#9898b8] shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="AI models"
          className="absolute top-full mt-1.5 w-72 z-[100] rounded-xl border border-[#1a1a24]
            bg-[#0d0d12] shadow-2xl overflow-hidden max-h-[min(480px,65vh)] flex flex-col
            left-0 sm:left-1/2 sm:-translate-x-1/2"
        >
          <div className="overflow-y-auto flex-1 p-1.5 space-y-0.5">
            {/* Auto */}
            <div
              role="option"
              aria-selected={isAuto}
              className={`flex items-center gap-2.5 rounded-lg cursor-pointer transition-colors
                ${isAuto ? "bg-primary/10" : "hover:bg-[#141420]"}`}
              onClick={() => { setSelectedAi("__auto__"); setOpen(false); }}
            >
              <div className="flex items-center gap-2.5 flex-1 px-3 py-2.5">
                <Zap className={`h-3.5 w-3.5 ${isAuto ? "text-primary" : "text-[#9898b8]"}`} />
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${isAuto ? "text-primary" : "text-foreground"}`}>Auto</p>
                  <p className="text-[10px] text-[#9898b8]">Best available AI with fallback</p>
                </div>
                {isAuto && <Check className="h-3.5 w-3.5 text-primary" />}
              </div>
            </div>

            <div className="mx-2 border-t border-[#1a1a24] my-1" />
            <p className="px-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-[#7878a8]">Direct Providers</p>

            {ais.map((ai: any) => {
              const isSel = !isAuto && selectedAi === ai.id;
              const isExp = expandedAi === ai.id;
              const mdl   = ai.models?.find((m: any) => m.id === ai.currentModel) ?? ai.models?.[0];
              return (
                <div key={ai.id} role="option" aria-selected={isSel}>
                  <div className={`flex items-center gap-2.5 rounded-lg transition-colors
                    ${isSel ? "bg-primary/10" : "hover:bg-[#141420]"}`}>
                    <button
                      className="flex items-center gap-2.5 flex-1 px-3 py-2.5 text-left min-h-[44px]"
                      onClick={() => { setSelectedAi(ai.id); setOpen(false); setExpandedAi(null); }}
                    >
                      <StatusDot hasSession={ai.hasSession} />
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium ${isSel ? "text-primary" : "text-foreground"}`}>{ai.name}</p>
                        {mdl ? (
                          <p className="text-[10px] text-[#9898b8] font-mono truncate">{mdl.name}</p>
                        ) : (
                          <p className="text-[10px] text-amber-400/80">Not connected</p>
                        )}
                      </div>
                      {isSel && <Check className="h-3.5 w-3.5 text-primary" />}
                    </button>
                    {ai.models?.length > 1 && (
                      <button
                        className="pr-3 py-3 min-h-[44px] text-[#9898b8] hover:text-foreground transition-colors"
                        onClick={e => { e.stopPropagation(); setExpandedAi(isExp ? null : ai.id); }}
                        aria-label={`${isExp ? "Collapse" : "Expand"} ${ai.name} models`}
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
                          className={`w-full flex items-center gap-2 px-3 py-2.5 text-xs transition-colors
                            min-h-[40px] ${
                            ai.currentModel === m.id
                              ? "bg-primary/10 text-primary font-medium"
                              : "text-[#9898b8] hover:bg-[#141420] hover:text-foreground"
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
          className={`h-8 w-8 flex items-center justify-center rounded-lg transition-all
            ${active
              ? "bg-primary/20 text-primary border border-primary/30"
              : "text-[#9898b8] hover:text-[#a0a0c0] hover:bg-[#141420]"
            }`}
          aria-label={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {label}{shortcut && <span className="ml-1 text-[#9898b8]">{shortcut}</span>}
      </TooltipContent>
    </Tooltip>
  );
}

// ── TopBar ────────────────────────────────────────────────────────────────────
export function TopBar() {
  const { showChat, toggleChat, showTerminal, toggleTerminal, triggerNewChat, setShowMobileSettings } = useIDE();

  return (
    <header
      className="shrink-0 flex flex-col
        bg-[#080809] border-b border-[#131318] z-20 select-none
        shadow-[0_1px_0_rgba(255,255,255,0.02)]"
      style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}
    >
    <div className="h-12 md:h-11 flex items-center px-3 gap-2.5">
      {/* ── Logo ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 shrink-0">
        <div className="h-7 w-7 rounded-lg bg-gradient-to-br from-primary/30 to-primary/10
          border border-primary/20 flex items-center justify-center
          shadow-[0_0_12px_rgba(99,102,241,0.15)]">
          <VesperLogo size={14} />
        </div>
        <span className="font-bold text-[13px] text-foreground tracking-tight hidden sm:block">Vesper</span>
      </div>

      {/* Divider */}
      <div className="w-px h-4 bg-[#1a1a24] shrink-0 hidden md:block" />

      {/* ── Model selector — centered on desktop ───────────────────────── */}
      <div className="flex-1 flex items-center md:justify-center">
        <div className="hidden md:block">
          <ModelSelector />
        </div>
        <div className="md:hidden">
          <ModelSelector compact />
        </div>
      </div>

      {/* ── Right actions ──────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">

        {/* New chat */}
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              onClick={triggerNewChat}
              className="h-8 w-8 flex items-center justify-center rounded-lg
                text-[#9898b8] hover:text-foreground hover:bg-[#141420]
                transition-all duration-150"
              aria-label="New Chat"
            >
              <Plus className="h-[15px] w-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">
            New Chat <kbd className="ml-1 text-[10px] text-[#9898b8] bg-[#0a0a0c] border border-[#1a1a24] rounded px-1">⌃N</kbd>
          </TooltipContent>
        </Tooltip>

        {/* Desktop panel toggles */}
        <div className="hidden md:flex items-center gap-0.5">
          <IconBtn icon={PanelRight}  label="Toggle Chat"     shortcut="⌃J" active={showChat}    onClick={toggleChat} />
          <IconBtn icon={PanelBottom} label="Toggle Terminal" shortcut="⌃`" active={showTerminal} onClick={toggleTerminal} />
          <div className="w-px h-4 bg-[#1a1a24] mx-1.5" />
        </div>

        {/* Sessions / settings — desktop uses sidebar, mobile opens sheet */}
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <button
              onClick={() => setShowMobileSettings(true)}
              className="h-8 w-8 flex items-center justify-center rounded-lg md:hidden
                text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-all duration-150"
              aria-label="Providers & Settings"
            >
              <Settings className="h-[15px] w-[15px]" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Providers & Settings</TooltipContent>
        </Tooltip>
        <Tooltip delayDuration={400}>
          <TooltipTrigger asChild>
            <Link href="/sessions">
              <button
                className="h-8 w-8 items-center justify-center rounded-lg hidden md:flex
                  text-[#9898b8] hover:text-foreground hover:bg-[#141420] transition-all duration-150"
                aria-label="Sessions & Settings"
              >
                <Settings className="h-[15px] w-[15px]" />
              </button>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs">Sessions & Settings</TooltipContent>
        </Tooltip>
      </div>
    </div>
    </header>
  );
}
