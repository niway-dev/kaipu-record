import { AppWindow, Camera, Library, Video, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { KaipuLogo } from "@kaipu/brand";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import { uiArea } from "@renderer/lib/ui-area";
import common from "./step.module.css";
import styles from "./done-step.module.css";

function Place({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}): React.JSX.Element {
  return (
    <div className={`${common.card} ${styles.place}`}>
      <span className={styles.placeIcon}>
        <Icon size={17} strokeWidth={1.8} />
      </span>
      <div>
        <p className={styles.placeTitle}>{title}</p>
        <p className={styles.placeDesc}>{description}</p>
      </div>
    </div>
  );
}

interface DoneStepProps {
  /** Closes the onboarding and opens the capture widget to record. */
  onRecord: () => void;
  /** Closes the onboarding and opens the capture widget for a screenshot. */
  onScreenshot: () => void;
}

/** You're set: where Kaipu lives, and two ways out. */
export function DoneStep({ onRecord, onScreenshot }: DoneStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  const windows = isWindowsHost();
  // The live bindings, never literals: the user can rebind them on the Shortcuts page.
  const shortcuts = useShortcutLabels();
  return (
    <div {...uiArea("onboarding.doneStep")} className={`${common.step} ${styles.step}`}>
      <span className={common.mark}>
        <KaipuLogo use="done" size={84} />
      </span>
      <h1 className={common.title}>{t("doneTitle")}</h1>
      <p className={common.subtitle}>{t(windows ? "doneSubtitleWindows" : "doneSubtitle")}</p>

      <div className={styles.places}>
        <Place
          icon={AppWindow}
          title={t(windows ? "menuBarTitleWindows" : "menuBarTitle")}
          description={t(windows ? "menuBarDescWindows" : "menuBarDesc")}
        />
        <Place icon={Library} title={t("libraryTitle")} description={t("libraryDesc")} />
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.record} onClick={onRecord}>
          <Video size={17} strokeWidth={1.8} /> {t("doneRecord")}
          {shortcuts && <kbd className={styles.hint}>{shortcuts.startRecording}</kbd>}
        </button>
        <button type="button" className={styles.screenshot} onClick={onScreenshot}>
          <Camera size={17} strokeWidth={1.8} /> {t("doneScreenshot")}
          {shortcuts && <kbd className={styles.hintMuted}>{shortcuts.captureScreenshot}</kbd>}
        </button>
      </div>
    </div>
  );
}
