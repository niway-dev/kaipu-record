import React, { useState } from "react";
import { Mic, Video, Monitor, FolderOpen } from "lucide-react";
import { Card } from "@renderer/ui/card";
import { Row } from "@renderer/ui/row";
import { Toggle } from "@renderer/ui/toggle";
import { Select } from "@renderer/ui/select";
import { Button } from "@renderer/ui/button";
import { useOnboarding } from "@renderer/features/onboarding";
import { usePermissions } from "@renderer/features/onboarding/use-permissions";
import { useVaultDirectory } from "@renderer/features/library/hooks/use-vault-directory";
import type { PermissionKind } from "@shared/types";
import styles from "./settings-page.module.css";

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

function Kbd({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <kbd className={styles.kbd}>{children}</kbd>;
}

interface SegmentedProps {
  value: string;
  options: ReadonlyArray<{ value: string; label: string }>;
  onChange: (value: string) => void;
}

function Segmented({ value, options, onChange }: SegmentedProps): React.JSX.Element {
  return (
    <div className={styles.segmented}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={[styles.segment, value === option.value ? styles.segmentActive : ""].join(" ")}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
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

const MICROPHONES = [
  { value: "mic-1", label: "MacBook Pro Microphone" },
  { value: "mic-2", label: "AirPods Pro" },
];
const CAMERAS = [{ value: "cam-1", label: "FaceTime HD Camera" }];

export function SettingsPage(): React.JSX.Element {
  const { open: openOnboarding } = useOnboarding();
  const { status: permissionStatus, request: requestPermission } = usePermissions();
  const vault = useVaultDirectory();

  const [settings, setSettings] = useState({
    micDeviceId: "mic-1",
    cameraDeviceId: "cam-1",
    resolution: "source",
    fps: "30",
    showCountdown: true,
    minimizeToTray: false,
    theme: "dark",
  });
  const patch = (p: Partial<typeof settings>): void => setSettings((prev) => ({ ...prev, ...p }));

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Settings</h1>
        <p className={styles.pageSubtitle}>Devices, quality and behaviour for Kaipu Record.</p>
      </div>

      <div className={styles.sections}>
        <Section title="Devices">
          <Row
            icon={<Mic size={16} />}
            label="Microphone"
            action={
              <Select
                value={settings.micDeviceId}
                options={MICROPHONES}
                onChange={(v) => patch({ micDeviceId: v })}
              />
            }
          />
          <Row
            icon={<Video size={16} />}
            label="Camera"
            action={
              <Select
                value={settings.cameraDeviceId}
                options={CAMERAS}
                onChange={(v) => patch({ cameraDeviceId: v })}
              />
            }
          />
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

        <Section title="Recording Quality">
          <Row
            label="Resolution"
            action={
              <Select
                value={settings.resolution}
                options={[
                  { value: "source", label: "Source" },
                  { value: "1080p", label: "1080p" },
                  { value: "720p", label: "720p" },
                  { value: "480p", label: "480p" },
                ]}
                onChange={(v) => patch({ resolution: v })}
              />
            }
          />
          <Row
            label="Frame rate"
            action={
              <Select
                value={settings.fps}
                options={[
                  { value: "24", label: "24 fps" },
                  { value: "30", label: "30 fps" },
                  { value: "60", label: "60 fps" },
                ]}
                onChange={(v) => patch({ fps: v })}
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

        <Section title="Keyboard Shortcuts">
          <Row
            label="Start recording"
            action={
              <>
                <Kbd>⌘⇧P</Kbd>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </>
            }
          />
          <Row
            label="Pause / resume"
            action={
              <>
                <Kbd>⌘⇧Space</Kbd>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </>
            }
          />
          <Row
            label="Stop recording"
            action={
              <>
                <Kbd>⌘⇧S</Kbd>
                <Button variant="outline" size="sm">
                  Edit
                </Button>
              </>
            }
          />
        </Section>

        <Section title="App">
          <Row
            label="Show 3-second countdown"
            description="Countdown before recording starts"
            action={
              <Toggle
                checked={settings.showCountdown}
                onChange={(v) => patch({ showCountdown: v })}
              />
            }
          />
          <Row
            label="Minimize to system tray"
            description="Keep app running in background"
            action={
              <Toggle
                checked={settings.minimizeToTray}
                onChange={(v) => patch({ minimizeToTray: v })}
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
          <Row
            label="Appearance"
            description="Light or dark theme"
            action={
              <Segmented
                value={settings.theme}
                options={[
                  { value: "light", label: "Light" },
                  { value: "dark", label: "Dark" },
                ]}
                onChange={(theme) => patch({ theme })}
              />
            }
          />
        </Section>
      </div>
    </div>
  );
}
