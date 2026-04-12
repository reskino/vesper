/**
 * AutonomousStepper — real-time progress UI for Autonomous Agent Mode.
 *
 * Renders the full step list inside the chat message area.
 * Each step has:
 *   • Status icon (pending / running / waiting-confirm / done / failed / skipped)
 *   • Title + expandable AI-generated result
 *   • Confirmation card for EDIT and RUN steps (safety gates)
 *
 * The parent (ChatPanel) drives all state; this component is pure display.
 */

import { useState } from "react";
import {
  Loader2, Check, X, AlertCircle, SkipForward,
  Play, Square, Pause, ChevronDown, ChevronRight,
  FileCode, Terminal, Brain, Eye, Sparkles, RefreshCw,
} from "lucide-react";
import { MarkdownRenderer } from "@/components/chat/markdown-renderer";

// ── Types ─────────────────────────────────────────────────────────────────────

export type StepType   = "think" | "analyse" | "edit" | "run" | "review";
export type StepStatus =
  | "pending"
  | "running"
  | "waiting_confirm"
  | "done"
  | "failed"
  | "skipped";

export interface AgentStep {
  id:          string;
  index:       number;
  title:       string;
  type:        StepType;
  status:      StepStatus;
  /** AI-generated prose result (for think/analyse/review steps) */
  result?:     string;
  /** Target file path (for edit steps) */
  filePath?:   string;
  /** AI-generated file content (for edit steps, shown in confirm card) */
  newContent?: string;
  /** Shell command (for run steps) */
  command?:    string;
  /** Terminal output after execution */
  commandOutput?: string;
  /** Whether a user approval is required before executing */
  requiresConfirm: boolean;
  error?:      string;
}

export interface AutoSession {
  task:       string;
  steps:      AgentStep[];
  isRunning:  boolean;
  isPaused:   boolean;
  isComplete: boolean;
  isStopped:  boolean;
}

interface AutonomousStepperProps {
  session:   AutoSession;
  onApprove: (stepId: string) => void;
  onSkip:    (stepId: string) => void;
  onPause:   () => void;
  onResume:  () => void;
  onStop:    () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function stepTypeIcon(type: StepType) {
  const cls = "h-3 w-3 shrink-0";
  switch (type) {
    case "think":   return <Brain className={`${cls} text-violet-400`} />;
    case "analyse": return <Brain className={`${cls} text-sky-400`} />;
    case "edit":    return <FileCode className={`${cls} text-emerald-400`} />;
    case "run":     return <Terminal className={`${cls} text-amber-400`} />;
    case "review":  return <Eye className={`${cls} text-rose-400`} />;
  }
}

function stepTypeBadge(type: StepType): string {
  switch (type) {
    case "think":   return "bg-violet-500/15 text-violet-400 border border-violet-500/20";
    case "analyse": return "bg-sky-500/15 text-sky-400 border border-sky-500/20";
    case "edit":    return "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20";
    case "run":     return "bg-amber-500/15 text-amber-400 border border-amber-500/20";
    case "review":  return "bg-rose-500/15 text-rose-400 border border-rose-500/20";
  }
}

function stepTypeLabel(type: StepType): string {
  switch (type) {
    case "think":   return "Think";
    case "analyse": return "Analyse";
    case "edit":    return "Edit";
    case "run":     return "Run";
    case "review":  return "Review";
  }
}

// ── Step status indicator ─────────────────────────────────────────────────────

function StepIndicator({ step }: { step: AgentStep }) {
  const n = step.index + 1;

  if (step.status === "running") {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-full border border-violet-500/40 bg-violet-500/15 shrink-0">
        <Loader2 className="h-3 w-3 text-violet-400 animate-spin" />
      </div>
    );
  }
  if (step.status === "waiting_confirm") {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-full border border-amber-500/40 bg-amber-500/15 shrink-0 animate-pulse">
        <span className="text-[9px] font-bold text-amber-400">?</span>
      </div>
    );
  }
  if (step.status === "done") {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-full border border-emerald-500/40 bg-emerald-500/15 shrink-0">
        <Check className="h-3 w-3 text-emerald-400" />
      </div>
    );
  }
  if (step.status === "failed") {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-full border border-red-500/40 bg-red-500/15 shrink-0">
        <AlertCircle className="h-3 w-3 text-red-400" />
      </div>
    );
  }
  if (step.status === "skipped") {
    return (
      <div className="flex items-center justify-center h-6 w-6 rounded-full border border-[#2a2a3c] bg-[#12121c] shrink-0">
        <SkipForward className="h-3 w-3 text-[#5a5a8a]" />
      </div>
    );
  }
  // Pending
  return (
    <div className="flex items-center justify-center h-6 w-6 rounded-full border border-[#2a2a3c] bg-[#12121c] shrink-0">
      <span className="text-[9px] font-bold text-[#5a5a8a]">{n}</span>
    </div>
  );
}

// ── Edit confirm card ─────────────────────────────────────────────────────────

function EditConfirmCard({
  step, onApprove, onSkip,
}: { step: AgentStep; onApprove: () => void; onSkip: () => void }) {
  const [showFull, setShowFull] = useState(false);
  const lines = (step.newContent ?? "").split("\n");
  const preview = lines.slice(0, showFull ? 999 : 22).join("\n");
  const clamped = lines.length > 22 && !showFull;

  return (
    <div className="mt-2 rounded-xl border border-emerald-500/25 bg-emerald-950/20 overflow-hidden">
      {/* File header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-emerald-950/30 border-b border-emerald-500/15">
        <FileCode className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
        <code className="text-[11px] font-mono text-emerald-300 flex-1 truncate">
          {step.filePath}
        </code>
        <span className="text-[10px] text-emerald-500/70">{lines.length} lines</span>
      </div>

      {/* Content preview */}
      <div className="relative">
        <pre className="text-[11px] font-mono text-[#c0c0e8] bg-[#0a0a12] px-3 py-2.5 overflow-x-auto max-h-48 overflow-y-auto leading-relaxed whitespace-pre-wrap">
          {preview}
        </pre>
        {clamped && (
          <button
            onClick={() => setShowFull(true)}
            className="w-full py-1.5 text-[10px] text-emerald-400/70 hover:text-emerald-300 bg-gradient-to-t from-[#0a0a12] to-transparent transition-colors"
          >
            Show {lines.length - 22} more lines
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-t border-emerald-500/15">
        <button
          onClick={onApprove}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold
            bg-emerald-500/20 border border-emerald-500/40 text-emerald-300
            hover:bg-emerald-500/30 active:scale-95 transition-all min-h-[32px]"
        >
          <Check className="h-3 w-3" /> Apply changes
        </button>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
            border border-[#2a2a3c] text-[#8888b8] hover:text-[#c0c0e8] hover:border-[#3a3a5a]
            active:scale-95 transition-all min-h-[32px]"
        >
          <SkipForward className="h-3 w-3" /> Skip
        </button>
        <p className="ml-auto text-[10px] text-[#5a5a8a]">Review before applying</p>
      </div>
    </div>
  );
}

// ── Run confirm card ──────────────────────────────────────────────────────────

function RunConfirmCard({
  step, onApprove, onSkip,
}: { step: AgentStep; onApprove: () => void; onSkip: () => void }) {
  return (
    <div className="mt-2 rounded-xl border border-amber-500/25 bg-amber-950/20 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 bg-amber-950/30 border-b border-amber-500/15">
        <Terminal className="h-3.5 w-3.5 text-amber-400 shrink-0" />
        <code className="text-[11px] font-mono text-amber-200 flex-1 break-all">
          {step.command}
        </code>
      </div>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button
          onClick={onApprove}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold
            bg-amber-500/20 border border-amber-500/40 text-amber-300
            hover:bg-amber-500/30 active:scale-95 transition-all min-h-[32px]"
        >
          <Play className="h-3 w-3" /> Run command
        </button>
        <button
          onClick={onSkip}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-medium
            border border-[#2a2a3c] text-[#8888b8] hover:text-[#c0c0e8] hover:border-[#3a3a5a]
            active:scale-95 transition-all min-h-[32px]"
        >
          <SkipForward className="h-3 w-3" /> Skip
        </button>
        <p className="ml-auto text-[10px] text-[#5a5a8a]">Executes in workspace terminal</p>
      </div>
    </div>
  );
}

// ── Individual step row ───────────────────────────────────────────────────────

function StepRow({
  step, onApprove, onSkip,
}: {
  step:      AgentStep;
  onApprove: (id: string) => void;
  onSkip:    (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(step.status === "done" || step.status === "failed");

  const hasResult   = !!(step.result || step.commandOutput || step.error);
  const isExpandable = hasResult && step.status !== "waiting_confirm";

  return (
    <div className={`transition-all duration-200 ${step.status === "pending" ? "opacity-40" : "opacity-100"}`}>
      {/* Step header row */}
      <div
        className={`flex items-start gap-2.5 py-2 ${isExpandable ? "cursor-pointer hover:bg-[#0f0f18] rounded-lg px-1.5 -mx-1.5" : ""}`}
        onClick={isExpandable ? () => setExpanded(e => !e) : undefined}
        role={isExpandable ? "button" : undefined}
        aria-expanded={isExpandable ? expanded : undefined}
      >
        <StepIndicator step={step} />

        <div className="flex-1 min-w-0 pt-0.5">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider ${stepTypeBadge(step.type)}`}>
              {stepTypeLabel(step.type)}
              {step.filePath && <span className="ml-1 normal-case opacity-80 font-mono">{step.filePath}</span>}
              {step.command && <span className="ml-1 normal-case opacity-80 font-mono truncate max-w-[120px] inline-block align-bottom">{step.command}</span>}
            </span>
            <span className={`text-[12px] font-medium leading-snug ${
              step.status === "failed"  ? "text-red-300" :
              step.status === "skipped" ? "text-[#5a5a8a] line-through" :
              "text-[#d0d0f0]"
            }`}>
              {step.title}
            </span>
          </div>

          {/* Running animation */}
          {step.status === "running" && (
            <div className="flex items-center gap-1.5 mt-1.5">
              {[0, 1, 2].map(i => (
                <span
                  key={i}
                  className="h-1.5 w-1.5 rounded-full bg-violet-500/70 animate-bounce"
                  style={{ animationDelay: `${i * 0.15}s` }}
                />
              ))}
              <span className="text-[10px] text-[#7070a0] animate-pulse ml-0.5">
                {stepTypeIcon(step.type)} {step.type === "edit" ? "Generating…" : step.type === "run" ? "Executing…" : "Thinking…"}
              </span>
            </div>
          )}

          {/* Waiting confirm */}
          {step.status === "waiting_confirm" && step.type === "edit" && step.newContent !== undefined && (
            <EditConfirmCard
              step={step}
              onApprove={() => onApprove(step.id)}
              onSkip={() => onSkip(step.id)}
            />
          )}
          {step.status === "waiting_confirm" && step.type === "run" && (
            <RunConfirmCard
              step={step}
              onApprove={() => onApprove(step.id)}
              onSkip={() => onSkip(step.id)}
            />
          )}

          {/* Expandable result */}
          {isExpandable && expanded && (
            <div className="mt-2 text-[12px] text-[#c0c0e0] leading-relaxed">
              {step.error && (
                <p className="text-red-400 flex items-center gap-1.5 text-[11px]">
                  <AlertCircle className="h-3 w-3 shrink-0" /> {step.error}
                </p>
              )}
              {step.commandOutput && (
                <pre className="font-mono text-[11px] bg-[#0a0a12] border border-[#1a1a2e] rounded-lg p-2.5 overflow-x-auto whitespace-pre-wrap max-h-40 overflow-y-auto text-[#90e090]">
                  {step.commandOutput.slice(0, 2000)}
                  {step.commandOutput.length > 2000 && "\n… (truncated)"}
                </pre>
              )}
              {step.result && !step.commandOutput && (
                <MarkdownRenderer content={step.result} />
              )}
            </div>
          )}

          {/* Expand toggle */}
          {isExpandable && (
            <button
              onClick={(e) => { e.stopPropagation(); setExpanded(v => !v); }}
              className="mt-1 flex items-center gap-1 text-[10px] text-[#5a5a8a] hover:text-[#8888b8] transition-colors"
            >
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {expanded ? "Collapse" : "Show result"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Main stepper ──────────────────────────────────────────────────────────────

export function AutonomousStepper({
  session, onApprove, onSkip, onPause, onResume, onStop,
}: AutonomousStepperProps) {
  const done    = session.steps.filter(s => s.status === "done").length;
  const total   = session.steps.length;
  const pct     = total > 0 ? Math.round((done / total) * 100) : 0;
  const waiting = session.steps.find(s => s.status === "waiting_confirm");

  return (
    <div className="mx-4 my-2 rounded-2xl border border-violet-500/20 bg-[#09090f] overflow-hidden">

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between px-3.5 py-2.5 border-b border-violet-500/15 bg-violet-950/20">
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex items-center justify-center h-5 w-5 rounded-md bg-violet-600/30 border border-violet-500/30 shrink-0">
            <Sparkles className="h-3 w-3 text-violet-400" />
          </div>
          <div className="min-w-0">
            <p className="text-[11px] font-bold text-violet-400 uppercase tracking-widest">
              Autonomous Agent
            </p>
            <p className="text-[11px] text-[#9898b8] truncate max-w-[260px]">
              {session.task}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Progress pill */}
          <span className="text-[10px] font-semibold text-[#7070a0] bg-[#12121c] border border-[#2a2a3c] px-2 py-0.5 rounded-full">
            {done}/{total}
          </span>

          {/* Pause / Resume */}
          {session.isRunning && !session.isComplete && !session.isStopped && (
            <button
              onClick={session.isPaused ? onResume : onPause}
              className="h-6 w-6 flex items-center justify-center rounded-lg text-[#7878a8]
                hover:text-amber-400 hover:bg-amber-500/10 transition-all"
              title={session.isPaused ? "Resume" : "Pause"}
            >
              {session.isPaused
                ? <Play className="h-3 w-3" />
                : <Pause className="h-3 w-3" />}
            </button>
          )}

          {/* Stop */}
          {!session.isComplete && !session.isStopped && (
            <button
              onClick={onStop}
              className="h-6 w-6 flex items-center justify-center rounded-lg text-[#7878a8]
                hover:text-red-400 hover:bg-red-500/10 transition-all"
              title="Stop autonomous session"
            >
              <Square className="h-3 w-3" />
            </button>
          )}

          {/* Retry icon when stopped */}
          {session.isStopped && (
            <span className="text-[10px] text-red-400 font-medium">Stopped</span>
          )}
        </div>
      </div>

      {/* ── Progress bar ─────────────────────────────────────────────────── */}
      {total > 0 && (
        <div className="h-0.5 bg-[#1a1a2e]">
          <div
            className="h-full bg-gradient-to-r from-violet-600 to-violet-400 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
      )}

      {/* ── Paused banner ────────────────────────────────────────────────── */}
      {session.isPaused && !session.isComplete && (
        <div className="flex items-center gap-2 px-3.5 py-2 bg-amber-950/30 border-b border-amber-500/20">
          <Pause className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <p className="text-[11px] text-amber-300">
            Paused — click <strong>▶</strong> to continue or <strong>■</strong> to stop.
          </p>
        </div>
      )}

      {/* ── Steps list ───────────────────────────────────────────────────── */}
      <div className="px-3.5 py-3 space-y-1">
        {session.steps.map(step => (
          <StepRow
            key={step.id}
            step={step}
            onApprove={onApprove}
            onSkip={onSkip}
          />
        ))}

        {/* Waiting banner */}
        {waiting && (
          <div className="flex items-center gap-1.5 mt-1 text-[10px] text-amber-400/80 animate-pulse">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Waiting for your approval on step {waiting.index + 1}…
          </div>
        )}
      </div>

      {/* ── Complete footer ───────────────────────────────────────────────── */}
      {session.isComplete && (
        <div className="flex items-center gap-2 px-3.5 py-2.5 border-t border-emerald-500/15 bg-emerald-950/15">
          <Check className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
          <p className="text-[11px] text-emerald-300 font-medium">
            All {total} steps completed successfully.
          </p>
        </div>
      )}
    </div>
  );
}
