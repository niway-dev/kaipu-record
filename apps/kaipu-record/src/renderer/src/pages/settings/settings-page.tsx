import React from "react";
import { Mic, Video, Monitor, FolderOpen } from "lucide-react";
import { Card } from "@renderer/ui/card";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";
import { Toggle } from "@renderer/ui/toggle";
import { useOnboarding } from "@renderer/features/onboarding";
import { usePermissions } from "@renderer/features/permissions";
import { useVaultDirectory } from "@renderer/features/library/hooks/use-vault-directory";
import { useTranslations } from "@kaipu/i18n";
import { AccountPanel } from "@renderer/features/auth/account-panel";
import { useAppSettings } from "./use-app-settings";
import { LanguageSettings } from "./language-settings";
import { ThemeSettings } from "./theme-settings";
import { RecordingQualitySettings } from "./recording-quality-settings";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import {
  readDevSimulatePaid,
  writeDevSimulatePaid,
} from "@renderer/features/watermark/dev-override";
import type { PermissionKind } from "@shared/types";
import styles from "./settings-page.module.css";

/*
 * This page intentionally only surfaces settings that are wired end-to-end:
 *   • Permissions       → window.electronAPI permission bridge
 *   • Recording quality → persisted AppSettings.recordingQuality → encoder
 *   • Theme             → persisted AppSettings.theme → data-theme in every window
 *   • Files             → real on-disk recordings vault
 *   • App / Onboarding  → Dock policy, replay the first-run flow
 *
 * Configurable keyboard shortcuts now ship as their own sidebar page (Shortcuts).
 * Device pickers are still absent because no backend wiring exists for them yet —
 * they were inert local state. They are tracked in the backlog:
 *   apps/documentation/src/content/docs/backlog/settings-roadmap.mdx
 * Re-add each control here only once its IPC + persistence is implemented.
 */

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.section}>
      <h2 className={styles.sectionTitle}>{title}</h2>
      <Card>{children}</Card>
    </div>
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

export function SettingsPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const { open: openOnboarding } = useOnboarding();
  const { status: permissionStatus, request: requestPermission } = usePermissions();
  const vault = useVaultDirectory();
  const { settings, update } = useAppSettings();
  // Dev-only watermark bypass. `import.meta.env.DEV` is a build-time literal, so
  // this state + the section below are stripped from production bundles.
  const [simulatePaid, setSimulatePaid] = React.useState(() => readDevSimulatePaid());

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>{t("title")}</h1>
        <p className={styles.pageSubtitle}>{t("subtitle")}</p>
      </div>

      <div className={styles.sections}>
        <Section title={t("account")}>
          <AccountPanel />
        </Section>

        <Section title={t("language")}>
          <LanguageSettings />
        </Section>

        <Section title={t("theme")}>
          <ThemeSettings
            theme={settings?.theme ?? "dark"}
            onChange={(theme) => void update({ theme })}
          />
        </Section>

        <Section title={t("permissions")}>
          {PERMISSION_ROWS.map(({ kind, labelKey, icon }) => {
            const granted = permissionStatus[kind];
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
                  <Button variant="outline" size="sm" onClick={() => void requestPermission(kind)}>
                    {granted ? t("reRequest") : t("request")}
                  </Button>
                }
              />
            );
          })}
        </Section>

        <Section title={t("recordingQuality")}>
          <RecordingQualitySettings
            quality={settings?.recordingQuality ?? DEFAULT_QUALITY}
            onChange={(recordingQuality) => void update({ recordingQuality })}
          />
        </Section>

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
        </Section>

        <Section title={t("files")}>
          <Row
            icon={<FolderOpen size={16} />}
            label={t("recordingsFolder")}
            description={
              <span className={styles.pathValue} title={vault.directory?.path}>
                {vault.directory ? vault.directory.path : t("folderLoading")}
                {vault.directory
                  ? ` · ${vault.directory.isCustom ? t("folderCustom") : t("folderDefault")}`
                  : ""}
              </span>
            }
            action={
              <>
                {vault.directory?.isCustom && (
                  <Button variant="ghost" size="sm" onClick={() => void vault.reset()}>
                    {t("reset")}
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void vault.choose()}>
                  {t("browse")}
                </Button>
              </>
            }
          />
        </Section>

        <Section title={t("app")}>
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

        {import.meta.env.DEV && (
          <Section title="Developer (dev only)">
            <Row
              label="Quitar watermark (simular plan pago)"
              description="Solo visible en desarrollo — graba sin el watermark para probar"
              action={
                <Toggle
                  checked={simulatePaid}
                  onChange={(checked) => {
                    setSimulatePaid(checked);
                    writeDevSimulatePaid(checked);
                  }}
                />
              }
            />
          </Section>
        )}
      </div>
    </div>
  );
}
