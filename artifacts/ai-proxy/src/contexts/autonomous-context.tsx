/**
 * AutonomousContext — global toggle and safety-level state for Autonomous Agent Mode.
 *
 * When enabled, complex requests in the chat panel trigger a multi-step
 * orchestrated execution loop instead of a single AI call.
 *
 * Safety levels:
 *   conservative — ask for confirmation before every file write and terminal run
 *   balanced     — auto-approve single-file edits, confirm terminal commands
 *   aggressive   — auto-approve everything (power users)
 */

import {
  createContext, useCallback, useContext, useState, type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export type SafetyLevel = "conservative" | "balanced" | "aggressive";

export const SAFETY_META: Record<SafetyLevel, { label: string; icon: string; description: string }> = {
  conservative: {
    label:       "Conservative",
    icon:        "🛡️",
    description: "Confirm every file write and command before executing",
  },
  balanced: {
    label:       "Balanced",
    icon:        "⚖️",
    description: "Auto-approve single-file edits; confirm terminal commands",
  },
  aggressive: {
    label:       "Aggressive",
    icon:        "⚡",
    description: "Auto-approve all actions — no confirmation required",
  },
};

interface AutonomousContextValue {
  /** Whether autonomous agent mode is currently enabled */
  isEnabled:      boolean;
  toggleEnabled:  () => void;
  /** Current safety gate level */
  safetyLevel:    SafetyLevel;
  setSafetyLevel: (l: SafetyLevel) => void;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AutonomousContext = createContext<AutonomousContextValue>({
  isEnabled:      false,
  toggleEnabled:  () => {},
  safetyLevel:    "balanced",
  setSafetyLevel: () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────

const ENABLED_KEY      = "vesper.autoMode.enabled";
const SAFETY_KEY       = "vesper.autoMode.safety";
const VALID_SAFETY: SafetyLevel[] = ["conservative", "balanced", "aggressive"];

function readEnabled(): boolean {
  try { return localStorage.getItem(ENABLED_KEY) === "true"; } catch { return false; }
}

function readSafety(): SafetyLevel {
  try {
    const v = localStorage.getItem(SAFETY_KEY) as SafetyLevel | null;
    if (v && VALID_SAFETY.includes(v)) return v;
  } catch {}
  return "balanced";
}

export function AutonomousProvider({ children }: { children: ReactNode }) {
  const [isEnabled, setEnabled]       = useState<boolean>(readEnabled);
  const [safetyLevel, setSafetyState] = useState<SafetyLevel>(readSafety);

  const toggleEnabled = useCallback(() => {
    setEnabled(prev => {
      const next = !prev;
      try { localStorage.setItem(ENABLED_KEY, String(next)); } catch {}
      return next;
    });
  }, []);

  const setSafetyLevel = useCallback((l: SafetyLevel) => {
    setSafetyState(l);
    try { localStorage.setItem(SAFETY_KEY, l); } catch {}
  }, []);

  return (
    <AutonomousContext.Provider value={{ isEnabled, toggleEnabled, safetyLevel, setSafetyLevel }}>
      {children}
    </AutonomousContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAutonomous() {
  return useContext(AutonomousContext);
}
