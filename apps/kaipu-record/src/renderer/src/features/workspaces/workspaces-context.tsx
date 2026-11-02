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
  WorkspaceCreateResult,
  WorkspaceEditResult,
  WorkspaceRelocateResult,
  WorkspaceRemoveResult,
  WorkspacesState,
  WorkspaceSwitchRefusal,
  WorkspaceView,
} from "@shared/types/workspaces";
import { showToast } from "@renderer/ui/toast-store";
import { relocateRefusalMessage } from "./relocate-copy";
import { WorkspaceDialog } from "./workspace-dialog";
import { MoveExportsDialogHost } from "./move/move-exports-dialog";

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
  /** "Use an existing folder…": the folder picker, then adopt the folder and switch to it. */
  add(): Promise<void>;
  /**
   * "New workspace…": the dialog (name, color, location). With `forMove`, the new workspace
   * stays inactive and is handed to `forMove.onCreated` ("Move to ▸ New workspace…");
   * `onCancelled` runs when the dialog closes without one.
   */
  openCreateDialog(forMove?: CreateForMove): void;
  /** "Edit": the same dialog on an existing workspace (name and color). */
  openEditDialog(id: string): void;
  remove(id: string): Promise<WorkspaceRemoveResult>;
  openFolder(id: string): void;
  /**
   * "Change folder…": the native picker, then the workspace points at the folder where it now
   * lives (never moves files). A refusal is explained in a toast.
   */
  changeFolder(id: string): Promise<void>;
  dismissHint(): void;
}

/** "Move to ▸ New workspace…": create (or adopt) it inactive, then move into it. */
export interface CreateForMove {
  onCreated(workspace: WorkspaceView): void;
  onCancelled(): void;
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
  // The dialog: "new", or the id of the workspace being edited.
  const [dialog, setDialog] = useState<"new" | { editId: string } | null>(null);
  // Set while the dialog was opened from "Move to ▸ New workspace…".
  const forMove = useRef<CreateForMove | null>(null);
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
            : reason === "moving"
              ? t("lockedMoving")
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

  const openCreateDialog = useCallback((move?: CreateForMove): void => {
    setMenuOpen(false);
    forMove.current?.onCancelled();
    forMove.current = move ?? null;
    setDialog("new");
  }, []);

  /** The dialog closed without a workspace: a pending "Move to ▸ New workspace…" moves nothing. */
  const closeDialog = useCallback((): void => {
    setDialog(null);
    const move = forMove.current;
    forMove.current = null;
    move?.onCancelled();
  }, []);

  /** "Use an existing folder…" from the dialog: the folder picker, then adopt the folder. */
  const adoptExisting = useCallback(async (): Promise<void> => {
    setDialog(null);
    const move = forMove.current;
    forMove.current = null;
    if (!move) return add();
    const result = await window.electronAPI.workspaces.add({ activate: false });
    if (result.ok) move.onCreated(result.workspace);
    else {
      if (result.reason === "read-only") showToast({ message: t("readOnly") });
      move.onCancelled();
    }
  }, [add, t]);

  const openEditDialog = useCallback((id: string): void => {
    setMenuOpen(false);
    setDialog({ editId: id });
  }, []);

  const onCreated = useCallback(
    (result: Extract<WorkspaceCreateResult, { ok: true }>): void => {
      setDialog(null);
      const move = forMove.current;
      forMove.current = null;
      if (move) return move.onCreated(result.workspace);
      // The workspace exists either way; only the switch to it can have been refused.
      if (!result.switchResult.ok) explain(result.switchResult.reason, result.workspace);
    },
    [explain],
  );

  const onSaved = useCallback(
    (result: Extract<WorkspaceEditResult, { ok: true }>): void => {
      setDialog(null);
      if (!result.savedToFolder) {
        showToast({ message: t("editSavedOffline", { name: result.workspace.name }) });
      }
    },
    [t],
  );

  const onRelocated = useCallback(
    (result: Extract<WorkspaceRelocateResult, { ok: true }>): void => {
      // The picker opens on the current folder, so picking it as-is is easy: say nothing.
      if (result.unchanged) return;
      showToast({ message: t("folderChanged", { name: result.workspace.name }) });
    },
    [t],
  );

  const changeFolder = useCallback(
    async (id: string): Promise<void> => {
      let result: Awaited<ReturnType<typeof window.electronAPI.workspaces.relocate>>;
      try {
        result = await window.electronAPI.workspaces.relocate(id);
      } catch {
        // Rejected after main may already have applied the new folder: the result is unknown.
        showToast({ message: t("relocateUncertain") });
        return;
      }
      if (result.ok) {
        onRelocated(result);
        return;
      }
      const name = state?.workspaces.find((w) => w.id === id)?.name ?? "";
      const message = relocateRefusalMessage(result, name, t);
      if (message) showToast({ message });
    },
    [onRelocated, state, t],
  );

  const remove = useCallback(
    async (id: string): Promise<WorkspaceRemoveResult> => {
      const result = await window.electronAPI.workspaces.remove(id);
      if (!result.ok) {
        // A race can refuse it (it became the active one after the dialog opened): the
        // dialog is gone, so the toast is the only place the reason can show.
        const name = state?.workspaces.find((w) => w.id === id)?.name ?? "";
        const message =
          result.reason === "active"
            ? t("removeRefusedActive", { name })
            : result.reason === "last"
              ? t("removeRefusedLast")
              : result.reason === "read-only"
                ? t("readOnly")
                : t("removeRefusedUnknown");
        showToast({ message });
      }
      return result;
    },
    [state, t],
  );

  const value = useMemo<Workspaces>(
    () => ({
      state,
      epoch,
      active,
      menuOpen,
      setMenuOpen,
      switchTo,
      add,
      openCreateDialog,
      openEditDialog,
      remove,
      openFolder: (id) => void window.electronAPI.workspaces.openFolder(id),
      changeFolder,
      dismissHint: () => void window.electronAPI.workspaces.dismissHint(),
    }),
    [
      state,
      epoch,
      active,
      menuOpen,
      switchTo,
      add,
      openCreateDialog,
      openEditDialog,
      remove,
      changeFolder,
    ],
  );

  const editing =
    dialog && dialog !== "new"
      ? (state?.workspaces.find((w) => w.id === dialog.editId) ?? null)
      : null;
  // An edit of a workspace that left the list meanwhile has nothing to show.
  const showDialog = state !== null && (dialog === "new" || (dialog !== null && editing !== null));

  return (
    <WorkspacesContext.Provider value={value}>
      {children}
      <MoveExportsDialogHost />
      {showDialog && state && (
        <WorkspaceDialog
          // A fresh form per target: the fields start from that workspace, not the last one.
          key={editing?.id ?? "new"}
          state={state}
          editing={editing}
          activate={forMove.current === null}
          onClose={closeDialog}
          onUseExisting={() => void adoptExisting()}
          onCreated={onCreated}
          onSaved={onSaved}
          onRelocated={onRelocated}
        />
      )}
    </WorkspacesContext.Provider>
  );
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
