import React from "react";
import { ChevronRight, Lock, Plus } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { WorkspacesState, WorkspaceView } from "@shared/types/workspaces";
import { WorkspaceTile } from "../workspace-switcher";
import { moveCost } from "./move-flow";
import styles from "./move.module.css";

/** Why "Move to" is locked right now (design: "Wait for the export to finish"), or null. */
export function useMoveLock(state: WorkspacesState | null): string | null {
  const t = useTranslations("move");
  if (!state?.busy) return null;
  return t(
    state.busy === "recording"
      ? "lockedRecording"
      : state.busy === "exporting"
        ? "lockedExporting"
        : "lockedMoving",
  );
}

/**
 * The "MOVE TO" section (design "Kaipu Workspaces v2", section 2): every other workspace with
 * the cost of a move there (same drive · instant, other drive · copies, not connected), or
 * "New workspace…" alone when there is no other one (spec decision 19).
 */
export function MoveTargetList({
  state,
  active,
  lock,
  onPick,
}: {
  state: WorkspacesState;
  active: WorkspaceView;
  /** Shown beside the label and disables every row. */
  lock: string | null;
  onPick(target: string | "new"): void;
}): React.JSX.Element {
  const t = useTranslations("move");
  const others = state.workspaces.filter((w) => w.id !== active.id);
  return (
    <div className={styles.targets}>
      <div className={styles.sectionHead}>
        <span className={styles.sectionLabel}>{t("moveTo")}</span>
        {lock && (
          <span className={styles.lock} role="note">
            <Lock size={10} />
            {lock}
          </span>
        )}
      </div>
      {others.map((workspace) => {
        const cost = moveCost(workspace, active);
        const off = cost === "not-connected";
        return (
          <button
            key={workspace.id}
            type="button"
            role="menuitem"
            className={styles.target}
            disabled={off || lock !== null || state.readOnly}
            onClick={() => onPick(workspace.id)}
          >
            <WorkspaceTile workspace={workspace} size={20} dim={off} />
            <span className={styles.targetText}>
              <span className={styles.targetName}>{workspace.name}</span>
              <span className={styles.targetCost} data-off={off || undefined}>
                {t(
                  cost === "same-drive"
                    ? "costSameDrive"
                    : cost === "other-drive"
                      ? "costOtherDrive"
                      : cost === "synced"
                        ? "costSynced"
                        : "costNotConnected",
                )}
              </span>
            </span>
            {!off && !lock && <ChevronRight size={12} className={styles.targetChevron} />}
          </button>
        );
      })}
      {others.length === 0 && (
        <button
          type="button"
          role="menuitem"
          className={styles.target}
          disabled={lock !== null || state.readOnly}
          onClick={() => onPick("new")}
        >
          <span className={styles.newIcon} aria-hidden>
            <Plus size={13} />
          </span>
          <span className={styles.targetName}>{t("newWorkspace")}</span>
        </button>
      )}
    </div>
  );
}
