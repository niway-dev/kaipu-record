import React from "react";
import { Camera, Video, type LucideIcon } from "lucide-react";
import styles from "./panel-tabs.module.css";

/** The two modes the Capture Panel can show. `as const` (no TS enum) so the values
 *  and the type share one source. */
export const PANEL_TABS = ["record", "capture"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const META: Record<PanelTab, { label: string; Icon: LucideIcon }> = {
  record: { label: "Record", Icon: Video },
  capture: { label: "Capture", Icon: Camera },
};

/**
 * Segmented control that switches the panel between recording controls and the
 * screenshot action. Purely presentational — the active tab and lock state are
 * owned by the CapturePanel (tabs lock to the current mode during a recording).
 * The active pill carries the brand accent (tinted, so it reads as "selected"
 * without competing with the accent-filled primary CTA below).
 */
export function PanelTabs({
  active,
  onChange,
  disabled = false,
}: {
  active: PanelTab;
  onChange: (tab: PanelTab) => void;
  disabled?: boolean;
}): React.JSX.Element {
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label="Panel mode"
      data-disabled={disabled || undefined}
    >
      {PANEL_TABS.map((tab) => {
        const { label, Icon } = META[tab];
        return (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={active === tab}
            className={styles.tab}
            data-active={active === tab || undefined}
            disabled={disabled}
            onClick={() => onChange(tab)}
          >
            <Icon size={15} strokeWidth={2.25} aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}
