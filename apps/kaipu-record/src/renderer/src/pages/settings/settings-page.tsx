import React from "react";
import { Mic, Video, Monitor, FolderOpen } from "lucide-react";
import { Card } from "@renderer/ui/card";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";
import { Toggle } from "@renderer/ui/toggle";
import { useOnboarding } from "@renderer/features/onboarding";
import { usePermissions } from "@renderer/features/permissions";
import { useVaultDirectory } from "@renderer/features/library/hooks/use-vault-directory";
import { useAppSettings } from "./use-app-settings";
import { RecordingQualitySettings } from "./recording-quality-settings";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import type { PermissionKind } from "@shared/types";
import styles from "./settings-page.module.css";

/*
 * This page intentionally only surfaces settings that are wired end-to-end:
 *   • Permissions       → window.electronAPI permission bridge
 *   • Recording quality → persisted AppSettings.recordingQuality → encoder
 *   • Files             → real on-disk recordings vault
 *   • App / Onboarding  → Dock policy, replay the first-run flow
 *
 * Device pickers, configurable keyboard shortcuts and theme switching are still
 * absent because no backend wiring exists for them yet — they were inert local
 * state. They are tracked as concepts to build in the backlog:
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
  const { open: openOnboarding } = useOnboarding();
  const { status: permissionStatus, request: requestPermission } = usePermissions();
  const vault = useVaultDirectory();
  const { settings, update } = useAppSettings();

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Permissions, storage and onboarding for Kaipu Record.</p>
      </div>

      <div className={styles.sections}>
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
      </div>
    </div>
  );
}
