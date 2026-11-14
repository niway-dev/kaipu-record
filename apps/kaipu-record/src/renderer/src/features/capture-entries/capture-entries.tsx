import React from "react";
import { Camera, ChevronRight, Video, type LucideIcon } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { ShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import type { UiAreaProps } from "@renderer/lib/ui-area";
import styles from "./capture-entries.module.css";

interface CaptureEntriesProps {
  /** `card`: the Capture page's two equal cards. `row`: the tray popover's compact rows. */
  variant: "card" | "row";
  /** Current bindings as display labels; a missing one just hides that keycap. */
  shortcuts: ShortcutLabels | null;
  /** The last used mode, as a label ("Frame"); the card variant shows it, the row never does. */
  screenshotLastUsed?: string;
  recordingLastUsed?: string;
  /** Open the selector with the capture intent, in the last used screenshot mode. */
  onScreenshot(): void;
  /** Open the selector with the record intent, in the last used recording mode. */
  onRecording(): void;
  /** Catalog areas: the two entries, and the Instant line. */
  screenshotUi?: UiAreaProps;
  recordingUi?: UiAreaProps;
  instantUi?: UiAreaProps;
}

interface EntryProps {
  variant: "card" | "row";
  Icon: LucideIcon;
  title: string;
  hint: string;
  shortcut?: string;
  lastUsed?: string;
  onClick(): void;
  ui?: UiAreaProps;
}

function Entry({
  variant,
  Icon,
  title,
  hint,
  shortcut,
  lastUsed,
  onClick,
  ui,
}: EntryProps): React.JSX.Element {
  const t = useTranslations("record");
  const isCard = variant === "card";
  return (
    <button {...ui} type="button" className={styles.entry} onClick={onClick}>
      <span className={styles.tile} aria-hidden>
        <Icon size={isCard ? 21 : 15} />
      </span>
      <span className={styles.text}>
        <span className={styles.title}>{title}</span>
        {isCard && <span className={styles.hint}>{hint}</span>}
        {isCard && lastUsed && (
          <span className={styles.lastUsed}>{t("lastUsedLine", { mode: lastUsed })}</span>
        )}
      </span>
      <span className={styles.trailing}>
        {shortcut && <kbd className={styles.keycap}>{shortcut}</kbd>}
        {isCard && <ChevronRight size={16} className={styles.chevron} aria-hidden />}
      </span>
    </button>
  );
}

/**
 * The two capture entries of the design "Kaipu Capture Home", and the Instant line under
 * them. Each entry opens the selector (the capture widget): Screenshot with the capture
 * intent, Recording with the record intent. Nothing here captures or starts a take.
 *
 * The same pair of entries lives in two places, so the variant decides the density: the
 * page shows cards with a description and the last used mode; the tray popover shows
 * 44px rows with the title and the keycap only.
 */
export function CaptureEntries({
  variant,
  shortcuts,
  screenshotLastUsed,
  recordingLastUsed,
  onScreenshot,
  onRecording,
  screenshotUi,
  recordingUi,
  instantUi,
}: CaptureEntriesProps): React.JSX.Element {
  const t = useTranslations("record");
  const instant = shortcuts?.captureInstant;
  return (
    <div className={styles.root} data-variant={variant}>
      <div className={styles.entries}>
        <Entry
          variant={variant}
          Icon={Camera}
          title={t("screenshotTitle")}
          hint={t("screenshotHint")}
          shortcut={shortcuts?.captureScreenshot}
          lastUsed={screenshotLastUsed}
          onClick={onScreenshot}
          ui={screenshotUi}
        />
        <Entry
          variant={variant}
          Icon={Video}
          title={t("recordingTitle")}
          hint={t("recordingHint")}
          shortcut={shortcuts?.startRecording}
          lastUsed={recordingLastUsed}
          onClick={onRecording}
          ui={recordingUi}
        />
      </div>
      {instant && (
        <p {...instantUi} className={styles.instant}>
          <kbd className={styles.keycap}>{instant}</kbd>
          {variant === "card" ? (
            <>
              <b className={styles.instantTitle}>{t("instantTitle")}</b>
              <span>{t("instantHint")}</span>
            </>
          ) : (
            <span>{t("instantShort")}</span>
          )}
        </p>
      )}
    </div>
  );
}
