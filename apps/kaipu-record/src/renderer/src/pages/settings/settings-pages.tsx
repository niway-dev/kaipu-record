import React from "react";
import { useNavigate } from "react-router-dom";
import { Cloud, Mic, Monitor, MousePointerClick, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { ModalActions, ModalButton, ModalOverlay, ModalText, ModalTitle, Row } from "@kaipu/ui";
import { Button } from "@kaipu/ui";
import { Toggle } from "@kaipu/ui";
import { Select } from "@renderer/ui/select";
import { useOnboarding } from "@renderer/features/onboarding";
import { usePermissions, useAccessibility } from "@renderer/features/permissions";
import { useWorkspaces } from "@renderer/features/workspaces/workspaces-context";
import { WorkspaceTile } from "@renderer/features/workspaces/workspace-switcher";
import type { WorkspaceView } from "@shared/types/workspaces";
import {
  SIM_ACCOUNTS,
  SIM_CAPACITIES,
  useStorageSimulator,
  writeStorageSimulator,
  type SimAccount,
  type SimCapacity,
} from "@renderer/features/storage-cloud/dev-storage-simulator";
import {
  DEV_UPDATE_SCENARIOS,
  readDevUpdateScenarioKey,
  writeDevUpdateScenario,
} from "@renderer/features/updater/dev-update-simulator";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { DEFAULT_EXPORT_QUALITY, type PermissionKind } from "@shared/types";
import { useAppSettings } from "./use-app-settings";
import { LanguageSettings } from "./language-settings";
import { ThemeSettings } from "./theme-settings";
import { UpdateSettings } from "./update-settings";
import { RecordingQualitySettings } from "./recording-quality-settings";
import { ExportQualitySettings } from "./export-quality-settings";
import { ScreenshotCopySettings } from "./screenshot-copy-settings";
import { BrandBadgeSettings } from "./brand-badge-settings";
import { CountdownSettings } from "./countdown-settings";
import { DiagnosticsSettings } from "./diagnostics-settings";
import { Section, SettingsPanel } from "./settings-panel";
import styles from "./settings-page.module.css";

/*
 * Settings pages. Each surfaces only settings wired end to end:
 *   • General           → AppSettings.locale / theme (+ a pointer to /cloud for the account)
 *   • Permissions       → window.electronAPI permission bridge (+ macOS Accessibility)
 *   • Recording quality → AppSettings.recordingQuality → encoder
 *                         + AppSettings.exportQuality → export sheet's preselected row
 *   • Recording         → AppSettings.showBarInRecording / recordingCountdownSeconds / showBrandBadge
 *   • Files             → the real on-disk recordings vault
 *   • App               → Dock policy, replay the first-run flow, diagnostics opt-out
 *   • Developer         → dev-only overrides (stripped from production)
 * Device pickers are still absent (no backend wiring) — see backlog/settings-roadmap.mdx.
 * Re-add a control only once its IPC + persistence is implemented.
 */

export function GeneralSettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const navigate = useNavigate();
  const { settings, update } = useAppSettings();
  return (
    <SettingsPanel title={t("general")} subtitle={t("generalDescription")}>
      <Section title={t("language")}>
        <LanguageSettings />
      </Section>
      <Section title={t("theme")}>
        <ThemeSettings
          theme={settings?.theme ?? "dark"}
          onChange={(theme) => void update({ theme })}
        />
      </Section>
      <Section title={t("account")}>
        <Row
          icon={<Cloud size={16} />}
          label={t("accountMoved")}
          description={t("accountMovedDetail")}
          action={
            <Button variant="outline" size="sm" onClick={() => void navigate("/cloud")}>
              {t("goToCloud")}
            </Button>
          }
        />
      </Section>
    </SettingsPanel>
  );
}

const PERMISSION_ROWS: ReadonlyArray<{
  kind: PermissionKind;
  labelKey: "permissionScreen" | "permissionMic" | "permissionCamera";
  icon: React.ReactNode;
}> = [
  { kind: "screen", labelKey: "permissionScreen", icon: <Monitor size={16} /> },
  { kind: "microphone", labelKey: "permissionMic", icon: <Mic size={16} /> },
  { kind: "camera", labelKey: "permissionCamera", icon: <Video size={16} /> },
];

export function PermissionsSettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const { status, request } = usePermissions();
  // Accessibility sits with the other three OS permissions, not in Recording where the
  // plan first put it: it is the same kind of grant, asked the same way, and this is
  // where a user looks for it. `request` is the Settings-side call to
  // `requestAccessibility()`; the onboarding Accessibility step is the only other one.
  const accessibility = useAccessibility();
  return (
    <SettingsPanel title={t("permissions")} subtitle={t("permissionsDescription")}>
      <Section title={t("permissions")}>
        {PERMISSION_ROWS.map(({ kind, labelKey, icon }) => {
          const granted = status[kind];
          return (
            <Row
              key={kind}
              icon={icon}
              label={t(labelKey)}
              description={
                <span className={granted ? styles.statusGranted : styles.statusDenied}>
                  {granted ? t("granted") : t("notGranted")}
                </span>
              }
              action={
                <Button variant="outline" size="sm" onClick={() => void request(kind)}>
                  {granted ? t("reRequest") : t("request")}
                </Button>
              }
            />
          );
        })}
        {/* "not-required" off macOS, and on macOS until the first IPC round-trip
            resolves — both correctly hide the row (plans/video-editor-v2/03 § UI:
            "Hidden when the status is not-required"). */}
        {accessibility.status !== "not-required" && (
          <Row
            icon={<MousePointerClick size={16} />}
            label={t("clickZoomLabel")}
            description={
              <span
                className={
                  accessibility.status === "granted" ? styles.statusGranted : styles.statusDenied
                }
              >
                {accessibility.status === "granted" ? t("granted") : t("notGranted")}
              </span>
            }
            action={
              <Button variant="outline" size="sm" onClick={() => void accessibility.request()}>
                {accessibility.status === "granted" ? t("reRequest") : t("request")}
              </Button>
            }
          />
        )}
      </Section>
    </SettingsPanel>
  );
}

export function RecordingQualitySettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();
  return (
    <SettingsPanel title={t("recordingQuality")} subtitle={t("recordingQualityDescription")}>
      <Section title={t("recordingQuality")}>
        <RecordingQualitySettings
          quality={settings?.recordingQuality ?? DEFAULT_QUALITY}
          onChange={(recordingQuality) => void update({ recordingQuality })}
        />
      </Section>
      <Section title={t("exportQuality")}>
        <ExportQualitySettings
          quality={settings?.exportQuality ?? DEFAULT_EXPORT_QUALITY}
          onChange={(exportQuality) => void update({ exportQuality })}
        />
        <Row
          label={t("recordingSavedCard")}
          description={t("recordingSavedCardDescription")}
          action={
            <Toggle
              aria-label={t("recordingSavedCard")}
              checked={settings?.showRecordingSavedCard ?? true}
              onChange={(checked) => void update({ showRecordingSavedCard: checked })}
            />
          }
        />
      </Section>
    </SettingsPanel>
  );
}

export function RecordingSettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();
  return (
    <SettingsPanel title={t("recording")} subtitle={t("recordingDescription")}>
      <Section title={t("recording")}>
        <Row
          label={t("showControlBar")}
          description={t("showControlBarDescription")}
          action={
            <Toggle
              checked={settings?.showBarInRecording ?? false}
              onChange={(checked) => void update({ showBarInRecording: checked })}
            />
          }
        />
        <CountdownSettings />
        <BrandBadgeSettings />
      </Section>
    </SettingsPanel>
  );
}

/**
 * Settings → Workspaces (was Files): one row per workspace with its folder and state, Show
 * folder and Remove from list, and Add workspace (ADR 0032). Remove changes nothing on disk.
 */
export function WorkspacesSettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const tw = useTranslations("workspaces");
  const tc = useTranslations("common");
  const { state, add, remove, openFolder } = useWorkspaces();
  const [removing, setRemoving] = React.useState<WorkspaceView | null>(null);
  const count = state?.workspaces.length ?? 0;
  return (
    <SettingsPanel title={t("workspaces")} subtitle={t("workspacesDescription")}>
      {state?.readOnly && <p className={styles.pathValue}>{tw("readOnly")}</p>}
      <Section title={t("workspaces")}>
        {state?.workspaces.map((workspace) => {
          const isActive = workspace.id === state.activeId;
          const status =
            workspace.state === "unavailable"
              ? tw(`reason_${workspace.reason ?? "missing"}`)
              : isActive
                ? tw("active")
                : null;
          return (
            <Row
              key={workspace.id}
              icon={
                <WorkspaceTile
                  workspace={workspace}
                  size={22}
                  dim={workspace.state === "unavailable"}
                />
              }
              label={workspace.name}
              description={
                <span className={styles.pathValue} title={workspace.path}>
                  {status ? `${workspace.path} · ${status}` : workspace.path}
                </span>
              }
              action={
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={workspace.state === "unavailable"}
                    onClick={() => openFolder(workspace.id)}
                  >
                    {tw("showFolder")}
                  </Button>
                  {!isActive && count > 1 && !state.readOnly && (
                    <Button variant="ghost" size="sm" onClick={() => setRemoving(workspace)}>
                      {tw("removeFromList")}
                    </Button>
                  )}
                </>
              }
            />
          );
        })}
      </Section>
      <div className={styles.workspacesActions}>
        <Button variant="outline" size="sm" disabled={state?.readOnly} onClick={() => void add()}>
          {tw("addAction")}
        </Button>
      </div>
      {removing && (
        <ModalOverlay onCancel={() => setRemoving(null)} labelledBy="remove-workspace-title">
          <ModalTitle id="remove-workspace-title">
            {tw("removeConfirmTitle", { name: removing.name })}
          </ModalTitle>
          <ModalText>{tw("removeConfirmBody")}</ModalText>
          <ModalActions>
            <ModalButton variant="ghost" onClick={() => setRemoving(null)}>
              {tc("cancel")}
            </ModalButton>
            <ModalButton
              variant="danger"
              onClick={() => {
                const id = removing.id;
                setRemoving(null);
                void remove(id);
              }}
            >
              {tw("removeConfirm")}
            </ModalButton>
          </ModalActions>
        </ModalOverlay>
      )}
    </SettingsPanel>
  );
}

export function AppSettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const tUpdates = useTranslations("updates");
  const { open: openOnboarding } = useOnboarding();
  const { settings, update } = useAppSettings();
  return (
    <SettingsPanel title={t("app")} subtitle={t("appDescription")}>
      <Section title={t("app")}>
        {/* The Dock and its activation policy exist only on macOS; on Windows the
            toggle would change nothing, so it is not shown at all. */}
        {!isWindowsHost() && (
          <Row
            label={t("showInDock")}
            description={t("showInDockDescription")}
            action={
              <Toggle
                checked={settings?.showInDock ?? true}
                onChange={(checked) => void update({ showInDock: checked })}
              />
            }
          />
        )}
        <Row
          label={t("onboarding")}
          description={t("onboardingDescription")}
          action={
            <Button variant="outline" size="sm" onClick={openOnboarding}>
              {t("replay")}
            </Button>
          }
        />
      </Section>
      <Section title={t("privacy")}>
        <DiagnosticsSettings />
      </Section>
      <Section title={tUpdates("updates")}>
        <UpdateSettings />
      </Section>
    </SettingsPanel>
  );
}

/** Screenshots — its own page in the settings nav, right under Recording. */
export function ScreenshotsSettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  return (
    <SettingsPanel title={t("screenshots")} subtitle={t("screenshotsDescription")}>
      <Section title={t("screenshots")}>
        <ScreenshotCopySettings />
      </Section>
      <p className={styles.sectionNote}>{t("screenshotQuietNote")}</p>
    </SettingsPanel>
  );
}

/** Dev-only overrides. Routed only when `import.meta.env.DEV`; copy is intentionally not localized. */
export function DeveloperSettingsPage(): React.JSX.Element {
  const [updateScenario, setUpdateScenario] = React.useState(() => readDevUpdateScenarioKey());
  const storageSim = useStorageSimulator();
  return (
    <SettingsPanel
      title="Developer"
      subtitle="Dev-only overrides. Stripped from production builds."
    >
      <Section title="Updater simulator">
        <Row
          label="Force an update state"
          description="The updater is inert in an unpackaged app — this drives the real UI instead"
          action={
            <Select
              value={updateScenario}
              onChange={(value) => {
                setUpdateScenario(value);
                writeDevUpdateScenario(value);
              }}
              options={DEV_UPDATE_SCENARIOS.map(({ key }) => ({
                value: key,
                label: key,
              }))}
            />
          }
        />
      </Section>
      <Section title="Cloud simulator">
        <Row
          label="Account"
          description="Forces the session state the Cloud page shows"
          action={
            <Select
              value={storageSim.account}
              options={SIM_ACCOUNTS.map((value) => ({ value, label: value }))}
              onChange={(value) => writeStorageSimulator({ account: value as SimAccount })}
            />
          }
        />
        <Row
          label="Capacity"
          description="Forces each capacity query state with fake numbers"
          action={
            <Select
              value={storageSim.capacity}
              options={SIM_CAPACITIES.map((value) => ({ value, label: value }))}
              onChange={(value) => writeStorageSimulator({ capacity: value as SimCapacity })}
            />
          }
        />
      </Section>
    </SettingsPanel>
  );
}
