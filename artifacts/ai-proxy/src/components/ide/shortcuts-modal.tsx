/**
 * ShortcutsModal — Keyboard shortcut reference for the Vesper IDE.
 *
 * Triggered by:
 *  • Pressing "?" when no text input is focused
 *  • Clicking the keyboard icon in the activity bar
 *  • Running the "Show Keyboard Shortcuts" command in the palette (Ctrl+K)
 *
 * Respects prefers-reduced-motion for the slide animation.
 */

import { useEffect, useRef } from "react";
import { X, Keyboard } from "lucide-react";
import { useIDE } from "@/contexts/ide-context";

// ── Data ──────────────────────────────────────────────────────────────────────

interface Shortcut {
  keys:    string[];   // each element is one key rendered as a <kbd>
  label:   string;
}

interface ShortcutGroup {
  title:     string;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Palette & Navigation",
    shortcuts: [
      { keys: ["Ctrl", "P"],         label: "Quick open file" },
      { keys: ["Ctrl", "⇧", "P"],   label: "Command palette" },
      { keys: ["Ctrl", "K"],         label: "Command palette (alt)" },
      { keys: ["?"],                 label: "Show this shortcut reference" },
      { keys: ["Esc"],               label: "Close overlay / dismiss output" },
    ],
  },
  {
    title: "Editor",
    shortcuts: [
      { keys: ["Ctrl", "S"],         label: "Save current file" },
      { keys: ["Ctrl", "W"],         label: "Close active tab" },
      { keys: ["Ctrl", "T"],         label: "Open new untitled tab" },
      { keys: ["Ctrl", "Tab"],       label: "Next tab" },
      { keys: ["Ctrl", "⇧", "Tab"], label: "Previous tab" },
      { keys: ["F5"],                label: "Run current file" },
      { keys: ["Alt", "Z"],          label: "Toggle word wrap" },
      { keys: ["Ctrl", "F"],         label: "Find in file" },
      { keys: ["Ctrl", "/"],         label: "Toggle line comment" },
    ],
  },
  {
    title: "Panels & Chat",
    shortcuts: [
      { keys: ["Ctrl", "J"],         label: "Toggle chat panel" },
      { keys: ["Ctrl", "B"],         label: "Toggle preview" },
      { keys: ["Ctrl", "`"],         label: "Toggle terminal" },
      { keys: ["Ctrl", "N"],         label: "New chat session" },
      { keys: ["Enter"],             label: "Send message" },
      { keys: ["⇧", "Enter"],       label: "New line in message" },
    ],
  },
  {
    title: "Tabs & Files",
    shortcuts: [
      { keys: ["Drag tab"],          label: "Reorder tabs" },
      { keys: ["Right-click tab"],   label: "Close / Close Others / Copy Path" },
    ],
  },
];

// ── Component ─────────────────────────────────────────────────────────────────

interface ShortcutsModalProps {
  open:    boolean;
  onClose: () => void;
}

export function ShortcutsModal({ open, onClose }: ShortcutsModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Focus the panel when opened for accessibility
  useEffect(() => {
    if (open) requestAnimationFrame(() => panelRef.current?.focus());
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[310] flex items-center justify-center p-4
        bg-black/65 backdrop-blur-sm motion-reduce:backdrop-blur-none"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-label="Keyboard shortcuts"
      aria-modal="true"
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className="relative w-full max-w-lg max-h-[85vh] flex flex-col
          bg-[#0c0c14] border border-[#1e1e30]
          rounded-2xl shadow-[0_24px_80px_rgba(0,0,0,0.8)]
          outline-none overflow-hidden
          animate-in fade-in zoom-in-95 duration-150
          motion-reduce:animate-none"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-[#1a1a28]">
          <Keyboard className="h-4 w-4 text-amber-400 shrink-0" aria-hidden />
          <h2 className="flex-1 text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
          <button
            onClick={onClose}
            className="h-6 w-6 flex items-center justify-center rounded-lg
              text-[#6868a8] hover:text-foreground hover:bg-[#111118]
              transition-colors"
            aria-label="Close shortcuts"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Shortcut groups */}
        <div
          className="overflow-y-auto flex-1 px-2 py-2"
          style={{ scrollbarWidth: "thin", scrollbarColor: "#1e1e30 transparent" }}
        >
          {SHORTCUT_GROUPS.map(group => (
            <section key={group.title} className="mb-3">
              <div className="px-3 py-1 text-[10px] font-semibold text-[#3a3a5a] uppercase tracking-widest">
                {group.title}
              </div>
              <div>
                {group.shortcuts.map((s, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between gap-4 px-3 py-2
                      rounded-lg hover:bg-[#111120] transition-colors group"
                  >
                    <span className="text-sm text-[#9898b8] group-hover:text-foreground transition-colors">
                      {s.label}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      {s.keys.map((k, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          {ki > 0 && (
                            <span className="text-[10px] text-[#3a3a5a]">+</span>
                          )}
                          <kbd
                            className="inline-block text-[11px] font-mono font-medium
                              text-[#a8a8d0] bg-[#111118] border border-[#1e1e30]
                              rounded-md px-1.5 py-0.5 min-w-[24px] text-center
                              shadow-[0_1px_0_#000]"
                          >
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-[#1a1a28]">
          <p className="text-[10px] text-[#3a3a5a]">
            Press <kbd className="font-mono bg-[#111118] border border-[#1e1e30] rounded px-1">?</kbd> anytime to re-open  ·  <kbd className="font-mono bg-[#111118] border border-[#1e1e30] rounded px-1">Esc</kbd> to close
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Convenience hook (wire ? key globally, used in IDELayout) ─────────────────

export function useShortcutsKey() {
  const { openShortcutsModal } = useIDE();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      // Monaco editor elements
      if ((e.target as HTMLElement)?.closest?.(".monaco-editor")) return;
      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        openShortcutsModal();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [openShortcutsModal]);
}
