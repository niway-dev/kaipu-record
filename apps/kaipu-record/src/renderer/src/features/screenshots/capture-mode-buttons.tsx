import React from "react";
import { Frame, Monitor, SquareDashed, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { CAPTURE_MODES, type CaptureMode } from "@shared/types/screenshot-capture";
import type { ShortcutAction } from "@shared/types";
import type { ShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { useSupportedCaptureModes } from "./use-supported-capture-modes";
import styles from "./capture-mode-buttons.module.css";

const MODE_ICON: Record<CaptureMode, LucideIcon> = {
  area: SquareDashed,
  screen: Monitor,
  frame: Frame,
};

const MODE_SHORTCUT: Record<CaptureMode, ShortcutAction> = {
  area: "captureScreenshot",
  screen: "captureScreen",
  frame: "captureFrame",
};

const MODE_LABEL = {
  area: "modeArea",
  screen: "modeScreen",
  frame: "modeFrame",
} as const satisfies Record<CaptureMode, string>;

interface CaptureModeButtonsProps {
  /** `panel`: stacked rows for the tray panel. `page`: a row of cards for the Screenshots page. */
  variant: "panel" | "page";
  onCapture: (mode: CaptureMode) => void;
  /** Current bindings as display labels; a missing one just hides that hint. */
  shortcuts: ShortcutLabels | null;
}

/**
 * The three capture entry points (Area, Screen, Frame), shared by the tray panel and the
 * Screenshots page. A mode the platform cannot serve stays visible but disabled, with the
 * reason in place of its shortcut: hiding it would leave no explanation, and a live button
 * would be a silent no-op.
 */
export function CaptureModeButtons({
  variant,
  onCapture,
  shortcuts,
}: CaptureModeButtonsProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const supported = useSupportedCaptureModes();
  // Windows is the one platform whose screenshots are announced as upcoming.
  const unavailableLabel = /Windows/i.test(navigator.userAgent)
    ? t("comingToWindows")
    : t("notAvailable");

  return (
    <div className={styles.group} data-variant={variant}>
      {CAPTURE_MODES.map((mode) => {
        const Icon = MODE_ICON[mode];
        // Until main answers, keep the buttons enabled: the capture itself still answers
        // `unsupported` safely, and a flash of disabled buttons on every open is worse.
        const available = supported === null || supported.includes(mode);
        const shortcut = shortcuts?.[MODE_SHORTCUT[mode]];
        return (
          <button
            key={mode}
            type="button"
            className={styles.button}
            disabled={!available}
            onClick={() => onCapture(mode)}
          >
            <span className={styles.label}>
              <Icon size={variant === "page" ? 20 : 16} />
              {t(MODE_LABEL[mode])}
            </span>
            {!available ? (
              <span className={styles.note}>{unavailableLabel}</span>
            ) : (
              shortcut && <kbd className={styles.shortcut}>{shortcut}</kbd>
            )}
          </button>
        );
      })}
    </div>
  );
}
