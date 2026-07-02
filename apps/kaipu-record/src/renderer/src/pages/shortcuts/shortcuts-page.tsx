import React from "react";
import { Card } from "@renderer/ui/card";
import { Row } from "@renderer/ui/row";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { ShortcutInput } from "@renderer/features/shortcuts/shortcut-input";
import { conflictingAction } from "@renderer/features/shortcuts/keyboard-accelerator";
import {
  DEFAULT_SHORTCUTS,
  SHORTCUT_DEFINITIONS,
  type ShortcutAction,
  type ShortcutDefinition,
  type ShortcutGroup,
} from "@shared/types";
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

/** On-screen sections, in order. Their rows come from SHORTCUT_DEFINITIONS. */
const GROUPS: ReadonlyArray<{ key: ShortcutGroup; title: string }> = [
  { key: "recording", title: "Recording" },
  { key: "app", title: "App" },
];

const shortcutsInGroup = (group: ShortcutGroup): ShortcutDefinition[] =>
  SHORTCUT_DEFINITIONS.filter((def) => def.group === group);

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

  // A just-rejected rebind because the combo is already used by another Kaipu
  // action. Cleared on the next successful change.
  const [duplicate, setDuplicate] = React.useState<{
    action: ShortcutAction;
    withAction: ShortcutAction;
  } | null>(null);

  const handleChange = (action: ShortcutAction, accelerator: string): void => {
    const clash = conflictingAction(shortcuts, action, accelerator);
    if (clash) {
      // Reject rather than save — saving would let one of the two bindings
      // silently fail to register (and get mislabeled "in use by another app").
      setDuplicate({ action, withAction: clash });
      return;
    }
    setDuplicate(null);
    void update({ shortcuts: { ...shortcuts, [action]: accelerator } });
  };

  const labelFor = (action: ShortcutAction): string =>
    SHORTCUT_DEFINITIONS.find((d) => d.action === action)?.label ?? action;

  const renderRow = ({ action, label, description }: ShortcutDefinition): React.JSX.Element => {
    const isDuplicate = duplicate?.action === action;
    // Two distinct failure modes, distinct copy: a clash with another Kaipu
    // action (detected here, at bind time) vs the combo being owned by another
    // app (only known once registration fails).
    const ownedByOtherApp = shortcutStatus ? !shortcutStatus[action] : false;
    const note = isDuplicate
      ? `${description} · already bound to “${labelFor(duplicate.withAction)}”`
      : ownedByOtherApp
        ? `${description} · in use by another app`
        : description;
    return (
      <Row
        key={action}
        label={label}
        description={note}
        action={
          <ShortcutInput
            value={shortcuts[action]}
            unavailable={ownedByOtherApp || isDuplicate}
            title={
              isDuplicate
                ? `Already bound to “${labelFor(duplicate.withAction)}” — pick a different combo`
                : undefined
            }
            onChange={(accelerator) => handleChange(action, accelerator)}
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
        {GROUPS.map(({ key, title }) => (
          <Section key={key} title={title}>
            {shortcutsInGroup(key).map(renderRow)}
          </Section>
        ))}
      </div>
    </div>
  );
}
