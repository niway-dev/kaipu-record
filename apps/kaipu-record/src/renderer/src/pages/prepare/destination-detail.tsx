import { ArrowRight, Send } from "lucide-react";
import { useTranslations, type Translator } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { formatDuration } from "@renderer/features/library/format";
import { FramingPreview } from "@renderer/features/video-editor/components/framing-preview";
import {
  defaultYoutubePreset,
  type ExportFraming,
  PRESETS,
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
import { DESTINATION_COPY } from "@renderer/features/prepare/destination-copy";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import styles from "./destination-detail.module.css";

/** The detail's heading, which also names the column for assistive tech. */
export const DESTINATION_TITLE_ID = "prepare-destination-title";

interface DestinationDetailProps {
  plan: CopyPlan;
  planFor(destination: DestinationId, preset?: YoutubePresetId): CopyPlan;
  probe: SourceProbe;
  sourceSizeBytes: number;
  thumbnailUrl: string | null;
  hasUnexportedEdits: boolean;
  youtube: YoutubePresetId;
  onYoutube(preset: YoutubePresetId): void;
  onFraming(framing: ExportFraming): void;
  sizeText(plan: CopyPlan): string;
  /** A file that already is this copy: the primary action opens it. */
  hasExisting: boolean;
  /** Prepare the copy, or open the existing one. Enter runs the same action. */
  onPrimary(): void;
  onPrepareAgain(): void;
}

/**
 * The right column: what the copy will be for the selected destination — what changes, why,
 * the one choice that destination has, and the button that starts it.
 */
export function DestinationDetail({
  plan,
  planFor,
  probe,
  sourceSizeBytes,
  thumbnailUrl,
  hasUnexportedEdits,
  youtube,
  onYoutube,
  onFraming,
  sizeText,
  hasExisting,
  onPrimary,
  onPrepareAgain,
}: DestinationDetailProps): React.JSX.Element {
  const t = useTranslations("prepare");
  const d = plan.destination;
  const name = t(DESTINATION_COPY[d].name);
  const size = sizeText(plan);
  const framing =
    plan.target.framing === "fit" || plan.target.framing === "fill" ? plan.target.framing : null;

  return (
    <div className={styles.detail}>
      <header className={styles.head}>
        <DestinationLogo destination={d} size={44} />
        <div className={styles.headText}>
          <h1 id={DESTINATION_TITLE_ID} className={styles.title}>
            {t("detailTitle", { destination: name })}
          </h1>
          <p className={styles.meta}>
            {t("detailMeta", {
              duration: formatDuration(probe.durationSec),
              width: probe.width,
              height: probe.height,
              size: formatMB(sourceSizeBytes),
            })}
          </p>
          {hasUnexportedEdits && <p className={styles.warn}>{t("originalEditsNote")}</p>}
        </div>
      </header>

      <div className={styles.grid}>
        <ChangesCard
          plan={plan}
          probe={probe}
          sourceSizeBytes={sourceSizeBytes}
          size={size}
          t={t}
        />
        <section className={styles.why} data-group={plan.group} aria-labelledby="prepare-why">
          <h2 id="prepare-why" className={styles.kicker}>
            {t(whyTitle(plan))}
          </h2>
          <p className={styles.whyText}>{t(DESTINATION_COPY[d].why)}</p>
        </section>
      </div>

      {d === "youtube" && (
        <UploadSizeCard
          probe={probe}
          youtube={youtube}
          onYoutube={onYoutube}
          planFor={planFor}
          sizeText={sizeText}
        />
      )}
      {plan.group === "keep-light" && (
        <SizeBarCard plan={plan} sourceSizeBytes={sourceSizeBytes} size={size} />
      )}
      {hasFramingChoice(d) && framing && (
        <ShapeCard
          plan={plan}
          probe={probe}
          framing={framing}
          thumbnailUrl={thumbnailUrl}
          onFraming={onFraming}
        />
      )}

      <footer className={styles.action}>
        {hasExisting ? (
          <>
            <Button variant="primary" onClick={onPrimary} aria-keyshortcuts="Enter">
              {t("openExisting")}
              <Kbd />
            </Button>
            <Button variant="ghost" onClick={onPrepareAgain}>
              {t("prepareAgain")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={onPrimary} aria-keyshortcuts="Enter">
            <Send size={14} strokeWidth={1.9} aria-hidden />
            {plan.sizeKind === "full"
              ? t("prepareActionFull", { destination: name })
              : t("prepareAction", { destination: name, size })}
            <Kbd />
          </Button>
        )}
        <span className={styles.actionNote}>{t("prepareNote")}</span>
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

/** The "why" card's title says the direction the copy actually goes, never a promise. */
function whyTitle(
  plan: CopyPlan,
): "whyCardKeep" | "whyCardBigger" | "whyCardLighter" | "whyCardOther" {
  if (plan.group === "keep") return "whyCardKeep";
  if (plan.direction === "bigger") return "whyCardBigger";
  if (plan.direction === "lighter") return "whyCardLighter";
  return "whyCardOther";
}

/** "What changes": size, picture, smoothness when it is capped, sound and length. */
function ChangesCard({
  plan,
  probe,
  sourceSizeBytes,
  size,
  t,
}: {
  plan: CopyPlan;
  probe: SourceProbe;
  sourceSizeBytes: number;
  size: string;
  t: Translator<"prepare">;
}): React.JSX.Element {
  const { picture, smoothness, sound } = plan;
  const from = t("pictureSize", { width: probe.width, height: probe.height });
  const to = t("pictureSize", { width: picture.width, height: picture.height });
  const soundText = {
    none: t("soundNone"),
    same: t("soundSame"),
    studio: t("soundStudio"),
    standard: t("soundStandard"),
  }[sound];
  const rows: Array<{ label: string; value: string; direction?: CopyPlan["direction"] }> = [
    {
      label: t("changeSize"),
      value:
        plan.sizeKind === "full"
          ? size
          : t("fromTo", { from: formatMB(sourceSizeBytes), to: size }),
      direction: plan.direction,
    },
    { label: t("changePicture"), value: from === to ? from : t("fromTo", { from, to }) },
    ...(smoothness.change === "capped"
      ? [{ label: t("changeSmoothness"), value: t("smoothCapped", { fps: smoothness.fps }) }]
      : []),
    { label: t("changeSound"), value: soundText },
    {
      label: t("changeLength"),
      value: t("lengthValue", { duration: formatDuration(probe.durationSec) }),
    },
  ];
  return (
    <section className={styles.card} aria-labelledby="prepare-changes">
      <h2 id="prepare-changes" className={styles.kicker}>
        {t("changesCard")}
      </h2>
      <dl className={styles.changes}>
        {rows.map((row) => (
          <div key={row.label} className={styles.change}>
            <dt className={styles.changeLabel}>{row.label}</dt>
            <dd className={styles.changeValue} data-direction={row.direction}>
              {row.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** YouTube's one choice, 1440p or 4K, and what YouTube's own compression does to small text. */
function UploadSizeCard({
  probe,
  youtube,
  onYoutube,
  planFor,
  sizeText,
}: {
  probe: SourceProbe;
  youtube: YoutubePresetId;
  onYoutube(preset: YoutubePresetId): void;
  planFor(destination: DestinationId, preset?: YoutubePresetId): CopyPlan;
  sizeText(plan: CopyPlan): string;
}): React.JSX.Element {
  const t = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");
  const resolution = (p: YoutubePresetId): string =>
    tEditor(p === "youtube-4k" ? "youtubeResolution4k" : "youtubeResolution1440");
  return (
    <section className={styles.card} aria-labelledby="prepare-upload-size">
      <div className={styles.optionHead}>
        <h2 id="prepare-upload-size" className={styles.optionTitle}>
          {t("uploadSizeTitle")}
        </h2>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="prepare-upload-size">
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
              {t("youtubeOption", {
                resolution: resolution(p),
                size: sizeText(planFor("youtube", p)),
              })}
            </button>
          ))}
        </div>
      </div>
      <p className={styles.optionHint}>
        {defaultYoutubePreset(probe) === "youtube-4k" ? t("youtubeHint4k") : t("youtubeHint1440")}
      </p>
      <div className={styles.crops}>
        <TextCrop soft label={t("cropBefore")} />
        <ArrowRight size={16} strokeWidth={1.8} className={styles.cropArrow} aria-hidden />
        <TextCrop label={t("cropAfter", { resolution: resolution(youtube) })} />
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
 * Where the file is played as-is: the recording and the copy on one scale, and — for GitHub —
 * whether it fits the 10 MB free-plan limit, said only when it is true either way.
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
  const t = useTranslations("prepare");
  const copyBytes = plan.estimateBytes ?? sourceSizeBytes;
  const scale = Math.max(copyBytes, sourceSizeBytes, 1);
  const lighter = percentLighter(plan.estimateBytes, sourceSizeBytes);
  const parts = [
    lighter !== null ? t("tagLighter", { percent: lighter }) : t("tagNotLighter"),
    plan.underGithubFreeLimit === true
      ? t("barUnderLimit")
      : plan.underGithubFreeLimit === false
        ? t("barOverLimit")
        : null,
  ].filter((part): part is string => part !== null);
  return (
    <section
      className={styles.card}
      role="img"
      aria-label={t("meterLabel", { from: formatMB(sourceSizeBytes), to: size })}
    >
      <div className={styles.barLabels}>
        <span className={styles.barOriginal}>
          {t("meterOriginal", { size: formatMB(sourceSizeBytes) })}
        </span>
        <span className={styles.barCopy}>
          <strong>{size}</strong>
          <span className={styles.barTag} data-direction={plan.direction}>
            {" · "}
            {parts.join(" · ")}
          </span>
        </span>
      </div>
      <div className={styles.bar} aria-hidden>
        <span
          className={styles.barFill}
          data-direction={plan.direction}
          style={{ width: `${Math.max(3, (copyBytes / scale) * 100)}%` }}
        />
      </div>
    </section>
  );
}

/** Reels and feeds: Fill or Fit into the new shape, with a still preview of each. */
function ShapeCard({
  plan,
  probe,
  framing,
  thumbnailUrl,
  onFraming,
}: {
  plan: CopyPlan;
  probe: SourceProbe;
  framing: "fit" | "fill";
  thumbnailUrl: string | null;
  onFraming(framing: ExportFraming): void;
}): React.JSX.Element {
  const t = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");
  return (
    <section className={`${styles.card} ${styles.shape}`} aria-labelledby="prepare-framing">
      <FramingPreview
        canvas={PRESETS[plan.target.presetId].canvas!}
        source={{ width: probe.width, height: probe.height }}
        framing={framing}
        thumbnailUrl={thumbnailUrl}
      />
      <div className={styles.optionText}>
        <h2 id="prepare-framing" className={styles.optionTitle}>
          {t("framingTitle")}
        </h2>
        <div className={styles.segmented} role="radiogroup" aria-labelledby="prepare-framing">
          {(["fill", "fit"] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="radio"
              aria-checked={framing === f}
              className={styles.segment}
              data-active={framing === f}
              onClick={() => onFraming(f)}
            >
              {f === "fit" ? tEditor("framingFit") : tEditor("framingFill")}
            </button>
          ))}
        </div>
        <p className={styles.optionHint}>
          {framing === "fit" ? tEditor("framingFitHint") : tEditor("framingFillHint")}
        </p>
      </div>
    </section>
  );
}
