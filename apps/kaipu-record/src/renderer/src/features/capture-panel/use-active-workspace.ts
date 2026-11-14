import { useEffect, useState } from "react";
import type { WorkspacesState, WorkspaceView } from "@shared/types/workspaces";

/**
 * The workspace the next take lands in, for a window that has no WorkspacesProvider (the
 * tray panel). Reads the registry once and follows every `workspaces:changed`; null until
 * the first answer. The panel only names the workspace, so there is no switch logic here.
 */
export function useActiveWorkspace(): WorkspaceView | null {
  const [state, setState] = useState<WorkspacesState | null>(null);

  useEffect(() => {
    let alive = true;
    let broadcastSeen = false;
    const off = window.electronAPI.workspaces.onChanged((next) => {
      if (!alive) return;
      broadcastSeen = true;
      setState(next);
    });
    void window.electronAPI.workspaces
      .list()
      .then((first) => {
        // A broadcast that already arrived is newer than this answer.
        if (alive && !broadcastSeen) setState(first);
      })
      .catch((error: unknown) => console.error("capture panel: workspaces list failed", error));
    return () => {
      alive = false;
      off();
    };
  }, []);

  return state?.workspaces.find((workspace) => workspace.id === state.activeId) ?? null;
}
