/**
 * WelcomeModal — first-launch onboarding dialog.
 *
 * Shown automatically on the first visit (localStorage flag "vesper.welcomed"
 * absent) OR when the user explicitly opens it via the command palette.
 *
 * Views:
 *   "welcome"   — feature highlights + action buttons
 *   "templates" — template picker grid
 */

import { useState, useCallback } from "react";
import { toast } from "sonner";
import {
  X, Sparkles, MessageSquare, FolderOpen, TerminalSquare,
  Bot, Code2, ChevronRight, ArrowLeft, Loader2, Check,
} from "lucide-react";
import { useWorkspace } from "@/contexts/workspace-context";
import { TEMPLATES, scaffoldTemplate, type ProjectTemplate } from "@/lib/project-templates";

// ─── Types ────────────────────────────────────────────────────────────────────

type View = "welcome" | "templates";

interface WelcomeModalProps {
  open:    boolean;
  onClose: () => void;
}

// ─── Feature highlights ───────────────────────────────────────────────────────

const FEATURES = [
  {
    icon: <MessageSquare className="h-5 w-5 text-violet-400" />,
    label: "AI Chat",
    body:  "Ask questions, get explanations, and iterate on code with multiple AI models side-by-side.",
  },
  {
    icon: <Code2 className="h-5 w-5 text-sky-400" />,
    label: "Monaco Editor",
    body:  "Full-featured code editor with syntax highlighting, IntelliSense, and multi-tab support.",
  },
  {
    icon: <TerminalSquare className="h-5 w-5 text-emerald-400" />,
    label: "Terminal",
    body:  "Run scripts, install packages, and execute commands without leaving the browser.",
  },
  {
    icon: <Bot className="h-5 w-5 text-amber-400" />,
    label: "AI Agents",
    body:  "Autonomous agents that can read, write, and run code across your entire workspace.",
  },
] as const;

// ─── Language badge ───────────────────────────────────────────────────────────

function LangBadge({ lang }: { lang: ProjectTemplate["language"] }) {
  const styles: Record<string, string> = {
    python: "bg-sky-500/15 text-sky-400 border border-sky-500/20",
    js:     "bg-yellow-500/15 text-yellow-400 border border-yellow-500/20",
    multi:  "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  };
  const labels: Record<string, string> = {
    python: "Python",
    js:     "JavaScript",
    multi:  "Multi-lang",
  };
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${styles[lang]}`}>
      {labels[lang]}
    </span>
  );
}

// ─── Template card ────────────────────────────────────────────────────────────

interface TemplateCardProps {
  template: ProjectTemplate;
  selected: boolean;
  onSelect: () => void;
}

function TemplateCard({ template, selected, onSelect }: TemplateCardProps) {
  return (
    <button
      onClick={onSelect}
      className={`
        relative text-left rounded-xl border p-4 transition-all cursor-pointer
        ${selected
          ? "border-violet-500/60 bg-violet-500/10 ring-1 ring-violet-500/40"
          : "border-[#2a2a3c] bg-[#12121c] hover:border-[#3a3a5a] hover:bg-[#16162a]"}
      `}
    >
      {selected && (
        <span className="absolute top-3 right-3 flex items-center justify-center h-4 w-4 rounded-full bg-violet-500">
          <Check className="h-2.5 w-2.5 text-white" />
        </span>
      )}
      <div className="flex items-start gap-3">
        <span className="text-2xl leading-none mt-0.5">{template.emoji}</span>
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-[#e0e0ff] text-sm">{template.name}</span>
            <LangBadge lang={template.language} />
          </div>
          <p className="text-xs text-[#8888b8] mt-1 leading-relaxed line-clamp-2">
            {template.description}
          </p>
          <p className="text-[10px] text-[#5a5a8a] mt-1.5">
            {template.files.length} file{template.files.length !== 1 ? "s" : ""}
          </p>
        </div>
      </div>
    </button>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function WelcomeModal({ open, onClose }: WelcomeModalProps) {
  const { createWorkspace, switchWorkspace } = useWorkspace();

  const [view, setView]           = useState<View>("welcome");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy]           = useState(false);

  const handleClose = useCallback(() => {
    try { localStorage.setItem("vesper.welcomed", "1"); } catch { /* ignore */ }
    onClose();
    setTimeout(() => { setView("welcome"); setSelectedId(null); }, 300);
  }, [onClose]);

  // ── Create demo project ───────────────────────────────────────────────────

  const createDemo = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ws = await createWorkspace("vesper-demo");
      if (!ws) throw new Error("Workspace creation failed");
      const demo = TEMPLATES.find(t => t.id === "vesper-demo")!;
      await scaffoldTemplate(ws.relPath, demo);
      switchWorkspace(ws);
      toast.success("Demo project ready!", {
        description: "Open main.py to get started.",
      });
      handleClose();
    } catch (err: any) {
      toast.error("Could not create demo project", {
        description: err?.message ?? "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }, [busy, createWorkspace, switchWorkspace, handleClose]);

  // ── Create project from template ─────────────────────────────────────────

  const createFromTemplate = useCallback(async () => {
    if (!selectedId || busy) return;
    const tpl = TEMPLATES.find(t => t.id === selectedId);
    if (!tpl) return;
    setBusy(true);
    try {
      const ws = await createWorkspace(tpl.name.toLowerCase().replace(/\s+/g, "-"));
      if (!ws) throw new Error("Workspace creation failed");
      await scaffoldTemplate(ws.relPath, tpl);
      switchWorkspace(ws);
      toast.success(`"${tpl.name}" project created!`, {
        description: `Open ${tpl.files[0]?.path ?? "your workspace"} to get started.`,
      });
      handleClose();
    } catch (err: any) {
      toast.error("Could not create project", {
        description: err?.message ?? "Unknown error",
      });
    } finally {
      setBusy(false);
    }
  }, [selectedId, busy, createWorkspace, switchWorkspace, handleClose]);

  if (!open) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="fixed inset-0 z-[500] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Welcome to Vesper"
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Card */}
      <div className="relative z-10 w-full max-w-2xl rounded-2xl border border-[#2a2a3c] bg-[#0d0d18] shadow-2xl shadow-black/60 overflow-hidden flex flex-col max-h-[90vh]">

        {/* Close button */}
        <button
          onClick={handleClose}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-[#6868a8] hover:text-[#e0e0ff] hover:bg-[#1e1e30] transition-colors"
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>

        {/* ── Welcome view ─────────────────────────────────────────────────── */}
        {view === "welcome" && (
          <div className="flex flex-col">
            {/* Header */}
            <div className="pt-10 pb-6 px-8 text-center border-b border-[#1a1a2e]">
              <div className="inline-flex items-center justify-center h-12 w-12 rounded-xl bg-violet-600/20 border border-violet-500/30 mb-4">
                <Sparkles className="h-6 w-6 text-violet-400" />
              </div>
              <h1 className="text-2xl font-bold text-[#e8e8ff] tracking-tight">
                Welcome to Vesper
              </h1>
              <p className="mt-2 text-sm text-[#8888b8] max-w-md mx-auto leading-relaxed">
                Your AI-powered coding environment. Chat, code, and deploy — all in one place.
              </p>
            </div>

            {/* Feature grid */}
            <div className="grid grid-cols-2 gap-3 p-6">
              {FEATURES.map(f => (
                <div
                  key={f.label}
                  className="flex gap-3 rounded-xl border border-[#1e1e30] bg-[#10101c] p-4"
                >
                  <div className="mt-0.5 shrink-0">{f.icon}</div>
                  <div>
                    <p className="text-sm font-semibold text-[#d0d0f0]">{f.label}</p>
                    <p className="text-xs text-[#7070a0] leading-relaxed mt-0.5">{f.body}</p>
                  </div>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-col gap-2.5 px-6 pb-8">
              {/* Create demo */}
              <button
                onClick={createDemo}
                disabled={busy}
                className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl font-semibold text-sm bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-wait text-white transition-colors shadow-lg shadow-violet-600/20"
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                {busy ? "Creating…" : "Create Demo Project"}
              </button>

              {/* From template */}
              <button
                onClick={() => setView("templates")}
                disabled={busy}
                className="flex items-center justify-center gap-2 w-full px-5 py-3 rounded-xl font-semibold text-sm border border-[#2a2a3c] bg-[#0d0d18] hover:bg-[#16162a] hover:border-[#3a3a5a] disabled:opacity-50 text-[#c0c0e8] transition-colors"
              >
                <FolderOpen className="h-4 w-4" />
                New Project from Template
                <ChevronRight className="h-3.5 w-3.5 ml-auto text-[#4a4a7a]" />
              </button>

              {/* Skip */}
              <button
                onClick={handleClose}
                className="mt-1 text-xs text-[#5a5a8a] hover:text-[#9090b8] transition-colors mx-auto"
              >
                Skip for now — I'll explore on my own
              </button>
            </div>
          </div>
        )}

        {/* ── Template picker view ──────────────────────────────────────────── */}
        {view === "templates" && (
          <div className="flex flex-col min-h-0">
            {/* Header */}
            <div className="flex items-center gap-3 px-6 py-5 border-b border-[#1a1a2e]">
              <button
                onClick={() => setView("welcome")}
                className="p-1.5 rounded-lg text-[#6868a8] hover:text-[#e0e0ff] hover:bg-[#1e1e30] transition-colors"
                aria-label="Back"
              >
                <ArrowLeft className="h-4 w-4" />
              </button>
              <div>
                <h2 className="text-base font-bold text-[#e0e0ff]">Choose a Template</h2>
                <p className="text-xs text-[#6868a8]">Pick one to scaffold your new workspace</p>
              </div>
            </div>

            {/* Template grid */}
            <div className="overflow-y-auto flex-1 p-5">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {TEMPLATES.map(tpl => (
                  <TemplateCard
                    key={tpl.id}
                    template={tpl}
                    selected={selectedId === tpl.id}
                    onSelect={() => setSelectedId(
                      selectedId === tpl.id ? null : tpl.id
                    )}
                  />
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="p-5 border-t border-[#1a1a2e] flex gap-3">
              <button
                onClick={() => setView("welcome")}
                className="flex-1 px-4 py-2.5 rounded-xl text-sm font-medium border border-[#2a2a3c] text-[#8888b8] hover:text-[#c0c0e8] hover:border-[#3a3a5a] transition-colors"
              >
                Back
              </button>
              <button
                onClick={createFromTemplate}
                disabled={!selectedId || busy}
                className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-violet-600 hover:bg-violet-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {busy ? "Creating…" : "Create Project"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
