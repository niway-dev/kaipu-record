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
import { useAppSettings } from "./use-app-settings";
import { LanguageSettings } from "./language-settings";
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
 *   • Files             → real on-disk recordings vault
 *   • App / Onboarding  → Dock policy, replay the first-run flow
 *
 * Configurable keyboard shortcuts now ship as their own sidebar page (Shortcuts).
 * Device pickers and theme switching are still absent because no backend wiring
 * exists for them yet — they were inert local state.
 * They are tracked as concepts to build in the backlog:
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
  label: string;
  icon: React.ReactNode;
}> = [
  { kind: "screen", label: "Screen recording", icon: <Monitor size={16} /> },
  { kind: "microphone", label: "Microphone", icon: <Mic size={16} /> },
  { kind: "camera", label: "Camera", icon: <Video size={16} /> },
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
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Permissions, storage and onboarding for Kaipu Record.</p>
      </div>

      <div className={styles.sections}>
        <Section title={t("language")}>
          <LanguageSettings />
        </Section>

        <Section title="Permissions">
          {PERMISSION_ROWS.map(({ kind, label, icon }) => {
            const granted = permissionStatus[kind];
            return (
              <Row
                key={kind}
                icon={icon}
                label={label}
                description={
                  <span className={granted ? styles.statusGranted : styles.statusDenied}>
                    {granted ? "Granted" : "Not granted"}
                  </span>
                }
                action={
                  <Button variant="outline" size="sm" onClick={() => void requestPermission(kind)}>
                    {granted ? "Re-request" : "Request"}
                  </Button>
                }
              />
            );
          })}
        </Section>

        <Section title="Recording quality">
          <RecordingQualitySettings
            quality={settings?.recordingQuality ?? DEFAULT_QUALITY}
            onChange={(recordingQuality) => void update({ recordingQuality })}
          />
        </Section>

        <Section title="Recording">
          <Row
            label="Show control bar in recording"
            description="Include the floating control bar in the captured video. Off keeps it hidden (default)"
            action={
              <Toggle
                checked={settings?.showBarInRecording ?? false}
                onChange={(checked) => void update({ showBarInRecording: checked })}
              />
            }
          />
        </Section>

        <Section title="Files">
          <Row
            icon={<FolderOpen size={16} />}
            label="Recordings folder"
            description={
              <span className={styles.pathValue} title={vault.directory?.path}>
                {vault.directory ? vault.directory.path : "Loading…"}
                {vault.directory ? (vault.directory.isCustom ? " · Custom" : " · Default") : ""}
              </span>
            }
            action={
              <>
                {vault.directory?.isCustom && (
                  <Button variant="ghost" size="sm" onClick={() => void vault.reset()}>
                    Reset
                  </Button>
                )}
                <Button variant="outline" size="sm" onClick={() => void vault.choose()}>
                  Browse
                </Button>
              </>
            }
          />
        </Section>

        <Section title="App">
          <Row
            label="Show in Dock & app switcher"
            description="Off keeps Kaipu in the menu bar only — no Dock icon, hidden from ⌘-Tab (macOS)"
            action={
              <Toggle
                checked={settings?.showInDock ?? true}
                onChange={(checked) => void update({ showInDock: checked })}
              />
            }
          />
          <Row
            label="Onboarding"
            description="Replay the first-run setup & permissions"
            action={
              <Button variant="outline" size="sm" onClick={openOnboarding}>
                Replay
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
