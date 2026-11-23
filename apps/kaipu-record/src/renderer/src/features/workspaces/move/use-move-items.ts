import { useCallback } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { MoveItemsResult, WorkspaceView } from "@shared/types/workspaces";
import { showToast } from "@renderer/ui/toast-store";
import { useOptionalWorkspaces } from "../workspaces-context";
import { exportsToSuggest, orderForMove, resultMessage, type MovableItem } from "./move-flow";
import { askAboutExports, askAboutSyncedMove, setMoveProgress } from "./move-store";

export interface MoveRequest {
  /** The items to move, in the order on screen. */
  items: readonly MovableItem[];
  /** A workspace id, or "new" for "Move to ▸ New workspace…". */
  target: string | "new";
  /** The source workspace's loaded list, for the exports suggestion. */
  library: readonly MovableItem[];
  /**
   * Runs after every question was answered and before the first move: an editor closes here
   * (flushing its saves). False stops the move; nothing changed.
   */
  before?(): Promise<boolean>;
}

/** Resolves the result, or null when nothing was attempted (cancelled, or the editor stayed). */
export type MoveItemsFlow = (request: MoveRequest) => Promise<MoveItemsResult | null>;

/**
 * "Move to" from any surface (ADR 0033): pick or create the target, suggest the exports, then
 * a group of single moves in main, with progress and a result toast offering "Switch".
 */
export function useMoveItems(): MoveItemsFlow {
  const t = useTranslations("move");
  // Optional: a page rendered alone (a test) has no workspaces, and then moves nothing.
  const workspaces = useOptionalWorkspaces();
  const state = workspaces?.state ?? null;
  const active = workspaces?.active ?? null;
  const openCreateDialog = workspaces?.openCreateDialog;
  const switchTo = workspaces?.switchTo;

  return useCallback(
    async (request) => {
      if (!state || !active || !openCreateDialog || !switchTo || request.items.length === 0) {
        return null;
      }

      // 1. The target: an existing workspace, or a new one created inactive. A cancelled
      // dialog or folder picker moves nothing and registers nothing.
      let target: Pick<WorkspaceView, "id" | "name"> | null =
        request.target === "new"
          ? null
          : (state.workspaces.find((w) => w.id === request.target) ?? null);
      if (request.target === "new") {
        target = await new Promise<WorkspaceView | null>((resolve) =>
          openCreateDialog({ onCreated: resolve, onCancelled: () => resolve(null) }),
        );
      }
      if (!target) return null;

      // 1b. A move out of a synced workspace deletes the file from the provider's folder, so
      // from the cloud on every device (decision 4): ask first. Always on, whatever the flag.
      if (active.sync !== null && !(await askAboutSyncedMove({ source: active.name }))) {
        return null;
      }

      // 2. The exports of the selected recordings (decision 15), from the loaded list.
      let items = [...request.items];
      const exports = exportsToSuggest(items, request.library);
      if (exports.length > 0) {
        const answer = await askAboutExports({
          count: exports.length,
          source: active.name,
          selected: items.length,
        });
        if (answer === null) return null;
        if (answer === "all") items = orderForMove(items, exports);
      }

      // 3. An editor closes first, so nothing writes the item while it moves.
      if (request.before && !(await request.before())) {
        showToast({ message: t("closeRefused") });
        return null;
      }

      // 4. The group, one move after another in main.
      const moving = items.filter((item): item is MovableItem & { id: string } => item.id !== null);
      const titles = new Map(moving.map((item) => [item.id, item.title]));
      setMoveProgress({ current: 0, total: moving.length });
      const off = window.electronAPI.workspaces.onMoveProgress(setMoveProgress);
      let result: MoveItemsResult;
      try {
        result = await window.electronAPI.workspaces.moveItems({
          items: moving.map(({ id, assetId }) => ({ id, assetId })),
          targetId: target.id,
        });
      } catch (error) {
        // The reply was lost: main may have moved some or all of the group, so no per-item
        // reason can be given. The window refreshes from the library broadcast.
        console.error("move failed", error);
        showToast({ message: t("resultUnknown"), durationMs: 12_000 });
        return null;
      } finally {
        off();
        setMoveProgress(null);
      }

      // 5. The result, with "Switch" when something arrived there.
      const targetId = target.id;
      showToast({
        message: resultMessage(
          result,
          { titles, target: target.name, source: active.name },
          (key, values) => t(key as Parameters<typeof t>[0], values as never),
        ),
        durationMs: result.failed.length > 0 ? 12_000 : 6_000,
        ...(result.moved.length > 0
          ? { action: { label: t("switchAction"), onClick: () => void switchTo(targetId) } }
          : {}),
      });
      return result;
    },
    [state, active, openCreateDialog, switchTo, t],
  );
}
