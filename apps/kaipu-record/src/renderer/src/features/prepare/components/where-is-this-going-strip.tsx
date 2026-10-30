import type { ReactNode } from "react";
import { Send } from "lucide-react";
import { useTranslations, type Messages } from "@kaipu/i18n";
import type { DestinationId } from "../destinations";
import { DestinationLogo } from "./destination-logo";
import styles from "./where-is-this-going-strip.module.css";

/** The two places a recording goes most, one per group: bigger for YouTube, lighter for GitHub. */
const CHIPS = [
  { destination: "youtube", label: "whereYoutube" },
  { destination: "github", label: "whereGithub" },
] as const satisfies ReadonlyArray<{
  destination: DestinationId;
  label: keyof Messages["library"];
}>;

/**
 * "Where is this going?" (NIW2-585): the recording page's standing question under the title.
 * A chip opens Prepare on its destination; "More" opens it with nothing chosen. `note` is an
 * extra line under it (the "heavy to send" hint).
 */
export function WhereIsThisGoingStrip({
  onPick,
  note,
}: {
  onPick(destination: DestinationId | null): void;
  note?: ReactNode;
}): React.JSX.Element {
  const t = useTranslations("library");
  return (
    <section className={styles.strip} aria-labelledby="where-is-this-going">
      <div className={styles.main}>
        <Send size={18} strokeWidth={1.8} className={styles.icon} aria-hidden />
        <p className={styles.text}>
          <strong id="where-is-this-going">{t("whereTitle")}</strong> {t("whereBody")}
        </p>
        <div className={styles.chips}>
          {CHIPS.map((chip) => (
            <button
              key={chip.destination}
              type="button"
              className={styles.chip}
              aria-label={t("whereChipAria", { destination: t(chip.label) })}
              onClick={() => onPick(chip.destination)}
            >
              <DestinationLogo destination={chip.destination} size={22} />
              {t(chip.label)}
            </button>
          ))}
          <button
            type="button"
            className={styles.more}
            aria-label={t("whereMoreAria")}
            onClick={() => onPick(null)}
          >
            {t("whereMore")}
          </button>
        </div>
      </div>
      {note}
    </section>
  );
}
