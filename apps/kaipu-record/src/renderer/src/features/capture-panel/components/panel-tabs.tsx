import React from "react";
import { Camera, Video, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import styles from "./panel-tabs.module.css";

/** The two modes the Capture Panel can show. `as const` (no TS enum) so the values
 *  and the type share one source. */
export const PANEL_TABS = ["record", "capture"] as const;
export type PanelTab = (typeof PANEL_TABS)[number];

const META: Record<PanelTab, { labelKey: "tabRecord" | "tabCapture"; Icon: LucideIcon }> = {
  record: { labelKey: "tabRecord", Icon: Video },
  capture: { labelKey: "tabCapture", Icon: Camera },
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
  const t = useTranslations("panel");
  return (
    <div
      className={styles.tabs}
      role="tablist"
      aria-label={t("panelMode")}
      data-disabled={disabled || undefined}
    >
      {PANEL_TABS.map((tab) => {
        const { labelKey, Icon } = META[tab];
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
            {t(labelKey)}
          </button>
        );
      })}
    </div>
  );
}
