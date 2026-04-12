/**
 * ExportMenu — Chat export dropdown for the Vesper IDE.
 *
 * Three export paths:
 *  • PDF           : beautifully styled print-window → browser's Save as PDF
 *  • Word (.docx)  : Python backend (python-docx) with rich styling;
 *                    automatic client-side fallback if backend unavailable
 *  • Save to Workspace : writes conversation as a .md file into the active workspace
 *
 * Integration: <ExportMenu messages={messages} workspaceName={...} workspacePath={...} />
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { Download, FileText, Printer, Loader2, ChevronDown, FolderInput } from "lucide-react";
import { toast } from "sonner";
import {
  exportChatAsPdf,
  exportChatAsDocxBackend,
  saveChatToWorkspace,
  type ExportMessage,
} from "@/lib/export-chat";

interface ExportMenuProps {
  messages: ExportMessage[];
  workspaceName?: string;
  agentLabel?: string;
  /**
   * Workspace-relative path for "Save to Workspace".
   * Defaults to auto-generated slug based on first user message.
   */
  workspacePath?: string;
  /** compact=true: icon-only button (mobile / narrow layouts) */
  compact?: boolean;
}

export function ExportMenu({
  messages,
  workspaceName,
  agentLabel,
  workspacePath,
  compact = false,
}: ExportMenuProps) {
  const [open, setOpen]       = useState(false);
  const [loading, setLoading] = useState<"pdf" | "docx" | "md" | null>(null);
  const menuRef               = useRef<HTMLDivElement>(null);

  // Dismiss on click-outside or Escape
  useEffect(() => {
    if (!open) return;
    const onKey   = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    const onClick = (e: MouseEvent)    => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown",   onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown",   onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // Build a sane export title from the first user message or workspace name
  const buildTitle = useCallback(() => {
    const firstUser = messages.find(m => m.role === "user")?.content;
    if (firstUser) {
      const snippet = firstUser.slice(0, 60).replace(/\n/g, " ").trim();
      return snippet.length === firstUser.length ? snippet : snippet + "…";
    }
    return workspaceName ? `${workspaceName} — Chat` : "Vesper Chat Export";
  }, [messages, workspaceName]);

  const sharedOpts = useCallback(() => ({
    title:         buildTitle(),
    workspaceName,
    agentLabel,
    messages,
  }), [buildTitle, workspaceName, agentLabel, messages]);

  // ── PDF ─────────────────────────────────────────────────────────────────────
  const handlePdf = useCallback(async () => {
    setLoading("pdf");
    setOpen(false);
    try {
      exportChatAsPdf(sharedOpts());
      toast.success("Print dialog opened — choose 'Save as PDF' to download.");
    } catch (err) {
      console.error("[ExportMenu] PDF error:", err);
      toast.error("PDF export failed. Please try again.");
    } finally {
      setLoading(null);
    }
  }, [sharedOpts]);

  // ── Word (.docx) via Python backend ─────────────────────────────────────────
  const handleDocx = useCallback(async () => {
    setLoading("docx");
    setOpen(false);
    const toastId = toast.loading("Generating Word document…");
    try {
      await exportChatAsDocxBackend(sharedOpts());
      toast.success("Word document downloaded successfully.", { id: toastId });
    } catch (err) {
      console.error("[ExportMenu] Word error:", err);
      toast.error("Word export failed. Please try again.", { id: toastId });
    } finally {
      setLoading(null);
    }
  }, [sharedOpts]);

  // ── Save to Workspace as Markdown ────────────────────────────────────────────
  const handleSaveToWorkspace = useCallback(async () => {
    setLoading("md");
    setOpen(false);
    try {
      const savedPath = await saveChatToWorkspace({
        ...sharedOpts(),
        workspacePath,
      });
      toast.success(`Saved to workspace: ${savedPath}`);
    } catch (err: any) {
      console.error("[ExportMenu] Save to workspace error:", err);
      toast.error(err?.message ?? "Could not save to workspace. Please try again.");
    } finally {
      setLoading(null);
    }
  }, [sharedOpts, workspacePath]);

  if (messages.length === 0) return null;

  const isLoading = loading !== null;
  const loadingIcon =
    loading === "pdf"  ? <Printer className="h-3 w-3 animate-pulse" /> :
    loading === "docx" ? <Loader2 className="h-3 w-3 animate-spin"  /> :
    loading === "md"   ? <Loader2 className="h-3 w-3 animate-spin"  /> :
    null;

  return (
    <div ref={menuRef} className="relative">
      {/* ── Trigger ─────────────────────────────────────────────────────────── */}
      <button
        onClick={() => setOpen(o => !o)}
        disabled={isLoading}
        className={`flex items-center gap-1 h-6 rounded-lg text-[#7878a8]
          hover:text-foreground hover:bg-[#111118] disabled:opacity-40
          transition-all duration-150 ${compact ? "w-6 justify-center" : "px-2"}`}
        title="Export chat"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {isLoading
          ? loadingIcon
          : <Download className="h-3 w-3 shrink-0" />
        }
        {!compact && (
          <>
            <span className="text-[11px] font-medium">Export</span>
            <ChevronDown className={`h-2.5 w-2.5 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
          </>
        )}
      </button>

      {/* ── Dropdown ────────────────────────────────────────────────────────── */}
      {open && (
        <div
          className="absolute right-0 top-full mt-1.5 z-[250]
            min-w-[210px] py-1 rounded-xl
            bg-[#0e0e16] border border-[#1e1e30]
            shadow-[0_8px_40px_rgba(0,0,0,0.6)]
            text-sm text-foreground
            animate-in fade-in slide-in-from-top-2 duration-100"
          role="menu"
        >
          {/* Section label */}
          <div className="px-3 pt-1 pb-1.5 border-b border-[#1a1a28]">
            <p className="text-[10px] font-semibold text-[#4a4a72] uppercase tracking-widest">
              Export {messages.length} message{messages.length !== 1 ? "s" : ""}
            </p>
          </div>

          {/* ── PDF ── */}
          <button
            onClick={handlePdf}
            className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#1a1a2e] transition-colors text-left"
            role="menuitem"
          >
            <Printer className="h-4 w-4 text-rose-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Save as PDF</p>
              <p className="text-[10px] text-[#5858a0] mt-0.5">Opens print dialog — save from browser</p>
            </div>
          </button>

          {/* ── Word ── */}
          <button
            onClick={handleDocx}
            className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#1a1a2e] transition-colors text-left"
            role="menuitem"
          >
            <FileText className="h-4 w-4 text-sky-400 mt-0.5 shrink-0" />
            <div>
              <p className="text-xs font-semibold">Download Word (.docx)</p>
              <p className="text-[10px] text-[#5858a0] mt-0.5">Editable document — styled via AI backend</p>
            </div>
          </button>

          {/* ── Save to Workspace ── */}
          <div className="border-t border-[#1a1a28] mt-1 pt-1">
            <button
              onClick={handleSaveToWorkspace}
              className="w-full flex items-start gap-3 px-3 py-2.5 hover:bg-[#1a1a2e] transition-colors text-left"
              role="menuitem"
            >
              <FolderInput className="h-4 w-4 text-emerald-400 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold">Save to Workspace</p>
                <p className="text-[10px] text-[#5858a0] mt-0.5">
                  {workspaceName
                    ? `Write .md file to ${workspaceName}`
                    : "Write Markdown file to workspace"}
                </p>
              </div>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
