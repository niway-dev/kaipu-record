import { ArrowLeft, Check, Import } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  type CopyPlan,
  DESTINATION_GROUPS,
  type DestinationGroupId,
  type DestinationId,
} from "@renderer/features/prepare/destinations";
import { DESTINATION_COPY } from "@renderer/features/prepare/destination-copy";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import styles from "./destination-list.module.css";

/** Each group's label in the list: the action and its rule in one line. */
const GROUP_LABEL = {
  "send-more": "groupPostLabel",
  "keep-light": "groupSendLabel",
  keep: "groupKeepLabel",
} as const satisfies Record<DestinationGroupId, string>;

/** What the rows show about each copy; there is none before a video is picked (NIW2-587). */
export interface DestinationSizes {
  planFor(destination: DestinationId): CopyPlan;
  /** The estimate alone ("~570 MB"); "up to" is set above it when the estimate is a ceiling. */
  estimateText(plan: CopyPlan): string;
  /** A copy of this destination already exists from the whole recording. */
  isReady(destination: DestinationId): boolean;
}

interface DestinationListProps {
  /** Null when nothing is chosen yet: Prepare with no recording selects nothing. */
  selected: DestinationId | null;
  onSelect(destination: DestinationId): void;
  /** Omitted with no recording: the rows show no size. */
  sizes?: DestinationSizes;
  /** "Back to recording", or "Back to Library" with no recording. */
  backLabel: string;
  onBack(): void;
  onPrepareAnother(): void;
  /** Files are being dragged over the window: the footer lights up as a target. */
  dropActive: boolean;
  importing: boolean;
}

/**
 * The left column: back, the destinations grouped by who compresses the video last, and
 * "Prepare another video" pinned to the bottom. A video dropped anywhere on Prepare is
 * caught by the window (`usePrepareImport`), so the footer only shows where.
 */
export function DestinationList({
  selected,
  onSelect,
  sizes,
  backLabel,
  onBack,
  onPrepareAnother,
  dropActive,
  importing,
}: DestinationListProps): React.JSX.Element {
  const t = useTranslations("prepare");
  return (
    <div className={styles.list}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
        {backLabel}
      </button>

      <div role="radiogroup" aria-label={t("pageTitle")} className={styles.groups}>
        {DESTINATION_GROUPS.map((group) => (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupLabel} data-group={group.id}>
              {t(GROUP_LABEL[group.id])}
            </div>
            {group.destinations.map((d) => {
              const plan = sizes?.planFor(d);
              const line =
                d === "github" && plan?.underGithubFreeLimit
                  ? t("lineGithubUnderLimit")
                  : t(DESTINATION_COPY[d].line);
              return (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={selected === d}
                  className={styles.row}
                  data-active={selected === d}
                  onClick={() => onSelect(d)}
                >
                  <DestinationLogo destination={d} size={34} />
                  <span className={styles.rowText}>
                    <span className={styles.rowName}>{t(DESTINATION_COPY[d].name)}</span>
                    <span className={styles.rowLine}>{line}</span>
                  </span>
                  {sizes && plan && <RowSize sizes={sizes} destination={d} plan={plan} />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        <button
          type="button"
          className={styles.another}
          data-active={dropActive}
          disabled={importing}
          onClick={onPrepareAnother}
        >
          <Import size={15} strokeWidth={1.8} className={styles.anotherIcon} aria-hidden />
          <span className={styles.anotherText}>
            <span className={styles.anotherTitle}>
              {importing ? t("dropImporting") : dropActive ? t("dropActive") : t("anotherTitle")}
            </span>
            <span className={styles.anotherHint}>{t("anotherHint")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}

/** "Ready" when the copy already exists, else its estimated size. */
function RowSize({
  sizes,
  destination,
  plan,
}: {
  sizes: DestinationSizes;
  destination: DestinationId;
  plan: CopyPlan;
}): React.JSX.Element {
  const t = useTranslations("prepare");
  if (sizes.isReady(destination)) {
    return (
      <span className={styles.ready}>
        <Check size={11} strokeWidth={2.4} aria-hidden />
        {t("readyBadge")}
      </span>
    );
  }
  return (
    <span className={styles.size} data-direction={plan.direction}>
      {plan.sizeKind === "up-to" && <span className={styles.sizeQualifier}>{t("listUpTo")}</span>}
      {sizes.estimateText(plan)}
    </span>
  );
}
