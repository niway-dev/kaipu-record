import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FileX2, Film } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { showToast } from "@renderer/ui/toast-store";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  defaultYoutubePreset,
  type ExportFraming,
  PRESETS,
  type YoutubePresetId,
} from "@renderer/features/video-editor/export/export-presets";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import { findReusableExports } from "@renderer/features/video-editor/export/export-reuse";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import {
  type CopyPlan,
  type DestinationId,
  isDestinationId,
  planCopy,
  presetForDestination,
} from "@renderer/features/prepare/destinations";
import { PREPARE_DESTINATION_PARAM, prepareNewPath } from "@renderer/features/prepare/prepare-path";
import {
  type PrepareImport,
  usePrepareImport,
} from "@renderer/features/prepare/use-prepare-import";
import {
  asPreparable,
  type PreparableVideo,
  prepareFingerprint,
  prepareScene,
  usePrepareCopy,
  useSourceProbe,
} from "@renderer/features/prepare/use-prepare-copy";
import { DESTINATION_TITLE_ID, DestinationDetail } from "./destination-detail";
import { DestinationList } from "./destination-list";
import { PrepareDropZone } from "./prepare-drop-zone";
import styles from "./prepare-page.module.css";

/**
 * The destination selected when the URL names none. Always YouTube, not the last one used:
 * the page is reached from a recording, and a remembered choice from another recording would
 * make the same link open differently from one day to the next (NIW2-583).
 */
export const DEFAULT_DESTINATION: DestinationId = "youtube";

/**
 * Prepare (NIW2-578, layout NIW2-583): "where is it going?" as a screen. The recording is the
 * original and is never changed; Prepare makes a new copy of it for one destination, in the
 * background, through the same export pipeline as the editor. Reached from the recording page
 * (its "Prepare for…" button, the quick chips, the heavy-to-send banner, the post-recording
 * panel) and from the Library cards. With no recording (`/prepare`, NIW2-587) it is a drop zone:
 * a video dropped on any Prepare screen is imported into the Library and opened here, keeping
 * the selected destination.
 */
export function PreparePage(): React.JSX.Element {
  const t = useTranslations("prepare");
  const tLib = useTranslations("library");
  const { assetId } = useParams<{ assetId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { videos, isLoading, refresh } = useLocalLibrary();
  const lineage = useMemo(() => buildLineage(videos), [videos]);

  const to = searchParams.get(PREPARE_DESTINATION_PARAM);
  const urlDestination = isDestinationId(to) ? to : null;
  // The destination picked on this screen, read when a dropped video finishes importing. A
  // new recording starts from its URL again.
  const chosen = useRef<DestinationId | null>(null);
  useEffect(() => {
    chosen.current = null;
  }, [assetId]);
  const choose = (d: DestinationId): void => {
    chosen.current = d;
  };
  const drop = usePrepareImport({
    destination: () => chosen.current ?? urlDestination,
    refresh,
  });

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

  if (!assetId) {
    return (
      <PrepareWithoutRecording
        initialDestination={urlDestination}
        onSelect={choose}
        drop={drop}
        onBack={() => navigate("/library")}
      />
    );
  }

  if (isLoading) return <div className={styles.centered}>{tLib("loading")}</div>;

  if (!video) {
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

  const badge = editBadge(video, lineage);
  return (
    <PrepareScreen
      // A new probe (another recording) starts the screen over.
      key={preparable.id}
      video={preparable}
      probe={probe.probe}
      exports={lineage.exportsOf.get(video.assetId) ?? []}
      hasUnexportedEdits={badge === "never-exported" || badge === "stale"}
      initialDestination={urlDestination ?? DEFAULT_DESTINATION}
      onSelect={choose}
      drop={drop}
      onBack={() => navigate(recordingPath)}
      onStarted={() => navigate(recordingPath)}
      onOpenExisting={(existing) => navigate(`/library/${existing.assetId}`)}
      onPrepareAnother={(d) => navigate(prepareNewPath(d))}
    />
  );
}

interface PrepareScreenProps {
  video: PreparableVideo;
  probe: SourceProbe;
  /** The recording's exports (`buildLineage().exportsOf`), for the "Ready" rows. */
  exports: readonly LibraryVideo[];
  /** The edit session holds edits no file carries: a copy from here would not have them. */
  hasUnexportedEdits: boolean;
  initialDestination: DestinationId;
  /** The user picked a destination; a video dropped next opens with it. */
  onSelect(destination: DestinationId): void;
  drop: PrepareImport;
  onBack(): void;
  /** The copy is being made in the background. */
  onStarted(): void;
  onOpenExisting(existing: LibraryVideo): void;
  /** "Prepare another video": Prepare with no recording, keeping the destination (NIW2-587). */
  onPrepareAnother(destination: DestinationId): void;
}

/**
 * Two columns: where it is going on the left, what the copy will be and why on the right.
 * A destination is always selected, so the right column is never empty, and Enter runs its
 * primary action.
 */
function PrepareScreen({
  video,
  probe,
  exports,
  hasUnexportedEdits,
  initialDestination,
  onSelect,
  drop,
  onBack,
  onStarted,
  onOpenExisting,
  onPrepareAnother,
}: PrepareScreenProps): React.JSX.Element {
  const t = useTranslations("prepare");
  const tEditor = useTranslations("videoEditor");
  const prepare = usePrepareCopy();

  const [selected, setSelected] = useState<DestinationId>(initialDestination);
  const select = (d: DestinationId): void => {
    setSelected(d);
    onSelect(d);
  };
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

  // "Ready": a file that already is this copy (same preset, whole recording, same face).
  const fingerprint = useMemo(() => prepareFingerprint(prepareScene(video, probe)), [video, probe]);
  const reusable = useMemo(() => findReusableExports(exports, fingerprint), [exports, fingerprint]);

  const estimateText = (plan: CopyPlan): string =>
    plan.sizeKind === "full" || plan.estimateBytes === null
      ? tEditor("sizeFull")
      : tEditor("sizeAbout", { size: formatMB(plan.estimateBytes) });
  const sizeText = (plan: CopyPlan): string =>
    plan.sizeKind === "up-to" && plan.estimateBytes !== null
      ? tEditor("sizeUpTo", { size: formatMB(plan.estimateBytes) })
      : estimateText(plan);

  const plan = planFor(selected);
  const existing = reusable[plan.target.presetId];
  const startCopy = (): void => {
    const started = prepare.start({
      video,
      probe,
      choice: { presetId: plan.target.presetId, framing: framingOf(plan.destination) },
    });
    if (started) onStarted();
  };
  // A copy that already exists is opened, not encoded again; "Prepare again" stays one click away.
  const primary = (): void => (existing ? onOpenExisting(existing) : startCopy());

  // Enter runs the primary action. The latest one is read through a ref so the listener is
  // added once, not on every render; a layout effect, so it is live as soon as the screen is.
  const primaryRef = useRef(primary);
  primaryRef.current = primary;
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isPrimaryEnter(event)) return;
      // A radio row would otherwise also click itself: Enter is "prepare", not "select".
      event.preventDefault();
      primaryRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles.screen}>
      <DestinationList
        selected={selected}
        onSelect={select}
        sizes={{
          planFor,
          estimateText,
          isReady: (d) => reusable[presetForDestination(d, probe, youtube)] !== undefined,
        }}
        backLabel={t("back")}
        onBack={onBack}
        onPrepareAnother={() => onPrepareAnother(selected)}
        dropActive={drop.dragging}
        importing={drop.importing}
      />
      <section className={styles.detail} aria-labelledby={DESTINATION_TITLE_ID}>
        <DestinationDetail
          plan={plan}
          planFor={planFor}
          probe={probe}
          sourceSizeBytes={video.fileSizeBytes}
          thumbnailUrl={video.thumbnailUrl ?? null}
          hasUnexportedEdits={hasUnexportedEdits}
          youtube={youtube}
          onYoutube={setYoutube}
          onFraming={(f) =>
            (selected === "vertical" || selected === "square") &&
            setFramings((prev) => ({ ...prev, [selected]: f }))
          }
          sizeText={sizeText}
          hasExisting={existing !== undefined}
          onPrimary={primary}
          onPrepareAgain={startCopy}
        />
      </section>
    </div>
  );
}

interface PrepareWithoutRecordingProps {
  /** From `?to=`; nothing is selected when the URL names no destination. */
  initialDestination: DestinationId | null;
  onSelect(destination: DestinationId): void;
  drop: PrepareImport;
  onBack(): void;
}

/**
 * Prepare before there is a video (NIW2-587): the destinations, without sizes since there is
 * no source yet, and a drop zone. Picking a destination first is optional; the video opens
 * with whichever one is selected.
 */
function PrepareWithoutRecording({
  initialDestination,
  onSelect,
  drop,
  onBack,
}: PrepareWithoutRecordingProps): React.JSX.Element {
  const tLib = useTranslations("library");
  const [selected, setSelected] = useState<DestinationId | null>(initialDestination);
  const pick = (): void => void drop.pickAndImport();
  return (
    <div className={styles.screen}>
      <DestinationList
        selected={selected}
        onSelect={(d) => {
          setSelected(d);
          onSelect(d);
        }}
        backLabel={tLib("backToLibrary")}
        onBack={onBack}
        onPrepareAnother={pick}
        dropActive={drop.dragging}
        importing={drop.importing}
      />
      <PrepareDropZone
        active={drop.dragging}
        importing={drop.importing}
        onChooseFile={pick}
        onFromLibrary={onBack}
      />
    </div>
  );
}

/**
 * Whether a keydown is "Enter, prepare": no modifier, not a held key, and not typed into a
 * field or pressed on a button or link — those answer Enter themselves (the Prepare button
 * clicks itself; Back goes back). The destination rows and the 1440p / 4K choice are radios,
 * which Enter does not select, so Enter there prepares.
 */
export function isPrimaryEnter(event: KeyboardEvent): boolean {
  if (event.key !== "Enter" || event.repeat || event.defaultPrevented || event.isComposing) {
    return false;
  }
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return false;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (!target) return true;
  if (target.isContentEditable) return false;
  if (target.closest("input, textarea, select")) return false;
  if (target.closest("a[href], button:not([role='radio'])")) return false;
  return true;
}
