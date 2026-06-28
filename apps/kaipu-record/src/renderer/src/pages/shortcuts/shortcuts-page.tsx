import React from "react";
import { Card } from "@renderer/ui/card";
import { Row } from "@renderer/ui/row";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { ShortcutInput } from "@renderer/features/shortcuts/shortcut-input";
import { DEFAULT_SHORTCUTS, type ShortcutAction } from "@shared/types";
import styles from "./shortcuts-page.module.css";

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

interface ShortcutRow {
  action: ShortcutAction;
  label: string;
  description: string;
}

const RECORDING_SHORTCUTS: ReadonlyArray<ShortcutRow> = [
  {
    action: "startRecording",
    label: "Start recording",
    description: "Begin a screen recording from anywhere",
  },
  {
    action: "stopRecording",
    label: "Stop recording",
    description: "End the current recording from anywhere",
  },
];

const APP_SHORTCUTS: ReadonlyArray<ShortcutRow> = [
  {
    action: "bringToFront",
    label: "Bring Kaipu to front",
    description: "Show the app window if it slips behind or out of reach",
  },
];

/**
 * Dedicated page for the global keyboard shortcuts. Each binding is rebindable
 * (click to capture); the main process registers them system-wide and reports,
 * via `getShortcutStatus`, any that another app already owns.
 */
export function ShortcutsPage(): React.JSX.Element {
  const { settings, update } = useAppSettings();
  const shortcuts = settings?.shortcuts ?? DEFAULT_SHORTCUTS;

  // Which global shortcuts actually registered (false = another app owns it).
  // Re-query whenever the bindings change (main re-registers on update).
  const [shortcutStatus, setShortcutStatus] = React.useState<Record<
    ShortcutAction,
    boolean
  > | null>(null);
  React.useEffect(() => {
    // Guard the bridge call so a stale preload degrades gracefully (no warnings)
    // instead of crashing the page.
    if (typeof window.electronAPI.getShortcutStatus !== "function") return;
    void window.electronAPI.getShortcutStatus().then(setShortcutStatus);
  }, [settings?.shortcuts]);

  const renderRow = ({ action, label, description }: ShortcutRow): React.JSX.Element => {
    const unavailable = shortcutStatus ? !shortcutStatus[action] : false;
    return (
      <Row
        key={action}
        label={label}
        description={unavailable ? `${description} · in use by another app` : description}
        action={
          <ShortcutInput
            value={shortcuts[action]}
            unavailable={unavailable}
            onChange={(accelerator) =>
              void update({ shortcuts: { ...shortcuts, [action]: accelerator } })
            }
          />
        }
      />
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h1 className={styles.pageTitle}>Shortcuts</h1>
        <p className={styles.pageSubtitle}>
          Global keyboard shortcuts — they work from any app while you record. Click a shortcut to
          rebind it.
        </p>
      </div>

      <div className={styles.sections}>
        <Section title="Recording">{RECORDING_SHORTCUTS.map(renderRow)}</Section>
        <Section title="App">{APP_SHORTCUTS.map(renderRow)}</Section>
      </div>
    </div>
  );
}
