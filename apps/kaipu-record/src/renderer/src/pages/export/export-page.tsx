import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { FileX2, Film } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { ROUTES } from "@shared/routes";
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
import { useExportRunner } from "@renderer/features/video-editor/export/export-runner";
import { formatMB } from "@renderer/features/video-editor/export/export-size";
import {
  findReusableExports,
  WHOLE_RECORDING_FINGERPRINT,
} from "@renderer/features/video-editor/export/export-reuse";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import {
  type CopyPlan,
  type DestinationId,
  isDestinationId,
  planCopy,
  presetForDestination,
} from "@renderer/features/prepare/destinations";
import {
  exportNewPath,
  exportPath,
  PREPARE_DESTINATION_PARAM,
} from "@renderer/features/prepare/prepare-path";
import {
  type PrepareImport,
  usePrepareImport,
} from "@renderer/features/prepare/use-prepare-import";
import {
  asPreparable,
  type PreparableVideo,
  usePrepareCopy,
  useSourceProbe,
} from "@renderer/features/prepare/use-prepare-copy";
import { DestinationRow } from "./destination-row";
import { EXPORT_ORDER } from "./export-copy";
import { ExportDropZone } from "./export-drop-zone";
import { ExportHeader, ExportHeaderEmpty } from "./export-header";
import { DESTINATION_TITLE_ID, DestinationStage, NothingPicked } from "./export-stage";
import { RecentExports } from "./recent-exports";
import styles from "./export-page.module.css";

/**
 * Export: a copy of a recording for where it is going, on its own screen under Editor in the
 * rail. It replaces Prepare (NIW2-578/583/587) and reuses everything behind it — the
 * destinations, the estimates, `usePrepareCopy` and the background export runner.
 *
 * The video is always in view at the top, the destinations in one row at the bottom, and what
 * changes for the picked one in between. The recording is the original and is never changed.
 * With no video (`/export`) the screen is the door for any video, from Kaipu or from outside:
 * a drop zone, the Library picker and the recent exports. A video dropped anywhere on Export is
 * imported into the Library and opened here, keeping the selected destination.
 */
export function ExportPage(): React.JSX.Element {
  const t = useTranslations("export");
  const tLib = useTranslations("library");
  const { assetId } = useParams<{ assetId: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { videos, isLoading, refresh } = useLocalLibrary();
  const lineage = useMemo(() => buildLineage(videos), [videos]);

  const to = searchParams.get(PREPARE_DESTINATION_PARAM);
  const urlDestination = isDestinationId(to) ? to : null;
  // The destination picked on this screen, read when a dropped video finishes importing and
  // when the video is changed. Another recording starts from its URL again.
  const chosen = useRef<DestinationId | null>(null);
  useEffect(() => {
    chosen.current = null;
  }, [assetId]);
  const choose = (d: DestinationId): void => {
    chosen.current = d;
  };
  const current = (): DestinationId | null => chosen.current ?? urlDestination;
  const drop = usePrepareImport({ destination: current, refresh });
  const openVideo = (v: LibraryVideo): void => {
    void navigate(exportPath(v.assetId, current() ?? undefined));
  };

  // A copy finished in the background: re-list, so its card reads Ready and Enter opens it
  // instead of encoding it again. Main sends no library:changed when an export lands.
  const readyId = useExportRunner().ready?.recording.id ?? null;
  useEffect(() => {
    if (readyId) void refresh();
  }, [readyId, refresh]);

  const video = videos.find((v) => v.assetId === assetId);
  const preparable = asPreparable(video);
  const probe = useSourceProbe(preparable?.id ?? null);

  // An unreadable file has nothing to export: say so and offer another.
  useEffect(() => {
    if (probe.status !== "error") return;
    showToast({ message: tLib("shareReadError") });
    navigate(exportNewPath(urlDestination), { replace: true });
  }, [probe.status, navigate, tLib, urlDestination]);

  if (!assetId) {
    return (
      <div className={styles.screen}>
        <ExportHeaderEmpty />
        <ExportDropZone
          active={drop.dragging}
          importing={drop.importing}
          videos={videos}
          onPickVideo={openVideo}
          onBrowseFiles={() => void drop.pickAndImport()}
        />
        <RecentExports videos={videos} onOpen={(v) => navigate(`/library/${v.assetId}`)} />
      </div>
    );
  }

  // Only the first load: a re-list keeps the screen, and with it the destination, the
  // 1440p / 4K choice and Fill / Fit picked so far.
  if (isLoading && !video) return <div className={styles.centered}>{tLib("loading")}</div>;

  if (!video) {
    return (
      <div className={styles.centered}>
        <FileX2 size={40} strokeWidth={1.5} className={styles.mutedIcon} />
        <h2 className={styles.centeredTitle}>{tLib("fileNotFound")}</h2>
        <Button variant="ghost" onClick={() => navigate(ROUTES.exportNew)}>
          {t("pageTitle")}
        </Button>
      </div>
    );
  }

  if (!preparable) {
    return (
      <div className={styles.centered}>
        <Film size={40} strokeWidth={1.5} className={styles.mutedIcon} />
        <h2 className={styles.centeredTitle}>{t("notExportableTitle")}</h2>
        <p className={styles.centeredBody}>{t("notExportableBody")}</p>
        <Button variant="ghost" onClick={() => navigate(ROUTES.exportNew)}>
          {t("pageTitle")}
        </Button>
      </div>
    );
  }

  if (probe.status !== "ready") {
    return <div className={styles.centered}>{t("reading")}</div>;
  }

  const badge = editBadge(video, lineage);
  return (
    <ExportScreen
      // A new probe (another recording) starts the screen over.
      key={preparable.id}
      video={preparable}
      probe={probe.probe}
      videos={videos}
      exports={lineage.exportsOf.get(video.assetId) ?? []}
      hasUnexportedEdits={badge === "never-exported" || badge === "stale"}
      initialDestination={urlDestination}
      onSelect={choose}
      drop={drop}
      onChangeVideo={openVideo}
      onOpenExisting={(existing) => navigate(`/library/${existing.assetId}`)}
    />
  );
}

/** `/prepare/...` from before Export: the same screen, with the query (`?to=`) kept. */
export function LegacyPrepareRedirect(): React.JSX.Element {
  const { assetId } = useParams<{ assetId: string }>();
  const { search } = useLocation();
  const base = assetId ? ROUTES.export.replace(":assetId", encodeURIComponent(assetId)) : null;
  return <Navigate to={`${base ?? ROUTES.exportNew}${search}`} replace />;
}

interface ExportScreenProps {
  video: PreparableVideo;
  probe: SourceProbe;
  /** The Library, for "Change video". */
  videos: readonly LibraryVideo[];
  /** The recording's exports (`buildLineage().exportsOf`), for the "Ready" cards. */
  exports: readonly LibraryVideo[];
  /** The edit session holds edits no file carries: a copy from here would not have them. */
  hasUnexportedEdits: boolean;
  /** From `?to=`; null shows "Where is it going?" until a card is picked. */
  initialDestination: DestinationId | null;
  /** The user picked a destination; a video dropped or picked next opens with it. */
  onSelect(destination: DestinationId): void;
  drop: PrepareImport;
  onChangeVideo(video: LibraryVideo): void;
  onOpenExisting(existing: LibraryVideo): void;
}

/**
 * Header, stage and destination row. The arrows move the selection along the row and Enter
 * runs the primary action of the picked destination.
 */
function ExportScreen({
  video,
  probe,
  videos,
  exports,
  hasUnexportedEdits,
  initialDestination,
  onSelect,
  drop,
  onChangeVideo,
  onOpenExisting,
}: ExportScreenProps): React.JSX.Element {
  const tEditor = useTranslations("videoEditor");
  const copy = usePrepareCopy();

  const [selected, setSelected] = useState<DestinationId | null>(initialDestination);
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

  // "Ready": a file that already is this copy (same preset, whole recording).
  const reusable = useMemo(
    () => findReusableExports(exports, WHOLE_RECORDING_FINGERPRINT),
    [exports],
  );

  const estimateText = (plan: CopyPlan): string =>
    plan.sizeKind === "full" || plan.estimateBytes === null
      ? tEditor("sizeFull")
      : tEditor("sizeAbout", { size: formatMB(plan.estimateBytes) });
  const sizeText = (plan: CopyPlan): string =>
    plan.sizeKind === "up-to" && plan.estimateBytes !== null
      ? tEditor("sizeUpTo", { size: formatMB(plan.estimateBytes) })
      : estimateText(plan);

  const plan = selected ? planFor(selected) : null;
  const existing = plan ? reusable[plan.target.presetId] : undefined;
  const startCopy = (): void => {
    if (!plan) return;
    copy.start({
      video,
      probe,
      choice: { presetId: plan.target.presetId, framing: framingOf(plan.destination) },
      destination: plan.destination,
    });
  };
  // A copy that already exists is opened, not encoded again; "Export again" stays one click away.
  const primary = (): void => {
    if (!plan) return;
    if (existing) onOpenExisting(existing);
    else startCopy();
  };
  const step = (by: 1 | -1): void => {
    const at = selected ? EXPORT_ORDER.indexOf(selected) : by === 1 ? -1 : EXPORT_ORDER.length;
    const next = EXPORT_ORDER[Math.min(EXPORT_ORDER.length - 1, Math.max(0, at + by))]!;
    select(next);
  };

  // Enter and the arrows act on the whole screen. The latest handlers are read through a ref
  // so the listener is added once; a layout effect, so it is live as soon as the screen is.
  const keys = useRef({ primary, step });
  keys.current = { primary, step };
  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isPrimaryEnter(event)) {
        // A card would otherwise also click itself: Enter is "export", not "select".
        event.preventDefault();
        keys.current.primary();
        return;
      }
      const by = destinationStep(event);
      if (by === null) return;
      event.preventDefault();
      // Focus follows the selection when it was on a card, like a radio group.
      const fromCard = isDestinationCard(event.target);
      keys.current.step(by);
      if (fromCard) {
        requestAnimationFrame(() =>
          document
            .querySelector<HTMLElement>(`[data-export-row] [role='radio'][aria-checked='true']`)
            ?.focus(),
        );
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className={styles.screen} data-dragging={drop.dragging}>
      <ExportHeader video={video} probe={probe} videos={videos} onChangeVideo={onChangeVideo} />
      <section className={styles.stage} aria-labelledby={plan ? DESTINATION_TITLE_ID : undefined}>
        <div className={styles.stageInner}>
          {plan ? (
            <DestinationStage
              plan={plan}
              planFor={planFor}
              probe={probe}
              sourceSizeBytes={video.fileSizeBytes}
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
              onExportAgain={startCopy}
            />
          ) : (
            <NothingPicked />
          )}
        </div>
      </section>
      <div data-export-row className={styles.row}>
        <DestinationRow
          selected={selected}
          onSelect={select}
          sizes={{
            planFor,
            sizeText: estimateText,
            isReady: (d) => reusable[presetForDestination(d, probe, youtube)] !== undefined,
          }}
        />
      </div>
    </div>
  );
}

/** A destination card in the bottom row. */
function isDestinationCard(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest("[data-export-row]") !== null;
}

/**
 * Which way an arrow key moves the selection along the row, or null when it is not for the
 * row: a modifier, a held key, a field, or another radio group (YouTube's 1440p / 4K, Fill /
 * Fit), which answers its own arrows.
 */
export function destinationStep(event: KeyboardEvent): 1 | -1 | null {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return null;
  if (event.defaultPrevented || event.isComposing) return null;
  if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
  const target = event.target instanceof HTMLElement ? event.target : null;
  if (target) {
    if (target.isContentEditable || target.closest("input, textarea, select")) return null;
    if (target.closest("[role='radiogroup']") && !isDestinationCard(target)) return null;
    if (target.closest("[role='dialog']")) return null;
  }
  return event.key === "ArrowRight" ? 1 : -1;
}

/**
 * Whether a keydown is "Enter, export": no modifier, not a held key, and not typed into a
 * field or pressed on a button or link — those answer Enter themselves (the Export button
 * clicks itself; Change video opens its list). The destination cards and the 1440p / 4K
 * choice are radios, which Enter does not select, so Enter there exports.
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
