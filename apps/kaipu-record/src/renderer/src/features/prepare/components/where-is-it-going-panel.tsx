import { CircleCheck, Scissors } from "lucide-react";
import { useTranslations, type Messages } from "@kaipu/i18n";
import { formatDuration } from "@renderer/features/library/format";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import type { DestinationId } from "../destinations";
import { DestinationLogo } from "./destination-logo";
import styles from "./where-is-it-going-panel.module.css";

type PrepareKey = keyof Messages["prepare"];

/** The four most common places, then "More places" (Prepare with nothing preselected). */
const SHORTCUTS = [
  { destination: "youtube", name: "destYoutube", sub: "panelYoutubeSub" },
  { destination: "vertical", name: "panelVerticalName", sub: "panelVerticalSub" },
  { destination: "github", name: "panelGithubName", sub: "panelGithubSub" },
  { destination: "chat", name: "panelChatName", sub: "panelChatSub" },
] as const satisfies ReadonlyArray<{
  destination: DestinationId;
  name: PrepareKey;
  sub: PrepareKey;
}>;

export interface WhereIsItGoingPanelProps {
  thumbnailUrl: string | null;
  durationSeconds: number;
  /** Width × height once the file has been read; left out until then. */
  dimensions: { width: number; height: number } | null;
  sizeBytes: number;
  /** A shortcut: Prepare on that destination, or with nothing preselected (null). */
  onPick(destination: DestinationId | null): void;
  /** "Edit first"; omitted when the recording cannot open in the editor. */
  onEditFirst?(): void;
  /** "Not now": the recording stays in the Library, and Prepare stays one click away. */
  onDismiss(): void;
}

/**
 * Right after a recording (NIW2-578): the first nudge toward Prepare. Its page asks where the
 * video is going, with shortcuts to the most common places. It stays until the user picks one
 * or says "Not now" — never a dead end, since the same entry lives on the page and in the
 * Library. Settings → Export quality turns it off.
 */
export function WhereIsItGoingPanel({
  thumbnailUrl,
  durationSeconds,
  dimensions,
  sizeBytes,
  onPick,
  onEditFirst,
  onDismiss,
}: WhereIsItGoingPanelProps): React.JSX.Element {
  const t = useTranslations("prepare");
  const meta = [
    formatDuration(durationSeconds),
    dimensions && t("pictureSize", dimensions),
    formatMB(sizeBytes),
    t("panelMetaNote"),
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section className={styles.panel} aria-label={t("panelLabel")}>
      <div className={styles.head}>
        {thumbnailUrl ? (
          <img src={thumbnailUrl} alt="" className={styles.thumb} />
        ) : (
          <span className={styles.thumb} aria-hidden />
        )}
        <div className={styles.headText}>
          <p className={styles.saved}>
            <CircleCheck size={15} strokeWidth={2} aria-hidden />
            {t("panelSaved")}
          </p>
          <h2 className={styles.title}>{t("panelTitle")}</h2>
          <p className={styles.meta}>{meta}</p>
        </div>
      </div>

      <ul className={styles.shortcuts}>
        {SHORTCUTS.map((s) => (
          <li key={s.destination}>
            <button type="button" className={styles.shortcut} onClick={() => onPick(s.destination)}>
              <DestinationLogo destination={s.destination} size={40} />
              <span className={styles.shortcutName}>{t(s.name)}</span>
              <span className={styles.shortcutSub}>{t(s.sub)}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={styles.shortcut}
            data-more="true"
            onClick={() => onPick(null)}
          >
            <DestinationLogo destination="more" size={40} />
            <span className={styles.shortcutName}>{t("panelMore")}</span>
          </button>
        </li>
      </ul>

      <div className={styles.footer}>
        {onEditFirst && (
          <button type="button" className={styles.secondary} onClick={onEditFirst}>
            <Scissors size={14} strokeWidth={1.8} />
            {t("panelEditFirst")}
          </button>
        )}
        <span className={styles.spacer} />
        <button type="button" className={styles.dismiss} onClick={onDismiss}>
          {t("panelNotNow")}
        </button>
      </div>
    </section>
  );
}
