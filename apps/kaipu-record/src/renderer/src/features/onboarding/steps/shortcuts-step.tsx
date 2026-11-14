import { useEffect, useState } from "react";
import { AppWindow, Camera, Check, ScanLine, Video, type LucideIcon } from "lucide-react";
import type { AppSettings, ShortcutAction } from "@shared/types";
import { useTranslations } from "@kaipu/i18n";
import { acceleratorKeys } from "@renderer/features/shortcuts/keyboard-accelerator";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { uiArea } from "@renderer/lib/ui-area";
import { ONBOARDING_SHORTCUTS, triedShortcutCount } from "../onboarding-flow";
import common from "./step.module.css";
import styles from "./shortcuts-step.module.css";

type CardText = {
  title: "scCaptureTitle" | "scRecordTitle" | "scInstantTitle" | "scShowTitle";
  desc: "scCaptureDesc" | "scRecordDesc" | "scInstantDesc" | "scShowDesc" | "scShowDescWindows";
  icon: LucideIcon;
};

function cardText(action: ShortcutAction): CardText {
  switch (action) {
    case "captureScreenshot":
      return { title: "scCaptureTitle", desc: "scCaptureDesc", icon: Camera };
    case "startRecording":
      return { title: "scRecordTitle", desc: "scRecordDesc", icon: Video };
    case "captureInstant":
      return { title: "scInstantTitle", desc: "scInstantDesc", icon: ScanLine };
    default:
      return {
        title: "scShowTitle",
        desc: isWindowsHost() ? "scShowDescWindows" : "scShowDesc",
        icon: AppWindow,
      };
  }
}

/** The live bindings, so a rebind on the Shortcuts page shows here at once. `null` until read. */
function useShortcutBindings(): AppSettings["shortcuts"] | null {
  const [shortcuts, setShortcuts] = useState<AppSettings["shortcuts"] | null>(null);
  useEffect(() => {
    const apply = (settings: AppSettings): void => setShortcuts(settings.shortcuts);
    void window.electronAPI.getSettings().then(apply);
    return window.electronAPI.onSettingsChanged(apply);
  }, []);
  return shortcuts;
}

interface ShortcutsStepProps {
  /** The shortcuts pressed while this step was open. Only a real press counts. */
  tried: ReadonlySet<ShortcutAction>;
}

/** Shortcuts: the four that make up the app, each marked once it is really pressed. */
export function ShortcutsStep({ tried }: ShortcutsStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  const shortcuts = useShortcutBindings();
  const count = triedShortcutCount(tried);

  return (
    <div {...uiArea("onboarding.shortcutsStep")} className={`${common.step} ${styles.step}`}>
      <h1 className={common.title}>{t("shortcutsTitle")}</h1>
      <p className={`${common.subtitle} ${styles.subtitle}`}>{t("shortcutsSubtitle")}</p>

      <ul className={styles.cards}>
        {ONBOARDING_SHORTCUTS.map((action) => {
          const on = tried.has(action);
          const { title, desc, icon: Icon } = cardText(action);
          const keys = shortcuts ? acceleratorKeys(shortcuts[action]) : [];
          return (
            <li
              key={action}
              data-shortcut={action}
              data-tried={on || undefined}
              className={`${common.card} ${styles.card} ${on ? styles.cardTried : ""}`}
            >
              <div className={styles.cardHead}>
                <span className={styles.keys} aria-label={keys.join(" ")}>
                  {keys.map((key, i) => (
                    <kbd key={i} className={on ? styles.keyOn : styles.key}>
                      {key}
                    </kbd>
                  ))}
                </span>
                {on ? (
                  <span className={styles.tried}>
                    <Check size={13} strokeWidth={2.4} /> {t("tried")}
                  </span>
                ) : (
                  <span className={styles.cardIcon}>
                    <Icon size={16} strokeWidth={1.8} />
                  </span>
                )}
              </div>
              <p className={styles.cardTitle}>{t(title)}</p>
              <p className={styles.cardDesc}>{t(desc)}</p>
            </li>
          );
        })}
      </ul>

      <p className={count === 4 ? styles.countAll : styles.count} aria-live="polite">
        {count === 4 ? t("triedAll") : t("triedCount", { count })}
      </p>
      <p className={`${common.note} ${styles.change}`}>{t("shortcutsChange")}</p>
    </div>
  );
}
