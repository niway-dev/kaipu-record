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

interface DestinationListProps {
  selected: DestinationId;
  onSelect(destination: DestinationId): void;
  planFor(destination: DestinationId): CopyPlan;
  /** The estimate alone ("~570 MB"); "up to" is set above it when the estimate is a ceiling. */
  estimateText(plan: CopyPlan): string;
  /** A copy of this destination already exists from the whole recording. */
  isReady(destination: DestinationId): boolean;
  onBack(): void;
  onPrepareAnother(): void;
}

/**
 * The left column: back to the recording, the destinations grouped by who compresses the
 * video last, and "Prepare another video" pinned to the bottom.
 */
export function DestinationList({
  selected,
  onSelect,
  planFor,
  estimateText,
  isReady,
  onBack,
  onPrepareAnother,
}: DestinationListProps): React.JSX.Element {
  const t = useTranslations("prepare");
  return (
    <div className={styles.list}>
      <button type="button" className={styles.back} onClick={onBack}>
        <ArrowLeft size={15} strokeWidth={1.8} aria-hidden />
        {t("back")}
      </button>

      <div role="radiogroup" aria-label={t("pageTitle")} className={styles.groups}>
        {DESTINATION_GROUPS.map((group) => (
          <div key={group.id} className={styles.group}>
            <div className={styles.groupLabel} data-group={group.id}>
              {t(GROUP_LABEL[group.id])}
            </div>
            {group.destinations.map((d) => {
              const plan = planFor(d);
              const line =
                d === "github" && plan.underGithubFreeLimit
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
                  {isReady(d) ? (
                    <span className={styles.ready}>
                      <Check size={11} strokeWidth={2.4} aria-hidden />
                      {t("readyBadge")}
                    </span>
                  ) : (
                    <span className={styles.size} data-direction={plan.direction}>
                      {plan.sizeKind === "up-to" && (
                        <span className={styles.sizeQualifier}>{t("listUpTo")}</span>
                      )}
                      {estimateText(plan)}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className={styles.footer}>
        {/* A placeholder for now: dropping a file here is NIW2-587. */}
        <button type="button" className={styles.another} onClick={onPrepareAnother}>
          <Import size={15} strokeWidth={1.8} className={styles.anotherIcon} aria-hidden />
          <span className={styles.anotherText}>
            <span className={styles.anotherTitle}>{t("anotherTitle")}</span>
            <span className={styles.anotherHint}>{t("anotherHint")}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
