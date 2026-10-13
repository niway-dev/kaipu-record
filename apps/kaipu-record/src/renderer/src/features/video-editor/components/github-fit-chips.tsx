import { Check, TriangleAlert } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  GITHUB_FREE_LIMIT_BYTES,
  GITHUB_PAID_LIMIT_BYTES,
  githubPlans,
} from "../export/export-presets";
import { formatMB } from "../export/export-size";
import styles from "./github-fit-chips.module.css";

/**
 * Two small chips side by side: does this file attach on GitHub Free (10 MB) and on
 * Pro / Team / Enterprise (100 MB)? From the estimate in the sheet, the real size on the
 * Ready card. Information only — exporting is never blocked.
 */
export function GithubFitChips({ bytes }: { bytes: number }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const fits = githubPlans(bytes);
  const free = formatMB(GITHUB_FREE_LIMIT_BYTES);
  const paid = formatMB(GITHUB_PAID_LIMIT_BYTES);
  return (
    <ul className={styles.chips} aria-label={t("githubFitLabel")}>
      <li className={styles.chip} data-fits={fits.free}>
        {fits.free ? <Check size={11} strokeWidth={2.4} aria-hidden /> : null}
        {fits.free ? t("githubFree", { limit: free }) : t("githubFreeOver", { limit: free })}
      </li>
      <li className={styles.chip} data-fits={fits.paid} data-warn={!fits.paid}>
        {fits.paid ? (
          <Check size={11} strokeWidth={2.4} aria-hidden />
        ) : (
          <TriangleAlert size={11} strokeWidth={2} aria-hidden />
        )}
        {fits.paid ? t("githubPaid", { limit: paid }) : t("factGithubTooBig")}
      </li>
    </ul>
  );
}
