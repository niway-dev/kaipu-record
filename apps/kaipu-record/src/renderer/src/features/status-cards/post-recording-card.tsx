import { Ellipsis, Library, Scissors, Shield } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations, type Messages } from "@kaipu/i18n";
import { formatDuration } from "@renderer/features/library/format";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import type { DestinationId } from "@renderer/features/prepare/destinations";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import { StatusCard, StatusCardActions, StatusCardButton, StatusCardText } from "./status-card";
import styles from "./post-recording-card.module.css";

/** The three places a fresh recording goes most; "More places" opens Prepare on none. */
const CHIPS = [
  { destination: "youtube", name: "chipYoutube" },
  { destination: "vertical", name: "chipVertical" },
  { destination: "github", name: "chipGithub" },
] as const satisfies ReadonlyArray<{
  destination: DestinationId;
  name: keyof Messages["postRecording"];
}>;

export interface PostRecordingCardProps {
  durationSeconds: number;
  /** Width × height once the file has been read; left out until then. */
  dimensions: { width: number; height: number } | null;
  sizeBytes: number;
  /** A chip: Prepare on that destination, or with nothing preselected (null). */
  onPick(destination: DestinationId | null): void;
  /** "Edit first"; omitted when the recording cannot open in the editor. */
  onEditFirst?(): void;
  /** ✕ and "Open": the card shows on the recording's own page, so opening it is closing this. */
  onDismiss(): void;
}

/**
 * "Your video is ready" (NIW2-584): the top-right card the recording page shows right after
 * a recording. It asks where the video is going, with chips into Prepare, and stays until the
 * user picks something, closes it or leaves the page — there is no timer, since the question
 * is the point. Settings → Export quality turns it off.
 */
export function PostRecordingCard({
  durationSeconds,
  dimensions,
  sizeBytes,
  onPick,
  onEditFirst,
  onDismiss,
}: PostRecordingCardProps): React.JSX.Element {
  const t = useTranslations("postRecording");
  const subtitle = [
    formatDuration(durationSeconds),
    dimensions && t("dimensions", dimensions),
    formatMB(sizeBytes),
  ]
    .filter(Boolean)
    .join(" · ");
  const title = t("title");

  return (
    <StatusCard
      label={title}
      wide
      plainIcon
      icon={<KaipuLogo use="done" size={42} />}
      title={title}
      subtitle={subtitle}
      badge={
        <span className={styles.master}>
          <Shield size={10} strokeWidth={2} aria-hidden />
          {t("masterTag")}
        </span>
      }
      onDismiss={onDismiss}
      dismissLabel={t("dismiss")}
      footer={t("footer")}
    >
      <StatusCardText>{t("question")}</StatusCardText>
      <ul className={styles.chips}>
        {CHIPS.map((c) => (
          <li key={c.destination}>
            <button
              type="button"
              className={styles.chip}
              aria-label={t("chipAria", { destination: t(c.name) })}
              onClick={() => onPick(c.destination)}
            >
              <DestinationLogo destination={c.destination} size={24} />
              {t(c.name)}
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className={styles.chip}
            data-more="true"
            onClick={() => onPick(null)}
          >
            <Ellipsis size={14} strokeWidth={1.9} aria-hidden />
            {t("more")}
          </button>
        </li>
      </ul>
      <StatusCardActions equal>
        {onEditFirst && (
          <StatusCardButton onClick={onEditFirst}>
            <Scissors size={14} strokeWidth={1.8} />
            {t("editFirst")}
          </StatusCardButton>
        )}
        <StatusCardButton title={t("openHint")} onClick={onDismiss}>
          <Library size={14} strokeWidth={1.8} />
          {t("open")}
        </StatusCardButton>
      </StatusCardActions>
    </StatusCard>
  );
}
