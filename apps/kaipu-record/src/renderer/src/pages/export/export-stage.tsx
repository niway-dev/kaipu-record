import { ArrowRight, Upload } from "lucide-react";
import { KaipuLogo } from "@kaipu/brand";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import {
  type ExportFraming,
  GITHUB_FREE_LIMIT_BYTES,
  YOUTUBE_PRESET_IDS,
  type YoutubePresetId,
} from "@renderer/features/video-editor/export/export-presets";
import { formatMB, percentLighter } from "@renderer/features/video-editor/export/export-size";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import {
  type CopyPlan,
  type DestinationId,
  hasFramingChoice,
} from "@renderer/features/prepare/destinations";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import { EXPORT_NAME, GROUP_SENTENCE } from "./export-copy";
import styles from "./export-stage.module.css";

/** The stage's heading, which also names it for assistive tech. */
export const DESTINATION_TITLE_ID = "export-destination-title";

/** Nothing picked yet: the fox and the question the row below answers. */
export function NothingPicked(): React.JSX.Element {
  const t = useTranslations("export");
  return (
    <div className={styles.nothing}>
      <KaipuLogo use="product" size={64} />
      <h2 className={styles.nothingTitle}>{t("nothingPickedTitle")}</h2>
      <p className={styles.nothingBody}>{t("nothingPickedBody")}</p>
    </div>
  );
}

interface DestinationStageProps {
  plan: CopyPlan;
  planFor(destination: DestinationId, preset?: YoutubePresetId): CopyPlan;
  probe: SourceProbe;
  sourceSizeBytes: number;
  hasUnexportedEdits: boolean;
  youtube: YoutubePresetId;
  onYoutube(preset: YoutubePresetId): void;
  onFraming(framing: ExportFraming): void;
  sizeText(plan: CopyPlan): string;
  /** A file that already is this copy: the primary action opens it. */
  hasExisting: boolean;
  /** Export the copy, or open the existing one. Enter runs the same action. */
  onPrimary(): void;
  onExportAgain(): void;
}

/**
 * The selected destination: its logo, "For …" and one sentence, then what changes for it —
 * the upload size and an illustration for the platforms that compress again, the size against
 * the limit for the light ones — and the button that starts it.
 */
export function DestinationStage({
  plan,
  planFor,
  probe,
  sourceSizeBytes,
  hasUnexportedEdits,
  youtube,
  onYoutube,
  onFraming,
  sizeText,
  hasExisting,
  onPrimary,
  onExportAgain,
}: DestinationStageProps): React.JSX.Element {
  const t = useTranslations("export");
  const d = plan.destination;
  const name = t(EXPORT_NAME[d]);
  const size = sizeText(plan);
  const framing =
    plan.target.framing === "fit" || plan.target.framing === "fill" ? plan.target.framing : null;

  return (
    <div className={styles.stage}>
      <header className={styles.head}>
        <DestinationLogo destination={d} size={44} />
        <div className={styles.headText}>
          <h2 id={DESTINATION_TITLE_ID} className={styles.title}>
            {t("detailTitle", { destination: name })}
          </h2>
          <p className={styles.sentence}>{t(GROUP_SENTENCE[plan.group])}</p>
          {hasUnexportedEdits && <p className={styles.warn}>{t("originalEditsNote")}</p>}
        </div>
      </header>

      {plan.group === "send-more" && (
        <UploadSizeCard
          plan={plan}
          probe={probe}
          youtube={youtube}
          onYoutube={onYoutube}
          framing={hasFramingChoice(d) ? framing : null}
          onFraming={onFraming}
          planFor={planFor}
          sizeText={sizeText}
        />
      )}
      {plan.group === "keep-light" && (
        <SizeBarCard plan={plan} sourceSizeBytes={sourceSizeBytes} size={size} />
      )}
      {plan.group === "keep" && (
        <div className={styles.card}>
          <p className={styles.keepLine}>
            {t("keepPicture", {
              width: plan.picture.width,
              height: plan.picture.height,
              size,
            })}
          </p>
        </div>
      )}

      <footer className={styles.action}>
        {hasExisting ? (
          <>
            <Button variant="primary" onClick={onPrimary} aria-keyshortcuts="Enter">
              {t("openExisting")}
              <Kbd />
            </Button>
            <Button variant="ghost" onClick={onExportAgain}>
              {t("exportAgain")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onPrimary} aria-keyshortcuts="Enter">
            <Upload size={15} strokeWidth={1.9} aria-hidden />
            {plan.sizeKind === "full"
              ? t("exportActionFull", { destination: name })
              : t("exportAction", { destination: name, size })}
            <Kbd />
          </Button>
        )}
        <span className={styles.actionNote}>{t("exportNote")}</span>
      </footer>
    </div>
  );
}

/** The Enter hint on the primary button; decorative — `aria-keyshortcuts` says it. */
function Kbd(): React.JSX.Element {
  return (
    <kbd className={styles.kbd} aria-hidden>
      ↵
    </kbd>
  );
}

/**
 * Upload destinations: the size of the upload (1440p or 4K for YouTube, the one canvas for
 * Reels and feeds, with their Fill / Fit), and what the platform's own compression does to
 * small text at 1080p and at this copy's size.
 */
function UploadSizeCard({
  plan,
  probe,
  youtube,
  onYoutube,
  framing,
  onFraming,
  planFor,
  sizeText,
}: {
  plan: CopyPlan;
  probe: SourceProbe;
  youtube: YoutubePresetId;
  onYoutube(preset: YoutubePresetId): void;
  /** Fill / Fit, for the destinations that change the shape; null elsewhere. */
  framing: "fit" | "fill" | null;
  onFraming(framing: ExportFraming): void;
  planFor(destination: DestinationId, preset?: YoutubePresetId): CopyPlan;
  sizeText(plan: CopyPlan): string;
}): React.JSX.Element {
  const t = useTranslations("export");
  const tEditor = useTranslations("videoEditor");
  const youtubeResolution = (p: YoutubePresetId): string =>
    tEditor(p === "youtube-4k" ? "youtubeResolution4k" : "youtubeResolution1440");
  const resolution =
    plan.destination === "youtube"
      ? youtubeResolution(youtube)
      : `${plan.picture.width} × ${plan.picture.height}`;
  const hint = { up: "uploadHintUp", same: "uploadHintSame", down: "uploadHintDown" } as const;
  return (
    <section className={styles.card} aria-labelledby="export-upload-size">
      <div className={styles.optionHead}>
        <div className={styles.optionText}>
          <h3 id="export-upload-size" className={styles.optionTitle}>
            {t("uploadSizeTitle")}
          </h3>
          <p className={styles.optionHint}>
            {t(hint[plan.picture.scale], { width: probe.width, height: probe.height })}
          </p>
        </div>
        {plan.destination === "youtube" ? (
          <div className={styles.segmented} role="radiogroup" aria-labelledby="export-upload-size">
            {YOUTUBE_PRESET_IDS.map((p) => (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={youtube === p}
                className={styles.segment}
                data-active={youtube === p}
                onClick={() => onYoutube(p)}
              >
                {t("uploadOption", {
                  resolution: youtubeResolution(p),
                  size: sizeText(planFor("youtube", p)),
                })}
              </button>
            ))}
          </div>
        ) : (
          <span className={styles.segmented}>
            <span className={styles.segment} data-active="true">
              {t("uploadOption", { resolution, size: sizeText(plan) })}
            </span>
          </span>
        )}
      </div>

      {framing && (
        <div className={styles.optionHead}>
          <h3 id="export-framing" className={styles.optionTitle}>
            {t("framingTitle")}
          </h3>
          <div className={styles.segmented} role="radiogroup" aria-labelledby="export-framing">
            {(["fill", "fit"] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="radio"
                aria-checked={framing === f}
                title={f === "fit" ? tEditor("framingFitHint") : tEditor("framingFillHint")}
                className={styles.segment}
                data-active={framing === f}
                onClick={() => onFraming(f)}
              >
                {f === "fit" ? tEditor("framingFit") : tEditor("framingFill")}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.crops}>
        <TextCrop soft label={t("cropBefore")} />
        <ArrowRight size={16} strokeWidth={1.8} className={styles.cropArrow} aria-hidden />
        <TextCrop label={t("cropAfter", { resolution })} />
        <p className={styles.cropNote}>{t("cropNote")}</p>
      </div>
    </section>
  );
}

/** The text an illustration shows: a terminal command, the kind of text screen recordings carry. */
const CROP_SAMPLE = "npm run build";

/**
 * A drawn crop of small text, sharp or softened the way a re-compressed small upload looks.
 * An illustration, and labelled as one: it is not a frame of the recording.
 */
function TextCrop({ soft = false, label }: { soft?: boolean; label: string }): React.JSX.Element {
  return (
    <figure className={styles.crop} data-soft={soft}>
      <span className={styles.cropFrame} aria-hidden>
        <span className={styles.cropText}>{CROP_SAMPLE}</span>
      </span>
      <figcaption className={styles.cropLabel}>{label}</figcaption>
    </figure>
  );
}

/**
 * Light destinations play the file as it is. GitHub's bar is drawn against its 10 MB free
 * limit (`githubPlans().free`, through `plan.underGithubFreeLimit`); the others against the
 * recording, so the bar shows how much lighter the copy is.
 */
function SizeBarCard({
  plan,
  sourceSizeBytes,
  size,
}: {
  plan: CopyPlan;
  sourceSizeBytes: number;
  size: string;
}): React.JSX.Element {
  const t = useTranslations("export");
  const copyBytes = plan.estimateBytes ?? sourceSizeBytes;
  const limited = plan.underGithubFreeLimit !== null;
  const scale = Math.max(copyBytes, limited ? GITHUB_FREE_LIMIT_BYTES : sourceSizeBytes, 1);
  const lighter = percentLighter(plan.estimateBytes, sourceSizeBytes);
  const tag =
    plan.underGithubFreeLimit === true
      ? t("barFitsLimit")
      : plan.underGithubFreeLimit === false
        ? t("barOverLimit")
        : lighter !== null
          ? t("barLighter", { percent: lighter })
          : t("barNotLighter");
  const tone = limited ? (plan.underGithubFreeLimit ? "fits" : "over") : plan.direction;
  return (
    // Plain text, no role="img": an image role would make the verdict ("over GitHub's 10 MB
    // free-plan limit", "N% lighter") presentational, and screen readers would miss it.
    <section className={styles.card}>
      <div className={styles.barLabels}>
        <span className={styles.barOriginal}>
          {t("barOriginal", { size: formatMB(sourceSizeBytes) })}
        </span>
        <span className={styles.barCopy}>
          <strong>{size}</strong>
          <span className={styles.barTag} data-tone={tone}>
            {" · "}
            {tag}
          </span>
        </span>
      </div>
      <div className={styles.bar} aria-hidden>
        <span
          className={styles.barFill}
          data-tone={tone}
          style={{ width: `${Math.max(3, Math.min(100, (copyBytes / scale) * 100))}%` }}
        />
      </div>
      <p className={styles.barPicture}>
        {t("barPicture", { width: plan.picture.width, height: plan.picture.height })}
      </p>
    </section>
  );
}
