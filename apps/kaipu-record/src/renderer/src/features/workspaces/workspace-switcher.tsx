import React, { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  Folder,
  HardDrive,
  Laptop,
  Lock,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { WorkspacesState, WorkspaceView } from "@shared/types/workspaces";
import "@renderer/features/library/tags/tag-palette.css";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { useWorkspaces } from "./workspaces-context";
import styles from "./workspace-switcher.module.css";

/** Where the settings page for workspaces lives (Manage workspaces…, the menu's Settings). */
export const WORKSPACES_SETTINGS_PATH = "/settings/workspaces";

/** The workspace's square: its initials on its palette color (ADR 0032, decision 12). */
export function WorkspaceTile({
  workspace,
  size,
  dim = false,
}: {
  workspace: Pick<WorkspaceView, "color" | "initials">;
  size: number;
  dim?: boolean;
}): React.JSX.Element {
  return (
    <span
      className={styles.tile}
      data-color={workspace.color}
      data-dim={dim || undefined}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.46) }}
      aria-hidden
    >
      {workspace.initials}
    </span>
  );
}

function useLocationLabel(): (workspace: WorkspaceView) => string {
  const t = useTranslations("workspaces");
  return (workspace) => workspace.volume ?? t("thisMac");
}

/**
 * The workspace switcher (design "Kaipu Workspaces v2", section 1): a bar naming the active
 * workspace, where it lives and its state, which opens the menu to switch. Self-contained
 * and mounted once (see AppShell), so moving it is a one-line change. It shows with one
 * workspace too (spec decision 19), with the one-time "New: workspaces" hint.
 */
export function WorkspaceSwitcher(): React.JSX.Element | null {
  const t = useTranslations("workspaces");
  const { state, active, menuOpen, setMenuOpen, dismissHint } = useWorkspaces();
  const locationOf = useLocationLabel();

  // Escape closes the menu, or answers the hint.
  useEffect(() => {
    if (!menuOpen && (!state || state.hintDismissed)) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      if (menuOpen) setMenuOpen(false);
      else dismissHint();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen, state, setMenuOpen, dismissHint]);

  if (!state || !active) return <div className={styles.placeholder} />;
  const off = active.state === "unavailable";
  const locked = state.busy !== null;
  const showHint = !state.hintDismissed && !menuOpen;

  return (
    <div className={styles.anchor}>
      <button
        type="button"
        className={styles.bar}
        data-state={off ? "off" : locked ? "locked" : "normal"}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        aria-label={`${t("label")}: ${active.name}`}
        onClick={() => setMenuOpen(!menuOpen)}
      >
        <WorkspaceTile workspace={active} size={20} dim={off} />
        <span className={styles.barName}>{active.name}</span>
        <span className={styles.barDivider} aria-hidden />
        {off ? (
          <span className={styles.barOff}>{t("notConnectedState")}</span>
        ) : (
          <span className={styles.barLocation}>
            {active.volume ? <HardDrive size={12} /> : <Laptop size={12} />}
            {locationOf(active)}
          </span>
        )}
        <span className={styles.barChevron} aria-hidden>
          {locked ? <Lock size={12} /> : <ChevronsUpDown size={12} />}
        </span>
      </button>

      {showHint && (
        <div className={styles.hint} role="status">
          <span>{t("hint")}</span>
          <button type="button" className={styles.hintDismiss} onClick={dismissHint}>
            {t("hintDismiss")}
          </button>
        </div>
      )}

      {menuOpen && <WorkspaceMenu state={state} active={active} />}
    </div>
  );
}

function WorkspaceMenu({
  state,
  active,
}: {
  state: WorkspacesState;
  active: WorkspaceView;
}): React.JSX.Element {
  const t = useTranslations("workspaces");
  const navigate = useNavigate();
  const { setMenuOpen, switchTo, add, openFolder } = useWorkspaces();
  const locationOf = useLocationLabel();
  // The LOCKED state: nothing can switch while a take or an export writes here.
  const lock =
    state.busy === "recording"
      ? t("lockedRecording")
      : state.busy === "exporting"
        ? t("lockedExporting")
        : null;
  const others = state.workspaces.filter((w) => w.id !== active.id);
  const goToSettings = (): void => {
    setMenuOpen(false);
    navigate(WORKSPACES_SETTINGS_PATH);
  };

  return (
    <>
      <div className={styles.backdrop} onClick={() => setMenuOpen(false)} aria-hidden />
      <div className={styles.menu} role="menu" aria-label={t("label")}>
        <div className={styles.current}>
          <div className={styles.currentHead}>
            <WorkspaceTile workspace={active} size={28} dim={active.state === "unavailable"} />
            <div className={styles.currentText}>
              <div className={styles.currentName}>{active.name}</div>
              <div className={styles.currentPath} title={active.path}>
                {active.path}
              </div>
            </div>
          </div>
          <div className={styles.stats}>
            <Stat label={t("currentStatItems")} value={active.itemCount?.toString() ?? "—"} />
            <Stat label={t("currentStatLocation")} value={locationOf(active)} />
            <Stat label={t("currentStatSavingTo")} value={t("savingToHere")} />
          </div>
          <div className={styles.shortcuts}>
            <button
              type="button"
              className={styles.shortcut}
              onClick={() => {
                setMenuOpen(false);
                openFolder(active.id);
              }}
            >
              <Folder size={12} />
              {isWindowsHost() ? t("showInExplorer") : t("showInFinder")}
            </button>
            <button type="button" className={styles.shortcut} onClick={goToSettings}>
              <SlidersHorizontal size={12} />
              {t("openSettings")}
            </button>
          </div>
        </div>

        <div className={styles.section}>
          {others.length > 0 && <div className={styles.sectionLabel}>{t("switchTo")}</div>}
          {lock && others.length > 0 && (
            <div className={styles.lock} role="note">
              <Lock size={13} />
              {lock}
            </div>
          )}
          {others.map((workspace) => {
            const off = workspace.state === "unavailable";
            return (
              <button
                key={workspace.id}
                type="button"
                role="menuitem"
                className={styles.row}
                disabled={off || lock !== null}
                onClick={() => void switchTo(workspace.id)}
              >
                <WorkspaceTile workspace={workspace} size={22} dim={off} />
                <span className={styles.rowText}>
                  <span className={styles.rowName}>{workspace.name}</span>
                  <span className={styles.rowMeta} data-off={off || undefined}>
                    {off
                      ? t("rowNotConnected", { location: locationOf(workspace) })
                      : t("rowMeta", {
                          count: workspace.itemCount ?? 0,
                          location: locationOf(workspace),
                        })}
                  </span>
                </span>
              </button>
            );
          })}
          {others.length > 0 && <div className={styles.separator} />}
          <button
            type="button"
            role="menuitem"
            className={styles.action}
            disabled={state.readOnly}
            onClick={() => void add()}
          >
            <Plus size={15} />
            {t("add")}
          </button>
          <button type="button" role="menuitem" className={styles.action} onClick={goToSettings}>
            <SlidersHorizontal size={15} />
            {t("manage")}
          </button>
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className={styles.stat}>
      <div className={styles.statLabel}>{label}</div>
      <div className={styles.statValue} title={value}>
        {value}
      </div>
    </div>
  );
}
