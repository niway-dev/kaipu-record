import type { ReactNode } from "react";
import { Upload } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import { DESTINATION_IDS, groupOf, planCopy, presetForDestination } from "../destinations";
import type { DestinationId } from "../destinations";
import { DESTINATION_COPY } from "../destination-copy";
import { DestinationLogo } from "./destination-logo";
import styles from "./destinations-panel.module.css";

interface DestinationsPanelProps {
  /** The recording's file size: the archive card's number, and the base for the others. */
  sizeBytes: number;
  /** The recording as read from the file; the cards show no estimate until it is. */
  probe: SourceProbe | null;
  onPick(destination: DestinationId): void;
  /** "Not now": hides the panel; the page then offers "Export a copy" among its actions. */
  onDismiss(): void;
  /** An extra line under the cards (the "heavy to send" hint). */
  note?: ReactNode;
}

/**
 * "Where is it going?" (Export v3, section 1): the recording page's question before the first
 * copy exists. Every destination is one equal card — its logo, name, short line and the size
 * of the copy it would make, amber where the platform compresses again (bigger on purpose),
 * teal where the file plays as it is. A card opens Export on that destination.
 */
export function DestinationsPanel({
  sizeBytes,
  probe,
  onPick,
  onDismiss,
  note,
}: DestinationsPanelProps): React.JSX.Element {
  const t = useTranslations("library");
  const tPrepare = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");

  const estimate = (destination: DestinationId): string | null => {
    if (destination === "archive") return formatMB(sizeBytes);
    if (!probe) return null;
    const plan = planCopy({
      destination,
      presetId: presetForDestination(destination, probe),
      source: probe,
      durationSec: probe.durationSec,
      sourceSizeBytes: sizeBytes,
    });
    if (plan.estimateBytes === null) return tEditor("sizeFull");
    const size = formatMB(plan.estimateBytes);
    return plan.sizeKind === "up-to"
      ? tEditor("sizeUpTo", { size })
      : tEditor("sizeAbout", { size });
  };

  return (
    <section className={styles.panel} aria-labelledby="destinations-heading">
      <div className={styles.head}>
        <Upload size={16} strokeWidth={1.8} className={styles.icon} aria-hidden />
        <div className={styles.headText}>
          <h2 id="destinations-heading" className={styles.title}>
            {t("destinationsTitle")}
          </h2>
          <p className={styles.body}>{t("destinationsBody")}</p>
        </div>
        <button type="button" className={styles.notNow} onClick={onDismiss}>
          {t("destinationsNotNow")}
        </button>
      </div>
      <ul className={styles.cards}>
        {DESTINATION_IDS.map((destination) => {
          const name = tPrepare(DESTINATION_COPY[destination].name);
          const size = estimate(destination);
          return (
            <li key={destination} className={styles.cardItem}>
              <button
                type="button"
                className={styles.card}
                aria-label={t("destinationAria", { destination: name })}
                onClick={() => onPick(destination)}
              >
                <DestinationLogo destination={destination} size={34} />
                <span className={styles.name}>{name}</span>
                <span className={styles.line}>{tPrepare(DESTINATION_COPY[destination].line)}</span>
                <span
                  className={styles.size}
                  data-tone={groupOf(destination) === "send-more" ? "upload" : "light"}
                >
                  {size ?? "…"}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {note}
    </section>
  );
}
