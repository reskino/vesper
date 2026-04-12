/**
 * PanelErrorBoundary — catches render errors in IDE panels and shows a
 * friendly dark-themed fallback instead of a blank/broken screen.
 *
 * Usage:
 *   <PanelErrorBoundary label="Editor">
 *     <EditorPanel />
 *   </PanelErrorBoundary>
 */

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

interface Props {
  children:  ReactNode;
  /** Human-readable name shown in the error card (e.g. "Editor", "Chat") */
  label?:    string;
  /** Optional custom fallback element */
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error:    Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[PanelErrorBoundary:${this.props.label ?? "panel"}]`, error, info.componentStack);
  }

  recover = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;

    if (this.props.fallback) return this.props.fallback;

    const { label = "Panel", error } = { ...this.props, ...this.state };

    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 bg-background">
        <div className="flex flex-col items-center gap-3 max-w-xs text-center">
          <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20
            flex items-center justify-center">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
          </div>

          <div>
            <p className="text-sm font-semibold text-foreground">{label} encountered an error</p>
            <p className="text-xs text-[#6868a8] mt-1">
              Something went wrong rendering this panel. Your work is safe.
            </p>
          </div>

          {error?.message && (
            <pre className="w-full bg-[#0a0a12] border border-[#1a1a28] rounded-lg
              px-3 py-2 text-[11px] font-mono text-rose-300 overflow-x-auto text-left
              max-h-24 whitespace-pre-wrap">
              {error.message}
            </pre>
          )}

          <button
            onClick={this.recover}
            className="flex items-center gap-2 h-8 px-4 rounded-lg
              bg-[#111120] border border-[#1e1e30]
              text-xs font-medium text-[#9898b8]
              hover:text-foreground hover:bg-[#1a1a2e] hover:border-[#2a2a40]
              transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            Try again
          </button>
        </div>
      </div>
    );
  }
}
