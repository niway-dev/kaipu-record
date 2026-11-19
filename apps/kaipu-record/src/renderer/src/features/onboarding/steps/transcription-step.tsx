import { useRef } from "react";
import { Captions } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { formatSize } from "@renderer/features/library/format";
import { uiArea } from "@renderer/lib/ui-area";
import type { TranscriptionModelInfo } from "@shared/types/transcription";
import common from "./step.module.css";
import styles from "./transcription-step.module.css";

interface TranscriptionStepProps {
  /** The model on offer. */
  model: TranscriptionModelInfo;
  /** Starts the download. Never awaited: it ends minutes later, long after the onboarding. */
  onDownload: () => Promise<void>;
  /** Moves on to You're set. Both choices call it at once. */
  onAdvance: () => void;
}

/**
 * Transcription: the offer to install the speech model, with its size and where it goes. The
 * onboarding never waits for the download: "Download in background" only starts it and moves
 * on, "Not now" just moves on. A failure of the download is shown by Settings → Transcription.
 */
export function TranscriptionStep({
  model,
  onDownload,
  onAdvance,
}: TranscriptionStepProps): React.JSX.Element {
  const t = useTranslations("onboarding");
  const tt = useTranslations("transcription");
  // One choice per visit, so a double click cannot start the download twice.
  const chosen = useRef(false);

  const choose = (download: boolean): void => {
    if (chosen.current) return;
    chosen.current = true;
    if (download) onDownload().catch(() => {});
    onAdvance();
  };

  return (
    <div {...uiArea("onboarding.transcriptionStep")} className={`${common.step} ${styles.step}`}>
      <span className={styles.icon}>
        <Captions size={30} strokeWidth={1.6} />
      </span>
      <h1 className={common.title}>{t("transcriptionTitle")}</h1>
      <p className={common.subtitle}>{t("transcriptionSubtitle")}</p>

      <div className={`${common.card} ${styles.model}`}>
        <p className={styles.modelLabel}>{model.label}</p>
        <dl className={styles.facts}>
          <div className={styles.fact}>
            <dt>{tt("sizeLabel")}</dt>
            <dd>{formatSize(model.sizeBytes)}</dd>
          </div>
          <div className={styles.fact}>
            <dt>{tt("locationInstallsTo")}</dt>
            <dd className={styles.path} title={model.location}>
              {model.location}
            </dd>
          </div>
        </dl>
        <p className={styles.license}>
          {model.license.attribution}{" "}
          <a href={model.license.url} target="_blank" rel="noopener noreferrer">
            {tt("licenseLink", { license: model.license.name })}
          </a>
        </p>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.download} onClick={() => choose(true)}>
          {t("transcriptionDownload")}
        </button>
        <button type="button" className={styles.later} onClick={() => choose(false)}>
          {t("transcriptionLater")}
        </button>
      </div>
      <p className={common.note}>{t("transcriptionNote")}</p>
    </div>
  );
}
