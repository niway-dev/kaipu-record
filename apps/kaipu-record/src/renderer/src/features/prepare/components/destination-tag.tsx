import { useTranslations } from "@kaipu/i18n";
import type { DestinationId } from "../destinations";
import styles from "./destination-tag.module.css";

/**
 * "FOR YOUTUBE", "FOR GITHUB"…: marks a copy on its poster with where it is going, on the
 * destination's own colour — the copy's counterpart of the original's master tag.
 */
export function DestinationTag({
  destination,
  size = "sm",
}: {
  destination: DestinationId;
  size?: "sm" | "md";
}): React.JSX.Element {
  const t = useTranslations("backgroundCopy");
  return (
    <span className={styles.tag} data-destination={destination} data-size={size}>
      {t("destinationTag", { destination })}
    </span>
  );
}
