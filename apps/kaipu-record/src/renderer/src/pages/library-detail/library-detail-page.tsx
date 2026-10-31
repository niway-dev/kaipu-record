import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  Copy,
  FileX2,
  FolderOpen,
  Leaf,
  Pencil,
  Scissors,
  Send,
  Trash2,
} from "lucide-react";
import { canOpenInEditor, useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import { useTransientValue } from "@renderer/ui/use-transient-value";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { useMissingRecordingRecovery } from "@renderer/features/library/hooks/use-missing-recording-recovery";
import { reportError } from "@renderer/features/analytics";
import { showToast } from "@renderer/ui/toast-store";
import { StorageMeta } from "@renderer/features/library/components/storage-meta";
import { useRecordingCaptureLabel } from "@renderer/features/library/components/recording-capture-tag";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { RecordingPlayer } from "@renderer/features/library/components/recording-player";
import { ScreenshotViewer } from "@renderer/features/library/components/screenshot-viewer";
import { GifViewer } from "@renderer/features/library/components/gif-viewer";
import {
  githubFit,
  resolveExportTarget,
} from "@renderer/features/video-editor/export/export-presets";
import { formatMB, isHeavyToSend } from "@renderer/features/video-editor/export/export-size";
import { useExportRunner } from "@renderer/features/video-editor/export/export-runner";
import type { DestinationId } from "@renderer/features/prepare/destinations";
import {
  MasterCopiesPanel,
  runningCopyOf,
} from "@renderer/features/prepare/components/master-copies-panel";
import { WhereIsThisGoingStrip } from "@renderer/features/prepare/components/where-is-this-going-strip";
import { preparePath } from "@renderer/features/prepare/prepare-path";
import { asPreparable, useSourceProbe } from "@renderer/features/prepare/use-prepare-copy";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { StatusCardPortal } from "@renderer/features/status-cards/status-stack";
import { PostRecordingCard } from "@renderer/features/status-cards/post-recording-card";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { RecordingTitle } from "@renderer/features/library/components/recording-title";
import { TagEditor } from "@renderer/features/library/components/tag-editor";
import { resolveTags, useTags } from "@renderer/features/library/hooks/use-tags";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format";
import { buildLineage, editBadge, isMaster } from "@renderer/features/library/lineage";
import { MasterTag } from "@renderer/features/library/components/master-tag";
import type { EditingState, RemoveLocalCopyResult } from "@shared/types/library-item";
import { Button } from "@kaipu/ui";
import { Badge } from "@kaipu/ui";
import { useTranslations, type Messages } from "@kaipu/i18n";
import styles from "./library-detail-page.module.css";

type LibraryMessageKey = keyof Messages["library"];

const EDITING_LABEL_KEYS: Record<EditingState, LibraryMessageKey> = {
  "project-available": "editingProjectAvailable",
  "needs-source": "editingNeedsSource",
  "exported-only": "editingExportedOnly",
  "missing-dependencies": "editingMissingDependencies",
};

/** Maps a blocked `removeLocalCopy` result to its toast copy. `hash-unknown` and
 *  `not-found` are edge cases outside this action's guarded conditions (see
 *  `canRemoveLocalCopy` below) — the full confirm dialog with dedicated copy
 *  for every reason is plan 04; here they fall back to the generic delete
 *  error text. */
function removeLocalCopyBlockedKey(
  reason: Exclude<RemoveLocalCopyResult, { ok: true }>["reason"],
): LibraryMessageKey {
  switch (reason) {
    case "edit-project":
      return "removeLocalCopyBlockedEdit";
    case "webcam-track":
      return "removeLocalCopyBlockedWebcam";
    case "different-bytes":
      return "removeLocalCopyBlockedBytes";
    case "no-cloud-copy":
      return "removeLocalCopyBlockedNoCloud";
    default:
      return "errorDelete";
  }
}

export function LibraryDetailPage(): React.JSX.Element {
  const t = useTranslations("library");
  const { assetId } = useParams<{ assetId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { videos, isLoading, refresh, rename, setTags, remove, reveal, removeLocalCopy } =
    useLocalLibrary();

  const video = videos.find((v) => v.assetId === assetId);
  const tagApi = useTags();

  // A recording can momentarily lag the navigation into its own detail page right
  // after it finalizes; recover (re-list once, then fall back to the Library +
  // log) instead of dead-ending on "File not found".
  const fromRecording = (location.state as { fromRecording?: boolean } | null)?.fromRecording;
  const { recovering } = useMissingRecordingRecovery({
    id: assetId,
    found: Boolean(video),
    isLoading,
    listSize: videos.length,
    fromRecording: Boolean(fromRecording),
    refresh,
  });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, showCopied] = useTransientValue<true>(2200);
  // Computed before the early returns below: hooks can't be called conditionally,
  // and buildLineage works fine on an empty/loading `videos` list.
  const { openItem } = useOpenInEditor();
  const lineage = useMemo(() => buildLineage(videos), [videos]);
  const captureLabel = useRecordingCaptureLabel(video?.capture);

  // NIW2-578: Prepare — the core action — opens from "Send to…" (NIW2-585), the "Where is
  // this going?" chips, the "heavy to send" banner and the post-recording card. Only a local
  // recording has a copy to make (no screenshots, no GIFs).
  const preparable = asPreparable(video);
  const heavy = preparable !== null && isHeavyToSend(preparable.fileSizeBytes);
  // "Your video is ready" (NIW2-584): the top-right card on the page a fresh recording lands
  // on, once per arrival, until a chip, Open or ✕ — or leaving the page, which unmounts it.
  // The stored setting keeps its NIW2-218 name.
  const { settings } = useAppSettings();
  const [cardDismissedFor, setCardDismissedFor] = useState<string | null>(null);
  const showCard =
    Boolean(fromRecording) &&
    preparable !== null &&
    settings?.showRecordingSavedCard === true &&
    cardDismissedFor !== location.key;
  // Read the file up front only when the banner or the card needs its numbers.
  const probe = useSourceProbe(heavy || showCard ? (preparable?.id ?? null) : null).probe;
  // A copy finished in the background: re-list, so it shows under "Copies from this master".
  const runner = useExportRunner();
  const readyId = runner.ready?.recording.id ?? null;
  useEffect(() => {
    if (readyId) void refresh();
  }, [readyId, refresh]);
  const openPrepare = (destination?: DestinationId): void => {
    if (assetId) navigate(preparePath(assetId, destination));
  };

  const back = (): void => {
    navigate("/library");
  };

  // Only the first load shows the loading state. A background re-list (the
  // `library:changed` a rename broadcasts) keeps the page — and the player, with its
  // playback position — mounted (NIW2-560).
  if ((isLoading && !video) || recovering) {
    return <div className={styles.centered}>{t("loading")}</div>;
  }

  if (!video || !assetId) {
    return (
      <div className={styles.centered}>
        <FileX2 size={40} strokeWidth={1.5} className={styles.missingIcon} />
        <h2 className={styles.missingTitle}>{t("fileNotFound")}</h2>
        <Button variant="ghost" onClick={back}>
          {t("backToLibrary")}
        </Button>
      </div>
    );
  }

  const localId = video.id;
  const isScreenshot = video.kind === "screenshot";
  // NIW2-217: a GIF export plays in an <img>, has no editor and no edit-state line.
  const isGif = video.kind === "gif";
  const gifInfo = isGif ? video.gif : null;
  const source = video.derivedFromAssetId
    ? lineage.byAssetId.get(video.derivedFromAssetId)
    : undefined;
  const sourceDeleted = video.derivedFromAssetId !== null && source === undefined;
  const exports = lineage.exportsOf.get(video.assetId) ?? [];
  const badge = editBadge(video, lineage);
  // NIW2-585: the recording is the master — tagged over the player, and the page asks where
  // it is going and lists the copies made from it.
  const master = isMaster(video);
  const running = runningCopyOf(runner, video.assetId);
  const showCopies = master || exports.length > 0 || running !== null;

  // `localId !== null` is implied by the condition below (it requires a local
  // copy to exist) but kept explicit here — the button's own name promises
  // there is a local download to remove. The editing state is intentionally
  // not consulted here: a `project-available` item still shows the button,
  // and main's remove-local-copy policy is what refuses it with `edit-project`
  // (the page then toasts `removeLocalCopyBlockedEdit`).
  const canRemoveLocalCopy =
    localId !== null && video.availability === "local-and-cloud" && video.comparison === "same";

  const doDelete = (): void => {
    if (!localId) return;
    void remove(localId);
    setConfirmingDelete(false);
    back();
  };

  const doRemoveLocalCopy = async (): Promise<void> => {
    if (!localId) return;
    const result = await removeLocalCopy(localId);
    if (!result.ok) {
      showToast({ message: t(removeLocalCopyBlockedKey(result.reason)) });
    }
  };

  // Copy a saved screenshot to the clipboard — main reads the vault file by id
  // (fetch on the kaipu-media:// scheme doesn't return bytes in the renderer).
  const copyScreenshot = async (): Promise<void> => {
    if (!localId) return;
    try {
      await window.electronAPI.copyScreenshotById(localId);
      showCopied(true);
    } catch (error) {
      reportError(t("copyError"), error, {
        context: { id: localId, phase: "copy-by-id" },
        retry: () => void copyScreenshot(),
      });
    }
  };

  // Re-open a saved screenshot in the editor (its URL is /editor/image/:assetId).
  const editScreenshot = (): void => {
    if (!localId) return;
    openItem(video);
  };

  // The editor builds its initial scene from the recording's duration — an older
  // vault item without one (pre-duration-tracking capture) can't be opened.
  const canEditVideo = canOpenInEditor(video);
  const editVideo = (): void => {
    if (!canEditVideo) return;
    openItem(video);
  };

  return (
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={back}>
        <ArrowLeft size={16} strokeWidth={1.8} />
        {t("title")}
      </button>

      {showCard && (
        <StatusCardPortal>
          <PostRecordingCard
            durationSeconds={probe?.durationSec ?? video.durationSeconds}
            dimensions={probe ? { width: probe.width, height: probe.height } : null}
            sizeBytes={video.fileSizeBytes}
            onPick={(destination) => {
              setCardDismissedFor(location.key);
              openPrepare(destination ?? undefined);
            }}
            onEditFirst={canEditVideo ? editVideo : undefined}
            onDismiss={() => setCardDismissedFor(location.key)}
          />
        </StatusCardPortal>
      )}

      {isScreenshot ? (
        <ScreenshotViewer src={video.thumbnailUrl} />
      ) : isGif ? (
        localId && <GifViewer id={localId} />
      ) : (
        localId && (
          <div className={styles.player}>
            <RecordingPlayer
              id={localId}
              poster={video.thumbnailUrl}
              webcam={video.webcam}
              durationSeconds={video.durationSeconds}
            />
            {master && (
              <span className={styles.masterTag}>
                <MasterTag />
              </span>
            )}
          </div>
        )
      )}

      <div className={styles.bar}>
        <div className={styles.titleBlock}>
          <RecordingTitle
            title={video.title}
            onRename={(title) => {
              if (localId) void rename(localId, video.assetId, title);
            }}
          />
          {localId && (
            <TagEditor
              assigned={resolveTags(video.tagIds, tagApi.byId)}
              all={tagApi.tags}
              onAssign={(next) => setTags(localId, next)}
              onCreate={tagApi.create}
            />
          )}
          <div className={styles.meta}>
            <StorageMeta video={video} />
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem}>{relativeDate(video.createdAt)}</span>
            {!isScreenshot && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem}>{formatDuration(video.durationSeconds)}</span>
              </>
            )}
            {captureLabel && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem} data-testid="capture-meta">
                  {captureLabel}
                </span>
              </>
            )}
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem} data-heavy={heavy}>
              {formatSize(video.fileSizeBytes)}
            </span>
            {gifInfo && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem}>
                  {t("gifSpecs", {
                    width: gifInfo.width,
                    height: gifInfo.height,
                    fps: gifInfo.fps,
                  })}
                </span>
              </>
            )}
            {video.cloudSizeBytes !== null && video.cloudSizeBytes !== video.fileSizeBytes && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem}>
                  {t("availabilityCloud")} {formatSize(video.cloudSizeBytes)}
                </span>
              </>
            )}
            {/* The player streams the vault file, which ADR 0003 keeps untouched: edits
                live in a sidecar session, composited only in the editor and burned in only
                by an export. Saying so keeps the edit badges below from reading as
                contradictions, and makes the promise checkable — hit play. */}
            {master && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.masterNote}>
                  {t("masterNote")}
                  {video.editSavedAt !== null && ` ${t("masterEditsNote")}`}
                </span>
              </>
            )}
          </div>
          {!isScreenshot && !isGif && badge === null && (
            <p className={styles.editingLine}>{t(EDITING_LABEL_KEYS[video.editing])}</p>
          )}
          {(badge === "never-exported" || badge === "stale") && (
            <button
              type="button"
              className={styles.badgeButton}
              title={badge === "stale" ? t("editedStaleHint") : t("editedNotExportedHint")}
              onClick={editVideo}
              disabled={!canEditVideo}
            >
              <Badge variant="warning">
                {badge === "stale" ? t("editedStale") : t("editedNotExported")}
              </Badge>
            </button>
          )}
          {badge === "edited" && <p className={styles.editingLine}>{t("edited")}</p>}
          {(source || sourceDeleted) && (
            <p className={styles.editingLine}>
              <span className={styles.lineageLabel}>{t("source")}</span>
              {source ? (
                <Link to={`/library/${source.assetId}`} className={styles.lineageLink}>
                  {source.title}
                </Link>
              ) : (
                t("sourceDeleted")
              )}
            </p>
          )}
        </div>

        <div className={styles.actions}>
          {/* Send to… opens Prepare (NIW2-578) — the core action. This page is also where a
              fresh recording lands (`fromRecording`), so it is the post-recording entry point
              too. "Prepare for…" did not say what it does (NIW2-585). */}
          {preparable && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => openPrepare()}
              title={t("sendToHint")}
            >
              <Send size={15} strokeWidth={1.8} />
              {t("sendTo")}
            </Button>
          )}
          {isScreenshot && localId && (
            <>
              <Button variant="outline" size="sm" onClick={editScreenshot}>
                <Pencil size={15} strokeWidth={1.8} />
                {t("edit")}
              </Button>
              <Button variant="outline" size="sm" onClick={copyScreenshot}>
                {copied ? (
                  <Check size={15} strokeWidth={1.8} />
                ) : (
                  <Copy size={15} strokeWidth={1.8} />
                )}
                {copied ? t("copied") : t("copy")}
              </Button>
            </>
          )}
          {!isScreenshot && !isGif && localId && (
            <Button
              variant="outline"
              size="sm"
              onClick={editVideo}
              disabled={!canEditVideo}
              title={canEditVideo ? undefined : t("durationUnreadable")}
            >
              <Scissors size={15} strokeWidth={1.8} />
              {t("editVideo")}
            </Button>
          )}
          {localId && (
            <Button variant="outline" size="sm" onClick={() => reveal(localId)}>
              <FolderOpen size={15} strokeWidth={1.8} />
              {t("reveal")}
            </Button>
          )}
          {canRemoveLocalCopy && (
            <Button variant="ghost" size="sm" onClick={() => void doRemoveLocalCopy()}>
              {t("removeLocalCopy")}
            </Button>
          )}
          {localId && (
            <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
              <Trash2 size={15} strokeWidth={1.8} />
              {t("delete")}
            </Button>
          )}
        </div>
      </div>

      {showCopies && (
        <div className={styles.masterRow}>
          {/* The heavy-to-send hint folds into the strip: its GitHub chip is the light copy. */}
          {master && preparable && (
            <WhereIsThisGoingStrip
              onPick={(destination) => openPrepare(destination ?? undefined)}
              note={
                heavy && (
                  <HeavyToSendText
                    sizeBytes={video.fileSizeBytes}
                    lightEstimateBytes={lightEstimate(probe)}
                  />
                )
              }
            />
          )}
          <MasterCopiesPanel
            source={master ? "master" : "copy"}
            copies={exports}
            running={running}
          />
        </div>
      )}

      {heavy && !master && (
        <HeavyToSendBanner
          sizeBytes={video.fileSizeBytes}
          lightEstimateBytes={lightEstimate(probe)}
          onMakeLightCopy={() => openPrepare("github")}
        />
      )}

      {confirmingDelete && (
        <DeleteConfirmDialog
          title={video.title}
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={doDelete}
        />
      )}
    </div>
  );
}

/** What a Light copy would weigh, from the same math as Prepare; null until the file is read. */
function lightEstimate(probe: SourceProbe | null): number | null {
  if (!probe) return null;
  return resolveExportTarget("light", probe, probe.durationSec).estimateBytes;
}

/**
 * NIW2-218: a recording over 25 MB is heavy to send anywhere. Say so where the user looks
 * at it, with what a Light copy would weigh, and open Prepare on GitHub (NIW2-578). GitHub is
 * promised only when the Light copy fits. On a master the words live in the "Where is this
 * going?" strip instead (NIW2-585); this banner is for a heavy copy.
 */
function HeavyToSendBanner({
  sizeBytes,
  lightEstimateBytes,
  onMakeLightCopy,
}: {
  sizeBytes: number;
  lightEstimateBytes: number | null;
  onMakeLightCopy(): void;
}): React.JSX.Element {
  const t = useTranslations("library");
  return (
    <div className={styles.heavyBanner}>
      <HeavyToSendText sizeBytes={sizeBytes} lightEstimateBytes={lightEstimateBytes} />
      <button type="button" className={styles.heavyAction} onClick={onMakeLightCopy}>
        {t("heavyBannerAction")}
      </button>
    </div>
  );
}

/** "119 MB is heavy to send. Prepare a light copy — about 9 MB…": the banner's words. */
function HeavyToSendText({
  sizeBytes,
  lightEstimateBytes,
}: {
  sizeBytes: number;
  lightEstimateBytes: number | null;
}): React.JSX.Element {
  const t = useTranslations("library");
  return (
    <p className={styles.heavyText}>
      <Leaf size={17} strokeWidth={1.8} className={styles.heavyIcon} aria-hidden />
      <span>
        <strong>{t("heavyBannerTitle", { size: formatMB(sizeBytes) })}</strong>{" "}
        {lightEstimateBytes === null
          ? t("heavyBannerBodyNoEstimate")
          : githubFit(lightEstimateBytes) === "fits"
            ? t("heavyBannerBody", { estimate: formatMB(lightEstimateBytes) })
            : t("heavyBannerBodyNoGithub", { estimate: formatMB(lightEstimateBytes) })}
      </span>
    </p>
  );
}
