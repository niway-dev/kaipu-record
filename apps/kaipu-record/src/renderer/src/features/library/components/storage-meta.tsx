import { useTranslations, type Messages } from "@kaipu/i18n";
import type { Availability } from "@shared/types/library-item";
import type { LibraryVideo } from "@renderer/features/library/types";
import styles from "./storage-meta.module.css";

type LibraryMessageKey = keyof Messages["library"];

/** Maps the `availability` axis to its i18n label key. */
const AVAILABILITY_LABEL_KEYS: Record<Availability, LibraryMessageKey> = {
  local: "availabilityLocal",
  cloud: "availabilityCloud",
  "local-and-cloud": "availabilityBoth",
  "local-unavailable": "availabilityLocalUnavailable",
  unverified: "availabilityUnverified",
};

/**
 * The single location status shared by the card, row and detail page: a dot +
 * label for where the asset lives, plus a second line when the local file has
 * changes the cloud copy hasn't seen yet. Keeping it in one place stops the
 * card and row drifting apart. (The transient upload/failed states return in a
 * later plan, driven by the `transfer` axis instead of the old `storage` enum.)
 */
export function StorageMeta({ video }: { video: LibraryVideo }): React.JSX.Element {
  const t = useTranslations("library");

  return (
    <span className={styles.stored}>
      <span className={styles.line}>
        <span className={styles.dot} data-availability={video.availability} />
        {t(AVAILABILITY_LABEL_KEYS[video.availability])}
      </span>
      {video.comparison === "local-changes" && (
        <span className={styles.comparisonLine}>{t("comparisonLocalChanges")}</span>
      )}
    </span>
  );
}
