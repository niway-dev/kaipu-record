import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Check, ChevronDown, FileX2, Film } from "lucide-react";
import { useTranslations, type Translator } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { showToast } from "@renderer/ui/toast-store";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import { formatDuration, relativeDate } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { FramingPreview } from "@renderer/features/video-editor/components/framing-preview";
import { GithubFitChips } from "@renderer/features/video-editor/components/github-fit-chips";
import {
  defaultYoutubePreset,
  type ExportFraming,
  PRESETS,
  YOUTUBE_PRESET_IDS,
  type YoutubePresetId,
} from "@renderer/features/video-editor/export/export-presets";
import { formatMB, percentLighter } from "@renderer/features/video-editor/export/export-size";
import {
  findReusableExports,
  WHOLE_RECORDING_FINGERPRINT,
} from "@renderer/features/video-editor/export/export-reuse";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import {
  type CopyPlan,
  DESTINATION_GROUPS,
  type DestinationId,
  destinationOfPreset,
  hasFramingChoice,
  isDestinationId,
  planCopy,
  presetForDestination,
  presetsOf,
} from "@renderer/features/prepare/destinations";
import { DESTINATION_COPY, GROUP_COPY } from "@renderer/features/prepare/destination-copy";
import { DestinationLogo } from "@renderer/features/prepare/components/destination-logo";
import { PREPARE_DESTINATION_PARAM } from "@renderer/features/prepare/prepare-path";
import {
  asPreparable,
  type PreparableVideo,
  usePrepareCopy,
  useSourceProbe,
} from "@renderer/features/prepare/use-prepare-copy";
import styles from "./prepare-page.module.css";

/**
 * Prepare (NIW2-578): "where is it going?" as a screen. The recording is the original and
 * is never changed; Prepare makes a new copy of it for one destination, in the background,
 * through the same export pipeline as the editor. Reached from the recording page (its
 * "Prepare for…" button, the quick chips, the heavy-to-send banner, the post-recording panel)
 * and from the Library cards.
 */
export function PreparePage(): React.JSX.Element {
  const t = useTranslations("prepare");
  const tLib = useTranslations("library");
  const { assetId } = useParams<{ assetId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { videos, isLoading } = useLocalLibrary();
  const lineage = useMemo(() => buildLineage(videos), [videos]);

  const video = videos.find((v) => v.assetId === assetId);
  const preparable = asPreparable(video);
  const probe = useSourceProbe(preparable?.id ?? null);
  const recordingPath = `/library/${assetId ?? ""}`;

  // An unreadable file has nothing to prepare: say so and go back to the recording.
  useEffect(() => {
    if (probe.status !== "error") return;
    showToast({ message: tLib("shareReadError") });
    navigate(recordingPath, { replace: true });
  }, [probe.status, navigate, recordingPath, tLib]);

  if (isLoading) return <div className={styles.centered}>{tLib("loading")}</div>;

  if (!video || !assetId) {
    return (
      <div className={styles.centered}>
        <FileX2 size={40} strokeWidth={1.5} className={styles.mutedIcon} />
        <h2 className={styles.centeredTitle}>{tLib("fileNotFound")}</h2>
        <Button variant="ghost" onClick={() => navigate("/library")}>
          {tLib("backToLibrary")}
        </Button>
      </div>
    );
  }

  if (!preparable) {
    return (
      <div className={styles.centered}>
        <Film size={40} strokeWidth={1.5} className={styles.mutedIcon} />
        <h2 className={styles.centeredTitle}>{t("notPreparableTitle")}</h2>
        <p className={styles.centeredBody}>{t("notPreparableBody")}</p>
        <Button variant="ghost" onClick={() => navigate(recordingPath)}>
          {t("back")}
        </Button>
      </div>
    );
  }

  if (probe.status !== "ready") {
    return <div className={styles.centered}>{t("reading")}</div>;
  }

  const to = searchParams.get(PREPARE_DESTINATION_PARAM);
  const badge = editBadge(video, lineage);
  return (
    <PrepareScreen
      // A new probe (another recording) starts the screen over.
      key={preparable.id}
      video={preparable}
      probe={probe.probe}
      exports={lineage.exportsOf.get(video.assetId) ?? []}
      hasUnexportedEdits={badge === "never-exported" || badge === "stale"}
      initialDestination={isDestinationId(to) ? to : null}
      onBack={() => navigate(recordingPath)}
      onStarted={() => navigate(recordingPath)}
      onOpenExisting={(existing) => navigate(`/library/${existing.assetId}`)}
    />
  );
}

interface PrepareScreenProps {
  video: PreparableVideo;
  probe: SourceProbe;
  /** The recording's exports (`buildLineage().exportsOf`), for "Already prepared". */
  exports: readonly LibraryVideo[];
  /** The edit session holds edits no file carries: a copy from here would not have them. */
  hasUnexportedEdits: boolean;
  initialDestination: DestinationId | null;
  onBack(): void;
  /** The copy is being made in the background. */
  onStarted(): void;
  onOpenExisting(existing: LibraryVideo): void;
}

/** Three columns, read left to right: the original, where it is going, what the copy will be. */
function PrepareScreen({
  video,
  probe,
  exports,
  hasUnexportedEdits,
  initialDestination,
  onBack,
  onStarted,
  onOpenExisting,
}: PrepareScreenProps): React.JSX.Element {
  const t = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");
  const prepare = usePrepareCopy();

  const [selected, setSelected] = useState<DestinationId | null>(initialDestination);
  const [youtube, setYoutube] = useState<YoutubePresetId>(defaultYoutubePreset(probe));
  const [framings, setFramings] = useState<Record<"vertical" | "square", ExportFraming>>({
    vertical: PRESETS.vertical.defaultFraming!,
    square: PRESETS.square.defaultFraming!,
  });

  const framingOf = (d: DestinationId): ExportFraming | null =>
    d === "vertical" || d === "square" ? framings[d] : null;
  const planFor = (d: DestinationId, presetOverride?: YoutubePresetId): CopyPlan =>
    planCopy({
      destination: d,
      presetId: presetForDestination(d, probe, presetOverride ?? youtube),
      framing: framingOf(d),
      source: probe,
      durationSec: probe.durationSec,
      sourceSizeBytes: video.fileSizeBytes,
    });

  // "Already prepared": a file that already is this copy (same preset, whole recording).
  const reusable = useMemo(
    () => findReusableExports(exports, WHOLE_RECORDING_FINGERPRINT),
    [exports],
  );
  const prepared = exports.filter(
    (e): e is LibraryVideo & { export: NonNullable<LibraryVideo["export"]> } =>
      e.kind === "recording" && e.id !== null && e.export != null,
  );

  const sizeText = (plan: CopyPlan): string => {
    if (plan.sizeKind === "full" || plan.estimateBytes === null) return tEditor("sizeFull");
    const size = formatMB(plan.estimateBytes);
    return plan.sizeKind === "up-to"
      ? tEditor("sizeUpTo", { size })
      : tEditor("sizeAbout", { size });
  };

  const start = (plan: CopyPlan): void => {
    const started = prepare.start({
      video,
      probe,
      choice: { presetId: plan.target.presetId, framing: framingOf(plan.destination) },
    });
    if (started) onStarted();
  };

  return (
    <div className={styles.screen}>
      {/* ── The original ── */}
      <aside className={styles.original} aria-label={t("originalLabel")}>
        <button type="button" className={styles.back} onClick={onBack}>
          <ArrowLeft size={14} strokeWidth={1.8} />
          {t("back")}
        </button>
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className={styles.thumb} />
        ) : (
          <span className={styles.thumb} aria-hidden />
        )}
        <div className={styles.originalTitle}>
          <span className={styles.originalTag}>{t("originalLabel")}</span>
          <span className={styles.originalName}>{video.title}</span>
        </div>
        <p className={styles.mono}>
          {formatDuration(probe.durationSec)} ·{" "}
          {t("pictureSize", { width: probe.width, height: probe.height })}
          <br />
          {formatMB(video.fileSizeBytes)}
        </p>
        <p className={styles.note}>{t("originalNote")}</p>
        {hasUnexportedEdits && <p className={styles.warnNote}>{t("originalEditsNote")}</p>}
        {prepared.length > 0 && (
          <section className={styles.prepared} aria-labelledby="prepare-already">
            <h2 id="prepare-already" className={styles.kicker}>
              {t("alreadyPrepared")}
            </h2>
            <ul className={styles.preparedList}>
              {prepared.map((e) => {
                const d = destinationOfPreset(e.export.preset);
                return (
                  <li key={e.assetId}>
                    <Link to={`/library/${e.assetId}`} className={styles.preparedItem}>
                      <DestinationLogo destination={d} size={24} />
                      <span className={styles.preparedText}>
                        <span className={styles.preparedName}>{t(DESTINATION_COPY[d].name)}</span>
                        <span className={styles.preparedMeta}>
                          {t("alreadyPreparedMeta", {
                            size: formatMB(e.fileSizeBytes),
                            date: relativeDate(e.createdAt),
                          })}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>

      {/* ── Where it is going ── */}
      <section className={styles.destinations} aria-labelledby="prepare-title">
        <h1 id="prepare-title" className={styles.title}>
          {t("pageTitle")}
        </h1>
        <div role="radiogroup" aria-labelledby="prepare-title" className={styles.groups}>
          {DESTINATION_GROUPS.map((group) => (
            <div key={group.id} className={styles.group}>
              <div className={styles.groupLabel} data-group={group.id}>
                {t(GROUP_COPY[group.id].label)}
              </div>
              <p className={styles.groupReason}>{t(GROUP_COPY[group.id].reason)}</p>
              {group.destinations.map((d) => {
                const plan = planFor(d);
                const ready = presetsOf(d).some((p) => reusable[p] !== undefined);
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
                    className={styles.destination}
                    data-active={selected === d}
                    onClick={() => setSelected(d)}
                  >
                    <DestinationLogo destination={d} />
                    <span className={styles.destinationText}>
                      <span className={styles.destinationName}>{t(DESTINATION_COPY[d].name)}</span>
                      <span className={styles.destinationLine}>{line}</span>
                    </span>
                    {ready ? (
                      <span className={styles.readyBadge}>
                        <Check size={12} strokeWidth={2.4} aria-hidden />
                        {t("readyBadge")}
                      </span>
                    ) : (
                      <span className={styles.destinationSize} data-direction={plan.direction}>
                        {sizeText(plan)}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </section>

      {/* ── What this copy will be ── */}
      <section className={styles.detail} aria-live="polite">
        {selected === null ? (
          <div className={styles.pick}>
            <h2 className={styles.pickTitle}>{t("pickTitle")}</h2>
            <p className={styles.note}>{t("pickBody")}</p>
          </div>
        ) : (
          <DestinationDetail
            key={selected}
            plan={planFor(selected)}
            planFor={planFor}
            sourceSizeBytes={video.fileSizeBytes}
            probe={probe}
            thumbnailUrl={video.thumbnailUrl ?? null}
            youtube={youtube}
            onYoutube={setYoutube}
            onFraming={(f) =>
              (selected === "vertical" || selected === "square") &&
              setFramings((prev) => ({ ...prev, [selected]: f }))
            }
            sizeText={sizeText}
            existing={reusable[presetForDestination(selected, probe, youtube)]}
            onPrepare={start}
            onOpenExisting={onOpenExisting}
          />
        )}
      </section>
    </div>
  );
}

interface DestinationDetailProps {
  plan: CopyPlan;
  planFor(d: DestinationId, preset?: YoutubePresetId): CopyPlan;
  sourceSizeBytes: number;
  probe: SourceProbe;
  thumbnailUrl: string | null;
  youtube: YoutubePresetId;
  onYoutube(preset: YoutubePresetId): void;
  onFraming(framing: ExportFraming): void;
  sizeText(plan: CopyPlan): string;
  /** A file that already is this copy; the primary action opens it instead. */
  existing: LibraryVideo | undefined;
  onPrepare(plan: CopyPlan): void;
  onOpenExisting(existing: LibraryVideo): void;
}

function DestinationDetail({
  plan,
  planFor,
  sourceSizeBytes,
  probe,
  thumbnailUrl,
  youtube,
  onYoutube,
  onFraming,
  sizeText,
  existing,
  onPrepare,
  onOpenExisting,
}: DestinationDetailProps): React.JSX.Element {
  const t = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");
  const [changesOpen, setChangesOpen] = useState(false);
  const d = plan.destination;
  const copy = DESTINATION_COPY[d];
  const name = t(copy.name);
  const size = sizeText(plan);
  const framing =
    plan.target.framing === "fit" || plan.target.framing === "fill" ? plan.target.framing : null;

  return (
    <div className={styles.detailBody}>
      <header className={styles.detailHead}>
        <DestinationLogo destination={d} size={40} />
        <div>
          <h2 className={styles.detailName}>{name}</h2>
          <p className={styles.detailSay}>{t(copy.say)}</p>
        </div>
      </header>

      <SizeChange plan={plan} sourceSizeBytes={sourceSizeBytes} sizeText={size} />
      <p className={styles.why}>
        <strong>{t(GROUP_COPY[plan.group].whyTitle)}</strong> {t(copy.why)}
      </p>
      {d === "github" && plan.estimateBytes !== null && (
        <GithubFitChips bytes={plan.estimateBytes} />
      )}

      {d === "youtube" && (
        <div className={styles.option}>
          <div className={styles.optionText}>
            <span className={styles.optionTitle} id="prepare-youtube-size">
              {t("youtubeSizeTitle")}
            </span>
            <span className={styles.optionHint}>
              {defaultYoutubePreset(probe) === "youtube-4k"
                ? t("youtubeHint4k")
                : t("youtubeHint1440")}
            </span>
          </div>
          <div
            className={styles.segmented}
            role="radiogroup"
            aria-labelledby="prepare-youtube-size"
          >
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
                  resolution: tEditor(
                    p === "youtube-4k" ? "youtubeResolution4k" : "youtubeResolution1440",
                  ),
                  size: sizeText(planFor("youtube", p)),
                })}
              </button>
            ))}
          </div>
        </div>
      )}

      {hasFramingChoice(d) && framing && (
        <div className={styles.framing}>
          <FramingPreview
            canvas={PRESETS[plan.target.presetId].canvas!}
            source={{ width: probe.width, height: probe.height }}
            framing={framing}
            thumbnailUrl={thumbnailUrl}
          />
          <div className={styles.optionText}>
            <span className={styles.optionTitle} id="prepare-framing">
              {t("framingTitle")}
            </span>
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
            <span className={styles.optionHint}>
              {framing === "fit" ? tEditor("framingFitHint") : tEditor("framingFillHint")}
            </span>
          </div>
        </div>
      )}

      <div className={styles.changes}>
        <button
          type="button"
          className={styles.changesToggle}
          aria-expanded={changesOpen}
          onClick={() => setChangesOpen((open) => !open)}
        >
          <ChevronDown size={14} strokeWidth={1.8} className={styles.chevron} aria-hidden />
          {t("changesTitle")}
        </button>
        {changesOpen && <ChangeRows plan={plan} t={t} />}
      </div>

      <footer className={styles.footer}>
        <span className={styles.footerNote}>{t("footerNote")}</span>
        {existing ? (
          <>
            <Button variant="ghost" size="sm" onClick={() => onPrepare(plan)}>
              {t("prepareAgain")}
            </Button>
            <Button variant="primary" onClick={() => onOpenExisting(existing)}>
              {t("openExisting")}
            </Button>
          </>
        ) : (
          <Button variant="primary" onClick={() => onPrepare(plan)}>
            {plan.sizeKind === "full"
              ? t("prepareActionFull", { destination: name })
              : t("prepareAction", { destination: name, size })}
          </Button>
        )}
      </footer>
    </div>
  );
}

/**
 * Original → copy, both bars on one scale, so a bigger copy reads as bigger. The tag judges
 * only in the direction that matters: "bigger on purpose" where the platform compresses
 * again, "N% lighter" where the file is played as-is.
 */
function SizeChange({
  plan,
  sourceSizeBytes,
  sizeText,
}: {
  plan: CopyPlan;
  sourceSizeBytes: number;
  sizeText: string;
}): React.JSX.Element {
  const t = useTranslations("prepare");
  const copyBytes = plan.estimateBytes ?? sourceSizeBytes;
  const scale = Math.max(copyBytes, sourceSizeBytes, 1);
  const lighter = percentLighter(plan.estimateBytes, sourceSizeBytes);
  const tag =
    plan.direction === "bigger"
      ? t("tagBigger")
      : plan.direction === "lighter" && lighter !== null
        ? t("tagLighter", { percent: lighter })
        : plan.direction === "not-lighter"
          ? t("tagNotLighter")
          : plan.direction === "same"
            ? t("tagSame")
            : null;
  return (
    <div
      className={styles.meter}
      role="img"
      aria-label={t("meterLabel", { from: formatMB(sourceSizeBytes), to: sizeText })}
    >
      <div className={styles.meterLabels}>
        <span className={styles.meterOriginal}>
          {t("meterOriginal", { size: formatMB(sourceSizeBytes) })}
        </span>
        <span className={styles.meterArrow} aria-hidden>
          →
        </span>
        <span className={styles.meterCopy}>{sizeText}</span>
        {tag && (
          <span className={styles.meterTag} data-direction={plan.direction}>
            {tag}
          </span>
        )}
      </div>
      <div className={styles.meterBars} aria-hidden>
        <span
          className={styles.meterBarOriginal}
          style={{ width: `${(sourceSizeBytes / scale) * 100}%` }}
        />
        <span
          className={styles.meterBarCopy}
          data-direction={plan.direction}
          style={{ width: `${Math.max(3, (copyBytes / scale) * 100)}%` }}
        />
      </div>
    </div>
  );
}

/** "What changes in the copy": picture, smoothness and sound, in words. */
function ChangeRows({ plan, t }: { plan: CopyPlan; t: Translator<"prepare"> }): React.JSX.Element {
  const { picture, smoothness, sound } = plan;
  const pictureNotes = [
    picture.scale === "up"
      ? t("pictureScaledUp")
      : picture.scale === "down"
        ? t("pictureScaledDown")
        : picture.edges === "none"
          ? t("pictureSame")
          : null,
    picture.edges === "black-bars"
      ? t("edgesBlackBars")
      : picture.edges === "blurred-bands"
        ? t("edgesBlurredBands")
        : picture.edges === "cropped"
          ? t("edgesCropped")
          : null,
  ].filter(Boolean);
  const soundText = {
    none: [t("soundNone"), t("soundNoneNote")],
    same: [t("soundSame"), t("soundSameNote")],
    studio: [t("soundStudio"), t("soundStudioNote")],
    standard: [t("soundStandard"), t("soundStandardNote")],
  }[sound];
  const rows: Array<[string, string, string]> = [
    [
      t("changePicture"),
      t("pictureSize", { width: picture.width, height: picture.height }),
      pictureNotes.join(", "),
    ],
    smoothness.change === "capped"
      ? [t("changeSmoothness"), t("smoothCapped", { fps: smoothness.fps }), t("smoothCappedNote")]
      : [t("changeSmoothness"), t("smoothSame"), t("smoothSameNote")],
    [t("changeSound"), soundText[0]!, soundText[1]!],
  ];
  return (
    <dl className={styles.changeRows}>
      {rows.map(([label, value, note]) => (
        <div key={label} className={styles.changeRow}>
          <dt className={styles.changeLabel}>{label}</dt>
          <dd className={styles.changeValue}>{value}</dd>
          <dd className={styles.changeNote}>{note}</dd>
        </div>
      ))}
    </dl>
  );
}
