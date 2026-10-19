import { useTranslations } from "@kaipu/i18n";
import { formatMB, percentLighter } from "../export/export-size";
import styles from "./size-meter.module.css";

export interface SizeMeterProps {
  /** The original recording's file size. */
  originalBytes: number;
  /** The copy's size (estimate or real); null when unknown (Maximum quality). */
  resultBytes: number | null;
  /** What the right side says about the copy, e.g. "~9.2 MB" or "Up to ~78 MB". */
  label: string;
}

/**
 * Before/after bar (NIW2-218 export redesign): the original's size on the left, the copy's
 * on the right with how much lighter it is, and a bar whose fill is the copy's share of the
 * original. The saving is the point, so it is the one thing in teal.
 */
export function SizeMeter({
  originalBytes,
  resultBytes,
  label,
}: SizeMeterProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const lighter = percentLighter(resultBytes, originalBytes);
  const share =
    resultBytes === null || originalBytes <= 0 ? 1 : Math.min(1, resultBytes / originalBytes);
  return (
    <div className={styles.meter}>
      <div className={styles.labels}>
        <span className={styles.original}>
          {t("meterOriginal", { size: formatMB(originalBytes) })}
        </span>
        <span className={styles.result}>
          <strong>{label}</strong>
          {lighter !== null && (
            <span className={styles.lighter}> · {t("meterLighter", { percent: lighter })}</span>
          )}
        </span>
      </div>
      <div className={styles.track} aria-hidden>
        <div
          className={styles.fill}
          data-lighter={lighter !== null}
          style={{ width: `${Math.max(3, share * 100)}%` }}
        />
      </div>
    </div>
  );
}
