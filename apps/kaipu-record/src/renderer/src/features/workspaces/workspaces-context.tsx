import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslations } from "@kaipu/i18n";
import type {
  WorkspaceRemoveResult,
  WorkspacesState,
  WorkspaceSwitchRefusal,
  WorkspaceView,
} from "@shared/types/workspaces";
import { showToast } from "@renderer/ui/toast-store";

export interface Workspaces {
  /** Null until the first list answer. */
  state: WorkspacesState | null;
  /**
   * Bumped by every switch (a new generation), never by the first answer: keyed on it, the
   * routes remount, so nothing of the old workspace (an editor, a list, a filter, a cached
   * thumbnail URL) stays mounted.
   */
  epoch: number;
  active: WorkspaceView | null;
  /** The switcher menu (one, in the header); the Record page's Switch opens it too. */
  menuOpen: boolean;
  setMenuOpen(open: boolean): void;
  switchTo(id: string): Promise<void>;
  add(): Promise<void>;
  remove(id: string): Promise<WorkspaceRemoveResult>;
  openFolder(id: string): void;
  dismissHint(): void;
}

const WorkspacesContext = createContext<Workspaces | null>(null);

/**
 * The window's view of the workspace registry (ADR 0032): listed on mount and replaced by
 * every `workspaces:changed`, which main sends after a switch, an add, a remove, or a lock
 * change (a take starting or ending). Mounted above the routes, so it survives the remount
 * a switch causes.
 */
export function WorkspacesProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const t = useTranslations("workspaces");
  const [state, setState] = useState<WorkspacesState | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [epoch, setEpoch] = useState(0);
  const generation = useRef<number | null>(null);

  useEffect(() => {
    let alive = true;
    const off = window.electronAPI.workspaces.onChanged((next) => {
      if (!alive) return;
      if (generation.current !== null && generation.current !== next.generation) {
        setEpoch((n) => n + 1);
        setMenuOpen(false);
      }
      generation.current = next.generation;
      setState(next);
    });
    void window.electronAPI.workspaces
      .list()
      .then((first) => {
        // A broadcast that already arrived is newer than this answer.
        if (!alive || generation.current !== null) return;
        generation.current = first.generation;
        setState(first);
      })
      .catch((error: unknown) => console.error("workspaces: list failed", error));
    return () => {
      alive = false;
      off();
    };
  }, []);

  const active = useMemo(
    () => state?.workspaces.find((w) => w.id === state.activeId) ?? null,
    [state],
  );

  const explain = useCallback(
    (reason: WorkspaceSwitchRefusal, target: WorkspaceView | undefined): void => {
      // Cancelled is the user's own answer (Keep editing); it needs no toast.
      if (reason === "cancelled" || reason === "unknown") return;
      const message =
        reason === "unavailable"
          ? t("switchRefusedUnavailable", { name: target?.name ?? "" })
          : reason === "read-only"
            ? t("readOnly")
            : t("switchRefusedBusy");
      showToast({ message });
    },
    [t],
  );

  const switchTo = useCallback(
    async (id: string): Promise<void> => {
      setMenuOpen(false);
      const result = await window.electronAPI.workspaces.switch(id);
      if (!result.ok)
        explain(
          result.reason,
          state?.workspaces.find((w) => w.id === id),
        );
    },
    [explain, state],
  );

  const add = useCallback(async (): Promise<void> => {
    setMenuOpen(false);
    const result = await window.electronAPI.workspaces.add();
    if (!result.ok && result.reason === "read-only") showToast({ message: t("readOnly") });
  }, [t]);

  const value = useMemo<Workspaces>(
    () => ({
      state,
      epoch,
      active,
      menuOpen,
      setMenuOpen,
      switchTo,
      add,
      remove: (id) => window.electronAPI.workspaces.remove(id),
      openFolder: (id) => void window.electronAPI.workspaces.openFolder(id),
      dismissHint: () => void window.electronAPI.workspaces.dismissHint(),
    }),
    [state, epoch, active, menuOpen, switchTo, add],
  );

  return <WorkspacesContext.Provider value={value}>{children}</WorkspacesContext.Provider>;
}

export function useWorkspaces(): Workspaces {
  const value = useContext(WorkspacesContext);
  if (!value) throw new Error("useWorkspaces must be used inside <WorkspacesProvider>");
  return value;
}

/** Same as `useWorkspaces`, or null outside the provider (pages rendered alone in tests). */
export function useOptionalWorkspaces(): Workspaces | null {
  return useContext(WorkspacesContext);
}
