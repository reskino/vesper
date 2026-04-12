/**
 * WorkspaceContext — per-project workspace management.
 *
 * A "workspace" is an isolated subdirectory under `workspaces/{slug}/` on
 * the backend.  Each workspace has its own files, .venv (Python) or
 * node_modules (JS), and metadata stored in `.vesper/workspace.json`.
 *
 * State is persisted to localStorage so the active workspace survives page
 * refreshes.  The workspace list is fetched from the API on mount and after
 * every create operation.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Workspace {
  id:       string;
  name:     string;
  language: "python" | "js" | "unknown";
  created:  string;
  /** Path relative to WORKSPACE_ROOT — used as `path` for the file-tree API */
  relPath:  string;
}

export interface InstalledDep {
  name:    string;
  version: string;
}

export interface WorkspaceDepsInfo {
  language: string;
  deps:     InstalledDep[];
  lockfile: string | null;
}

interface InstallState {
  status:  "idle" | "running" | "done" | "error";
  message: string;
}

interface WorkspaceContextValue {
  /** All known workspaces */
  workspaces:      Workspace[];
  /** The currently active workspace (null = no workspace selected) */
  currentWorkspace: Workspace | null;
  /** True while the workspace list is loading */
  isLoading:        boolean;

  /** Switch to an existing workspace (persisted) */
  switchWorkspace: (ws: Workspace | null) => void;

  /** Create a new workspace by name and switch to it */
  createWorkspace: (name: string) => Promise<Workspace | null>;

  /** Re-fetch the workspace list */
  refreshWorkspaces: () => Promise<void>;

  /** Install a package into the current workspace */
  installDep: (pkg: string, version?: string) => Promise<void>;

  /** Installed packages in the current workspace */
  deps:        InstalledDep[];
  /** Lockfile name if present (e.g. "uv.lock", "package-lock.json") */
  lockfile:    string | null;
  installState: InstallState;
  /** Tool used for last install (e.g. "uv add", "npm install") */
  lastInstallTool: string | null;
  /** Refresh the deps list */
  refreshDeps: () => Promise<void>;
}

// ── Storage ───────────────────────────────────────────────────────────────────

const STORAGE_KEY = "vesper_current_workspace";

function readStored(): Workspace | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Workspace;
  } catch {}
  return null;
}

function writeStored(ws: Workspace | null): void {
  try {
    if (ws) localStorage.setItem(STORAGE_KEY, JSON.stringify(ws));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {}
}

// ── API helpers ───────────────────────────────────────────────────────────────

const BASE = () =>
  (import.meta.env.BASE_URL ?? "/").replace(/\/$/, "");

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE()}/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

// ── Context ───────────────────────────────────────────────────────────────────

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [workspaces, setWorkspaces]         = useState<Workspace[]>([]);
  const [currentWorkspace, setCurrentWs]    = useState<Workspace | null>(readStored);
  const [isLoading, setIsLoading]           = useState(false);
  const [deps, setDeps]                     = useState<InstalledDep[]>([]);
  const [lockfile, setLockfile]             = useState<string | null>(null);
  const [lastInstallTool, setLastInstallTool] = useState<string | null>(null);
  const [installState, setInstallState]     = useState<InstallState>({
    status: "idle", message: "",
  });

  // Track fetch to avoid state updates after unmount
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // ── Fetch workspace list ─────────────────────────────────────────────────
  const refreshWorkspaces = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await apiFetch<{ workspaces: Workspace[] }>("/workspaces");
      if (!mountedRef.current) return;
      setWorkspaces(data.workspaces ?? []);
    } catch (err) {
      console.warn("[WorkspaceContext] Failed to load workspaces:", err);
    } finally {
      if (mountedRef.current) setIsLoading(false);
    }
  }, []);

  // Fetch on mount
  useEffect(() => { refreshWorkspaces(); }, [refreshWorkspaces]);

  // Sync currentWorkspace with the freshly-fetched list (in case slug changed)
  useEffect(() => {
    if (!currentWorkspace || workspaces.length === 0) return;
    const updated = workspaces.find(w => w.id === currentWorkspace.id);
    if (updated) {
      setCurrentWs(updated);
      writeStored(updated);
    }
  }, [workspaces]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Fetch deps ───────────────────────────────────────────────────────────
  const refreshDeps = useCallback(async () => {
    if (!currentWorkspace) { setDeps([]); setLockfile(null); return; }
    try {
      const data = await apiFetch<{ deps: InstalledDep[]; lockfile: string | null }>(
        `/workspaces/${currentWorkspace.id}/deps`,
      );
      if (!mountedRef.current) return;
      setDeps(data.deps ?? []);
      setLockfile(data.lockfile ?? null);
    } catch {
      if (mountedRef.current) { setDeps([]); setLockfile(null); }
    }
  }, [currentWorkspace]);

  useEffect(() => { refreshDeps(); }, [refreshDeps]);

  // ── Switch workspace ─────────────────────────────────────────────────────
  const switchWorkspace = useCallback((ws: Workspace | null) => {
    setCurrentWs(ws);
    writeStored(ws);
    setDeps([]);
    setLockfile(null);
    setLastInstallTool(null);
    setInstallState({ status: "idle", message: "" });
  }, []);

  // ── Create workspace ─────────────────────────────────────────────────────
  const createWorkspace = useCallback(async (name: string): Promise<Workspace | null> => {
    try {
      const data = await apiFetch<{ workspace: Workspace }>("/workspaces/create", {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      await refreshWorkspaces();
      const ws = data.workspace;
      if (ws) switchWorkspace(ws);
      return ws ?? null;
    } catch (err: any) {
      throw new Error(err?.message ?? "Failed to create workspace");
    }
  }, [refreshWorkspaces, switchWorkspace]);

  // ── Install dependency ───────────────────────────────────────────────────
  const installDep = useCallback(async (pkg: string, version?: string): Promise<void> => {
    if (!currentWorkspace) throw new Error("No workspace selected");
    setInstallState({ status: "running", message: `Installing ${pkg}…` });
    try {
      const data = await apiFetch<{ output: string; lockfile?: string | null; tool?: string }>(
        `/workspaces/${currentWorkspace.id}/install`,
        {
          method: "POST",
          body: JSON.stringify({ package: pkg, version: version || undefined }),
        },
      );
      if (data.lockfile) setLockfile(data.lockfile);
      if (data.tool) setLastInstallTool(data.tool);
      setInstallState({
        status:  "done",
        message: data.output?.slice(-300) || `${pkg} installed successfully`,
      });
      await refreshDeps();
      await refreshWorkspaces();
    } catch (err: any) {
      setInstallState({ status: "error", message: err?.message ?? "Install failed" });
      throw err;
    }
  }, [currentWorkspace, refreshDeps, refreshWorkspaces]);

  return (
    <WorkspaceContext.Provider value={{
      workspaces,
      currentWorkspace,
      isLoading,
      switchWorkspace,
      createWorkspace,
      refreshWorkspaces,
      installDep,
      deps,
      lockfile,
      lastInstallTool,
      installState,
      refreshDeps,
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace must be used within WorkspaceProvider");
  return ctx;
}
