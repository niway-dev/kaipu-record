import React, { useCallback, useEffect, useState } from "react";
import { Cloud, CloudOff, Folder, HardDrive, Laptop } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type {
  AssignCloudResult,
  UnassignedCloudItem,
  WorkspaceCloudState,
  WorkspaceLocation,
} from "@shared/types/workspaces";
import { useOptionalWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { WorkspaceTile } from "@renderer/features/workspaces/workspace-switcher";
import styles from "./workspace-cloud-section.module.css";

/**
 * Cloud → "This workspace" (spec, Cloud and Synced folders; design section 4 "CLOUD"). The
 * spec wins over the mock: Google Drive and OneDrive are not providers Kaipu syncs to. A
 * workspace folder inside one is detected and labelled; Kaipu Cloud stays one per account.
 * The section says where the active workspace lives, which Kaipu Cloud items its Library
 * lists, and offers "Assign to workspace…" for the cloud items no workspace on this Mac holds.
 */
export function WorkspaceCloudSection(): React.JSX.Element | null {
  const t = useTranslations("workspaceCloud");
  const workspaces = useOptionalWorkspaces();
  const [state, setState] = useState<WorkspaceCloudState | null>(null);
  const [picking, setPicking] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string[]>([]);

  const load = useCallback(async () => {
    setState(await window.electronAPI.workspaces.cloudState());
  }, []);
  useEffect(() => {
    void load();
    // An assignment, a refresh or a move changes the lists: the Library broadcast says so.
    return window.electronAPI.onLibraryChanged(() => void load());
  }, [load, workspaces?.epoch]);

  const active = workspaces?.active ?? null;
  const targets = (workspaces?.state?.workspaces ?? []).filter((w) => w.state === "available");

  const assign = async (assetIds: string[], targetId: string): Promise<void> => {
    const name = targets.find((w) => w.id === targetId)?.name ?? "";
    setBusy(true);
    let result: AssignCloudResult;
    try {
      result = await window.electronAPI.workspaces.assignCloud(assetIds, targetId);
    } catch {
      setNotice([t("failed")]);
      setBusy(false);
      return;
    }
    const lines: string[] = [];
    if (result.assigned.length > 0) {
      lines.push(t("assigned", { count: result.assigned.length, name }));
    }
    if (result.queued.length > 0) lines.push(t("queued", { count: result.queued.length, name }));
    const missing = result.failed.filter((f) => f.reason === "not-found").length;
    if (missing > 0) lines.push(t("failedNotFound", { count: missing }));
    if (lines.length === 0) lines.push(t("failed"));
    setNotice(lines);
    setPicking(null);
    setBusy(false);
    await load();
  };

  if (!state) {
    return (
      <section className={styles.group} aria-busy="true">
        <p className={styles.muted}>{t("loading")}</p>
      </section>
    );
  }

  const synced = isSynced(state.location);
  const provider = t(`location_${state.location}`);
  return (
    <section className={styles.group} aria-labelledby="workspace-cloud-title">
      <div className={styles.header}>
        {active && <WorkspaceTile workspace={active} size={28} />}
        <div className={styles.headerText}>
          <h2 id="workspace-cloud-title" className={styles.title}>
            {active ? active.name : t("title")}
          </h2>
          <p className={styles.description}>{t("description")}</p>
        </div>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>{t("locationLabel")}</h3>
        <div className={styles.row} data-testid="workspace-location">
          <span className={styles.icon}>
            <LocationIcon location={state.location} />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>
              {synced ? t("syncedBy", { provider }) : provider}
            </span>
            <span className={styles.rowDetail}>
              {synced ? t("syncedNote", { provider }) : t("localNote")}
            </span>
          </span>
        </div>
      </div>

      <div className={styles.block}>
        <h3 className={styles.blockTitle}>{t("filterLabel")}</h3>
        <div className={styles.row} data-testid="workspace-cloud-filter">
          <span className={styles.icon}>
            <Cloud size={16} aria-hidden />
          </span>
          <span className={styles.rowText}>
            <span className={styles.rowLabel}>
              {state.filter === "own" ? t("filterOwn") : t("filterOwnAndUnassigned")}
            </span>
            {state.filter === "own-and-unassigned" && (
              <span className={styles.rowDetail}>{t("filterOwnAndUnassignedNote")}</span>
            )}
          </span>
        </div>
      </div>

      <div className={styles.block}>
        <div className={styles.blockHeader}>
          <h3 className={styles.blockTitle}>{t("unassignedTitle")}</h3>
          {state.unassigned.length > 1 && (
            <button
              type="button"
              className={styles.action}
              disabled={busy || targets.length === 0}
              onClick={() => setPicking(state.unassigned.map((i) => i.assetId))}
            >
              {t("assignAll")}
            </button>
          )}
        </div>
        {notice.length > 0 && (
          <p className={styles.notice} role="status">
            {notice.join(" ")}
          </p>
        )}
        {picking && (
          <div className={styles.picker} role="dialog" aria-label={t("assignTitle")}>
            <span className={styles.pickerTitle}>{t("assignTo", { count: picking.length })}</span>
            {targets.map((workspace) => (
              <button
                key={workspace.id}
                type="button"
                className={styles.target}
                disabled={busy}
                onClick={() => void assign(picking, workspace.id)}
              >
                <WorkspaceTile workspace={workspace} size={20} />
                {workspace.name}
              </button>
            ))}
            <button
              type="button"
              className={styles.cancel}
              disabled={busy}
              onClick={() => setPicking(null)}
            >
              {t("cancel")}
            </button>
          </div>
        )}
        {!state.signedIn ? (
          <p className={styles.muted}>{t("signedOut")}</p>
        ) : !state.catalogKnown ? (
          <p className={styles.muted}>{t("notFetched")}</p>
        ) : state.unassigned.length === 0 ? (
          <p className={styles.muted}>{t("unassignedEmpty")}</p>
        ) : (
          <>
            <p className={styles.count}>
              {t("unassignedCount", { count: state.unassigned.length })}
            </p>
            <ul className={styles.list}>
              {state.unassigned.map((item) => (
                <UnassignedRow
                  key={item.assetId}
                  item={item}
                  date={new Date(item.createdAt).toLocaleDateString()}
                  origin={item.workspaceId === null ? t("neverAssigned") : t("fromElsewhere")}
                  assignLabel={t("assign")}
                  disabled={busy || targets.length === 0}
                  onAssign={() => setPicking([item.assetId])}
                />
              ))}
            </ul>
          </>
        )}
      </div>
    </section>
  );
}

function UnassignedRow({
  item,
  date,
  origin,
  assignLabel,
  disabled,
  onAssign,
}: {
  item: UnassignedCloudItem;
  date: string;
  origin: string;
  assignLabel: string;
  disabled: boolean;
  onAssign(): void;
}): React.JSX.Element {
  return (
    <li className={styles.item}>
      <span className={styles.rowText}>
        <span className={styles.rowLabel}>{item.title}</span>
        <span className={styles.rowDetail}>
          {date} · {origin}
        </span>
      </span>
      <button type="button" className={styles.action} disabled={disabled} onClick={onAssign}>
        {assignLabel}
      </button>
    </li>
  );
}

function isSynced(location: WorkspaceLocation): boolean {
  return location !== "this-mac" && location !== "external-drive";
}

function LocationIcon({ location }: { location: WorkspaceLocation }): React.JSX.Element {
  if (location === "this-mac") return <Laptop size={16} aria-hidden />;
  if (location === "external-drive") return <HardDrive size={16} aria-hidden />;
  if (location === "cloud-provider") return <CloudOff size={16} aria-hidden />;
  return location === "icloud" ? <Cloud size={16} aria-hidden /> : <Folder size={16} aria-hidden />;
}
