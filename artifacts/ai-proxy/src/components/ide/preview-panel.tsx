import { useState, useRef, useCallback, useEffect } from "react";
import {
  Globe, RefreshCw, ExternalLink, X, ArrowLeft, ArrowRight,
  Maximize2, Minimize2, Smartphone, Monitor, Tablet, RotateCcw,
} from "lucide-react";
import { useIDE } from "@/contexts/ide-context";

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";

type Viewport = "desktop" | "tablet" | "mobile";

const VIEWPORT_SIZES: Record<Viewport, { width: string; label: string }> = {
  desktop: { width: "100%",  label: "Desktop" },
  tablet:  { width: "768px", label: "Tablet" },
  mobile:  { width: "375px", label: "Mobile" },
};

function localUrlToProxyUrl(url: string): string {
  const match = url.match(/https?:\/\/(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)(\/.*)?/);
  if (match) {
    const port = match[1];
    const path = match[2] ?? "/";
    return `${BASE_URL}/api/port-proxy/${port}${path}`;
  }
  return url;
}

export function extractPort(url: string): string | null {
  const m = url.match(/(?:0\.0\.0\.0|127\.0\.0\.1|localhost):(\d+)/);
  return m ? m[1] : null;
}

export function PreviewPanel() {
  const { previewUrl, setPreviewUrl, closePreview } = useIDE();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [urlInput, setUrlInput] = useState(previewUrl ?? "");
  const [viewport, setViewport] = useState<Viewport>("desktop");
  const [isMaximized, setIsMaximized] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (previewUrl) setUrlInput(previewUrl);
  }, [previewUrl]);

  const navigate = useCallback((url: string) => {
    const trimmed = url.trim();
    if (!trimmed) return;
    let normalized = trimmed;
    if (!/^https?:\/\//.test(normalized) && !normalized.startsWith("localhost")) {
      normalized = `http://localhost:${normalized}`;
    }
    if (/^localhost/.test(normalized)) {
      normalized = `http://${normalized}`;
    }
    setPreviewUrl(normalized);
    setUrlInput(normalized);
    setRefreshKey(k => k + 1);
  }, [setPreviewUrl]);

  const handleRefresh = useCallback(() => {
    setRefreshKey(k => k + 1);
    setIsLoading(true);
  }, []);

  const handleUrlSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    navigate(urlInput);
  }, [urlInput, navigate]);

  const proxiedUrl = previewUrl ? localUrlToProxyUrl(previewUrl) : null;
  const port = previewUrl ? extractPort(previewUrl) : null;

  return (
    <div className={`flex flex-col h-full bg-[#0a0a0e] ${isMaximized ? "fixed inset-0 z-[200]" : ""}`}>
      <div className="shrink-0 flex items-center gap-1.5 px-2 py-1.5 bg-[#0d0d12] border-b border-[#1a1a24]">
        <div className="flex items-center gap-1">
          <button
            onClick={() => iframeRef.current?.contentWindow?.history.back()}
            className="h-6 w-6 flex items-center justify-center rounded text-[#7878a8] hover:text-[#c0c0d8] hover:bg-[#1a1a28] transition-colors"
            title="Back"
          >
            <ArrowLeft style={{ width: 13, height: 13 }} />
          </button>
          <button
            onClick={() => iframeRef.current?.contentWindow?.history.forward()}
            className="h-6 w-6 flex items-center justify-center rounded text-[#7878a8] hover:text-[#c0c0d8] hover:bg-[#1a1a28] transition-colors"
            title="Forward"
          >
            <ArrowRight style={{ width: 13, height: 13 }} />
          </button>
          <button
            onClick={handleRefresh}
            className={`h-6 w-6 flex items-center justify-center rounded text-[#7878a8] hover:text-[#c0c0d8] hover:bg-[#1a1a28] transition-colors
              ${isLoading ? "animate-spin" : ""}`}
            title="Refresh"
          >
            <RefreshCw style={{ width: 13, height: 13 }} />
          </button>
        </div>

        <form onSubmit={handleUrlSubmit} className="flex-1 flex items-center min-w-0">
          <div className="relative flex-1 flex items-center min-w-0">
            <Globe className="absolute left-2 text-[#5858a8] pointer-events-none" style={{ width: 12, height: 12 }} />
            <input
              ref={inputRef}
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              placeholder="localhost:8000 or enter port number..."
              className="w-full h-7 pl-7 pr-2 rounded-md bg-[#0a0a0e] border border-[#1e1e2e] text-[12px] text-[#c0c0d8]
                placeholder:text-[#4a4a6a] focus:outline-none focus:border-[#6c63ff]/50 focus:ring-1 focus:ring-[#6c63ff]/20
                font-mono transition-colors"
            />
          </div>
        </form>

        <div className="flex items-center gap-0.5">
          {port && (
            <span className="px-1.5 py-0.5 rounded bg-emerald-500/15 text-emerald-400 text-[10px] font-bold mr-1">
              :{port}
            </span>
          )}
          <div className="flex items-center border border-[#1e1e2e] rounded-md overflow-hidden">
            {([
              { id: "desktop" as Viewport, icon: Monitor },
              { id: "tablet" as Viewport,  icon: Tablet },
              { id: "mobile" as Viewport,  icon: Smartphone },
            ]).map(({ id, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setViewport(id)}
                className={`h-6 w-6 flex items-center justify-center transition-colors
                  ${viewport === id
                    ? "bg-[#1a1a28] text-[#c0c0d8]"
                    : "text-[#5858a8] hover:text-[#8888b8] hover:bg-[#111118]"
                  }`}
                title={VIEWPORT_SIZES[id].label}
              >
                <Icon style={{ width: 12, height: 12 }} />
              </button>
            ))}
          </div>

          <button
            onClick={() => proxiedUrl && window.open(previewUrl!, "_blank")}
            className="h-6 w-6 flex items-center justify-center rounded text-[#7878a8] hover:text-[#c0c0d8] hover:bg-[#1a1a28] transition-colors"
            title="Open in new tab"
          >
            <ExternalLink style={{ width: 12, height: 12 }} />
          </button>
          <button
            onClick={() => setIsMaximized(v => !v)}
            className="h-6 w-6 flex items-center justify-center rounded text-[#7878a8] hover:text-[#c0c0d8] hover:bg-[#1a1a28] transition-colors"
            title={isMaximized ? "Restore" : "Maximize"}
          >
            {isMaximized
              ? <Minimize2 style={{ width: 12, height: 12 }} />
              : <Maximize2 style={{ width: 12, height: 12 }} />
            }
          </button>
          <button
            onClick={closePreview}
            className="h-6 w-6 flex items-center justify-center rounded text-[#7878a8] hover:text-red-400 hover:bg-[#1a1a28] transition-colors"
            title="Close preview"
          >
            <X style={{ width: 13, height: 13 }} />
          </button>
        </div>
      </div>

      <div className="flex-1 flex items-start justify-center overflow-auto bg-[#08080c]">
        {proxiedUrl ? (
          <div
            className="h-full transition-all duration-200"
            style={{
              width: VIEWPORT_SIZES[viewport].width,
              maxWidth: "100%",
              ...(viewport !== "desktop" ? {
                border: "1px solid #1e1e2e",
                borderTop: "none",
                margin: "0 auto",
              } : {}),
            }}
          >
            <iframe
              ref={iframeRef}
              key={refreshKey}
              src={proxiedUrl}
              onLoad={() => setIsLoading(false)}
              className="w-full h-full border-none bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
              title="Preview"
            />
          </div>
        ) : (
          <div className="flex-1 h-full flex flex-col items-center justify-center gap-4">
            <div className="h-16 w-16 rounded-2xl bg-[#111118] border border-[#1e1e2e] flex items-center justify-center">
              <Globe className="text-[#4a4a6a]" style={{ width: 28, height: 28 }} />
            </div>
            <div className="text-center">
              <p className="text-[#8888b8] text-sm font-medium">No preview URL</p>
              <p className="text-[#5858a8] text-xs mt-1">
                Enter a port number or URL above, or run a server to see it here
              </p>
            </div>
            <div className="flex gap-2 mt-2">
              {["3000", "5000", "8000", "8080"].map(p => (
                <button
                  key={p}
                  onClick={() => navigate(`http://localhost:${p}`)}
                  className="px-3 py-1.5 rounded-lg bg-[#111118] border border-[#1e1e2e] text-[#8888b8] text-xs font-mono
                    hover:border-[#6c63ff]/40 hover:text-[#c0c0d8] transition-colors"
                >
                  :{p}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
