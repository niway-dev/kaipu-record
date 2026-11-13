import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Film,
  FileX2,
  FolderOpen,
  Image as ImageIcon,
  Info,
  Leaf,
  Pencil,
  Scissors,
  SquareArrowOutUpRight,
  Video as VideoIcon,
  X,
} from "lucide-react";
import { canOpenInEditor, useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { useMissingRecordingRecovery } from "@renderer/features/library/hooks/use-missing-recording-recovery";
import { reportError } from "@renderer/features/analytics";
import { showToast } from "@renderer/ui/toast-store";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { RecordingPlayer } from "@renderer/features/library/components/recording-player";
import { ScreenshotViewer } from "@renderer/features/library/components/screenshot-viewer";
import { GifViewer } from "@renderer/features/library/components/gif-viewer";
import { ItemActionsMenu } from "@renderer/features/library/components/item-actions-menu";
import { notMovableReason } from "@renderer/features/workspaces/move/move-flow";
import { ItemDetails } from "@renderer/features/library/components/item-details";
import { VersionsList } from "@renderer/features/library/components/versions-list";
import {
  githubFit,
  resolveExportTarget,
} from "@renderer/features/video-editor/export/export-presets";
import { formatMB, isHeavyToSend } from "@renderer/features/video-editor/export/export-size";
import { useExportRunner } from "@renderer/features/video-editor/export/export-runner";
import type { DestinationId } from "@renderer/features/prepare/destinations";
import { runningCopyOf } from "@renderer/features/prepare/running-copy";
import { DestinationsList } from "@renderer/features/prepare/components/destinations-list";
import { preparePath } from "@renderer/features/prepare/prepare-path";
import { asPreparable, useSourceProbe } from "@renderer/features/prepare/use-prepare-copy";
import { useAppSettings } from "@renderer/pages/settings/use-app-settings";
import { StatusCardPortal } from "@renderer/features/status-cards/status-stack";
import { PostRecordingCard } from "@renderer/features/status-cards/post-recording-card";
import { useFloatingReadyCard } from "@renderer/features/recording-ready/use-floating-ready-card";
import type { SourceProbe } from "@renderer/features/video-editor/export/probe-source";
import { RecordingTitle } from "@renderer/features/library/components/recording-title";
import { TagEditor } from "@renderer/features/library/components/tag-editor";
import { resolveTags, useTags } from "@renderer/features/library/hooks/use-tags";
import { absoluteDate, formatDuration, formatSize } from "@renderer/features/library/format";
import { buildLineage, editBadge, isMaster } from "@renderer/features/library/lineage";
import type { EditingState, RemoveLocalCopyResult } from "@shared/types/library-item";
import { Button } from "@kaipu/ui";
import { Badge } from "@kaipu/ui";
import { useLocale, useTranslations, type Messages } from "@kaipu/i18n";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import styles from "./library-detail-page.module.css";
import { uiArea } from "@renderer/lib/ui-area";

type LibraryMessageKey = keyof Messages["library"];

type PanelTab = "versions" | "details" | "destinations";

/** The editing-state line under the metadata. "project-available" has no line on purpose:
 *  the owner asked for it to go; the other states say something the user has to act on. */
const EDITING_LABEL_KEYS: Partial<Record<EditingState, LibraryMessageKey>> = {
  "needs-source": "editingNeedsSource",
  "missing-dependencies": "editingMissingDependencies",
  "exported-only": "editingExportedOnly",
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
  const locale = useLocale();
  const { assetId } = useParams<{ assetId: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { videos, isLoading, hasError, refresh, rename, setTags, remove, reveal, removeLocalCopy } =
    useLocalLibrary();

  const video = videos.find((v) => v.assetId === assetId);
  const tagApi = useTags();

  // A recording can momentarily lag the navigation into its own detail page right
  // after it finalizes; recover (re-list once, then fall back to the Library +
  // log) instead of dead-ending on "File not found".
  const navState = location.state as {
    fromRecording?: boolean;
    order?: string[];
  } | null;
  const fromRecording = navState?.fromRecording;
  const { recovering } = useMissingRecordingRecovery({
    id: assetId,
    found: Boolean(video),
    isLoading,
    hasError,
    listSize: videos.length,
    fromRecording: Boolean(fromRecording),
    refresh,
  });

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // The `i` by the title: its text shows on hover, keyboard focus and click, until Escape or blur.
  const [infoOpen, setInfoOpen] = useState(false);
  // Computed before the early returns below: hooks can't be called conditionally,
  // and buildLineage works fine on an empty/loading `videos` list.
  const { openItem } = useOpenInEditor();
  const lineage = useMemo(() => buildLineage(videos), [videos]);

  // The Library passes the list as it shows it (filter and sort applied); opened from
  // anywhere else, the whole library in its own order is the list. Ids that left the library
  // since the snapshot are dropped, and an item outside the passed list (a link to its source or
  // a copy the filter hides) falls back to the whole library, so the pager stays available.
  const order = useMemo(() => {
    const whole = videos.map((v) => v.assetId);
    if (!navState?.order) return whole;
    const present = new Set(whole);
    const passed = navState.order.filter((id) => present.has(id));
    return assetId && !passed.includes(assetId) ? whole : passed;
  }, [navState?.order, videos, assetId]);
  const position = assetId ? order.indexOf(assetId) : -1;

  // NIW2-578: Prepare — the core action — opens from "Export a copy", the "Where is it
  // going?" cards, "Open in Export", the "heavy to send" banner and the post-recording card.
  // Only a local recording has a copy to make (no screenshots, no GIFs).
  const preparable = asPreparable(video);
  const heavy = preparable !== null && isHeavyToSend(preparable.fileSizeBytes);
  // "Your video is ready" (NIW2-584): once per arrival of a fresh recording, floating on the
  // desktop in its own window; on this page's status stack only when that window could not
  // open, until a chip, Open or ✕ — or leaving the page, which unmounts it.
  // The stored setting keeps its NIW2-218 name.
  const { settings } = useAppSettings();
  const [cardDismissedFor, setCardDismissedFor] = useState<string | null>(null);
  const showCard =
    Boolean(fromRecording) &&
    preparable !== null &&
    settings?.showRecordingSavedCard === true &&
    cardDismissedFor !== location.key;
  // "Saved to your Library": the green notice over the player of a fresh recording, once per
  // arrival, until ✕.
  const [noticeDismissedFor, setNoticeDismissedFor] = useState<string | null>(null);
  const showSavedNotice = Boolean(fromRecording) && noticeDismissedFor !== location.key;
  // The file's picture size and duration: the resolution in the metadata line, the size of each
  // destination's copy, the picture size of each copy made from it, and the ready card's numbers.
  const probeState = useSourceProbe(preparable?.id ?? null);
  const probe = probeState.probe;
  // The floating card is asked for once the file has been read (or could not be), so it
  // opens with its numbers instead of repainting them.
  const probeSettled = probeState.status === "ready" || probeState.status === "error";
  const floatingCard = useFloatingReadyCard(
    showCard && probeSettled && preparable
      ? {
          key: location.key,
          payload: {
            assetId: preparable.assetId,
            durationSeconds: probe?.durationSec ?? preparable.durationSeconds,
            dimensions: probe ? { width: probe.width, height: probe.height } : null,
            sizeBytes: preparable.fileSizeBytes,
            canEdit: canOpenInEditor(preparable),
          },
        }
      : null,
  );
  const showInAppCard = showCard && floatingCard.inApp;
  // A copy finished in the background: re-list, so it shows under "Versions".
  const runner = useExportRunner();
  const readyId = runner.ready?.recording.id ?? null;
  useEffect(() => {
    if (readyId) void refresh();
  }, [readyId, refresh]);
  const openPrepare = (destination?: DestinationId): void => {
    if (assetId) navigate(preparePath(assetId, destination));
  };

  // The file's absolute path: the name under the media, the Details row and "Copy path".
  const localIdForPath = video?.id ?? null;
  const [path, setPath] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setPath(null);
    if (localIdForPath) {
      window.electronAPI
        .localRecordingPath(localIdForPath)
        .then((value) => live && setPath(value))
        .catch(() => live && setPath(null));
    }
    return () => {
      live = false;
    };
  }, [localIdForPath, video?.title]);

  // A screenshot's picture size comes from the image itself, once it has loaded.
  const [shotSize, setShotSize] = useState<{
    assetId: string;
    width: number;
    height: number;
  } | null>(null);

  // The panel's tabs. Until the user picks one, "Where is it going?" leads while the
  // original has no copy yet (Export v3, section 1); "Versions" otherwise. Moving to another
  // item starts over.
  // The pick is stored with the item it was made on, so another item ignores it at once
  // (an effect that cleared it would paint the old tab for one frame).
  const [picked, setPicked] = useState<{
    assetId: string | undefined;
    tab: PanelTab;
  } | null>(null);
  const pickedTab = picked && picked.assetId === assetId ? picked.tab : null;
  const setPickedTab = (next: PanelTab): void => setPicked({ assetId, tab: next });
  const tabRefs = useRef<Partial<Record<PanelTab, HTMLButtonElement | null>>>({});

  const back = (): void => {
    navigate("/library");
  };

  // The loader only before the recording is known: a re-list (a copy landing, the cloud
  // catalog refreshing) keeps the page, the player and its position on screen.
  if ((isLoading && !video) || recovering) {
    return <div className={styles.centered}>{t("loading")}</div>;
  }

  if (!video || !assetId) {
    return (
      <div {...uiArea("libraryDetail.missing")} className={styles.centered}>
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
  const exports = lineage.exportsOf.get(video.assetId) ?? [];
  const badge = editBadge(video, lineage);
  // NIW2-585: the recording is the master. Its first copy is what moves the panel from
  // "Where is it going?" to "Versions".
  const master = isMaster(video);
  const running = runningCopyOf(runner, video.assetId);
  const hasCopies = exports.length > 0 || running !== null;
  const screenshotDimensions =
    shotSize && shotSize.assetId === video.assetId
      ? { width: shotSize.width, height: shotSize.height }
      : null;
  const dimensions = probe
    ? { width: probe.width, height: probe.height }
    : gifInfo
      ? { width: gifInfo.width, height: gifInfo.height }
      : screenshotDimensions;

  const tabs: PanelTab[] = preparable
    ? ["versions", "details", "destinations"]
    : ["versions", "details"];
  const defaultTab: PanelTab =
    master && preparable !== null && !hasCopies ? "destinations" : "versions";
  const tab: PanelTab = pickedTab && tabs.includes(pickedTab) ? pickedTab : defaultTab;
  const tabLabel: Record<PanelTab, string> = {
    versions: t("tabVersions"),
    details: t("tabDetails"),
    destinations: t("destinationsTitle"),
  };
  const onTabKey = (event: React.KeyboardEvent, current: PanelTab): void => {
    const at = tabs.indexOf(current);
    let next: PanelTab | undefined;
    if (event.key === "ArrowRight") next = tabs[(at + 1) % tabs.length];
    else if (event.key === "ArrowLeft") next = tabs[(at - 1 + tabs.length) % tabs.length];
    else if (event.key === "Home") next = tabs[0];
    else if (event.key === "End") next = tabs[tabs.length - 1];
    if (!next) return;
    event.preventDefault();
    setPickedTab(next);
    tabRefs.current[next]?.focus();
  };

  const goTo = (index: number): void => {
    const target = order[index];
    if (target) navigate(`/library/${target}`, { state: { order } });
  };

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
  // Resolves true when the image reached the clipboard (the preview's copy button marks it).
  const copyScreenshot = async (): Promise<boolean> => {
    if (!localId) return false;
    try {
      await window.electronAPI.copyScreenshotById(localId);
      showToast({ message: t("copyImageDone") });
      return true;
    } catch (error) {
      reportError(t("copyError"), error, {
        context: { id: localId, phase: "copy-by-id" },
        retry: () => void copyScreenshot(),
      });
      return false;
    }
  };

  // Hand the file to the OS default app (a video player, Preview…).
  const openFile = async (): Promise<void> => {
    if (!localId) return;
    try {
      await window.electronAPI.openLocalRecording(localId);
    } catch (error) {
      reportError(t("openError"), error, {
        context: { id: localId, phase: "open-default-app" },
        retry: () => void openFile(),
      });
    }
  };

  const copyPath = async (): Promise<void> => {
    if (!localId) return;
    try {
      const value = await window.electronAPI.localRecordingPath(localId);
      if (!value) throw new Error("The file has no path");
      await navigator.clipboard.writeText(value);
      showToast({ message: t("copyPathDone") });
    } catch (error) {
      reportError(t("copyPathError"), error, {
        context: { id: localId, phase: "copy-path" },
        retry: () => void copyPath(),
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

  const revealLabel = t(isWindowsHost() ? "revealInExplorer" : "revealInFinder");
  const fileName = path ? (path.split(/[\\/]/).pop() ?? null) : null;
  const cloudDiffers =
    video.cloudSizeBytes !== null && video.cloudSizeBytes !== video.fileSizeBytes;
  const KindIcon = isScreenshot ? ImageIcon : isGif ? Film : VideoIcon;
  const kindLabel = isScreenshot ? t("kindPng") : isGif ? t("kindGif") : t("kindVideo");

  const heavyNote = heavy ? (
    <HeavyToSendText sizeBytes={video.fileSizeBytes} lightEstimateBytes={lightEstimate(probe)} />
  ) : undefined;

  return (
    <div {...uiArea("libraryDetail.page")} className={styles.page}>
      <div {...uiArea("libraryDetail.header")} className={styles.header}>
        {/* Row 1: the way back, and the walk through the Library as it is shown. */}
        <div className={styles.navRow}>
          <button type="button" className={styles.back} onClick={back}>
            <ArrowLeft size={16} strokeWidth={1.8} />
            {t("title")}
          </button>
          {position >= 0 && (
            <div className={styles.pager}>
              <span className={styles.counter} data-testid="position-counter">
                {t("positionOf", {
                  position: position + 1,
                  total: order.length,
                })}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t("previousItem")}
                title={t("previousItem")}
                disabled={position <= 0}
                onClick={() => goTo(position - 1)}
              >
                <ChevronLeft size={16} strokeWidth={1.8} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t("nextItem")}
                title={t("nextItem")}
                disabled={position >= order.length - 1}
                onClick={() => goTo(position + 1)}
              >
                <ChevronRight size={16} strokeWidth={1.8} />
              </button>
            </div>
          )}
        </div>

        {/* Row 2: the title takes what the actions leave and ellipsizes at that edge; the
            actions never wrap. */}
        <div className={styles.titleRow}>
          <div className={styles.title}>
            <RecordingTitle
              title={video.title}
              onRename={(title) => {
                if (localId) void rename(localId, video.assetId, title);
              }}
            />
          </div>
          {master && (
            <span
              className={styles.infoWrap}
              onMouseEnter={() => setInfoOpen(true)}
              onMouseLeave={() => setInfoOpen(false)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && infoOpen) {
                  event.stopPropagation();
                  setInfoOpen(false);
                }
              }}
            >
              <button
                type="button"
                className={styles.infoButton}
                aria-label={t("originalInfo")}
                aria-describedby="library-original-info"
                onClick={() => setInfoOpen(true)}
                onFocus={() => setInfoOpen(true)}
                onBlur={() => setInfoOpen(false)}
              >
                <Info size={14} strokeWidth={1.8} />
              </button>
              <span
                id="library-original-info"
                role="tooltip"
                className={styles.infoTip}
                hidden={!infoOpen}
              >
                {t("originalInfo")}
              </span>
            </span>
          )}
          <div {...uiArea("libraryDetail.actions")} className={styles.actions}>
            {localId && isScreenshot && (
              <Button variant="primary" size="sm" onClick={editScreenshot}>
                <Pencil size={15} strokeWidth={1.8} />
                {t("editImage")}
              </Button>
            )}
            {localId && !isScreenshot && !isGif && (
              <Button
                variant="primary"
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
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={revealLabel}
                  title={revealLabel}
                  onClick={() => reveal(localId)}
                >
                  <FolderOpen size={15} strokeWidth={1.8} />
                  <span className={styles.btnLabel}>{revealLabel}</span>
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={t("openFile")}
                  title={t("openFileHint")}
                  onClick={() => void openFile()}
                >
                  <SquareArrowOutUpRight size={15} strokeWidth={1.8} />
                  <span className={styles.btnLabel}>{t("openFile")}</span>
                </Button>
                <ItemActionsMenu
                  key={video.assetId}
                  assetId={video.assetId}
                  canRemoveLocalCopy={canRemoveLocalCopy}
                  movable={notMovableReason(video) === null}
                  onCopyPath={() => void copyPath()}
                  onRemoveLocalCopy={() => void doRemoveLocalCopy()}
                  onDelete={() => setConfirmingDelete(true)}
                />
              </>
            )}
          </div>
        </div>

        <div {...uiArea("libraryDetail.details")} className={styles.details}>
          {/* One metadata line, then the edit badge and the tags on the same row. */}
          <div className={styles.meta}>
            <span className={styles.metaItem}>
              <KindIcon size={13} strokeWidth={1.8} aria-hidden />
              {kindLabel}
            </span>
            {!isScreenshot && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem}>{formatDuration(video.durationSeconds)}</span>
              </>
            )}
            {dimensions && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem} data-testid="dimensions-meta">
                  {t("metaDimensions", dimensions)}
                </span>
              </>
            )}
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem} data-heavy={heavy}>
              {formatSize(video.fileSizeBytes)}
            </span>
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem}>{absoluteDate(video.createdAt, locale)}</span>
            {(video.availability === "cloud" || cloudDiffers) && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem}>
                  {t("availabilityCloud")}
                  {cloudDiffers && ` ${formatSize(video.cloudSizeBytes ?? 0)}`}
                </span>
              </>
            )}
          </div>
          {video.metadataIssue && <p className={styles.note}>{t("metadataUnreadable")}</p>}
          {video.comparison === "local-changes" && (
            <p className={styles.note}>{t("comparisonLocalChanges")}</p>
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
          {badge === "edited" && <p className={styles.note}>{t("edited")}</p>}
          {!isScreenshot && !isGif && badge === null && EDITING_LABEL_KEYS[video.editing] && (
            <p className={styles.editingLine}>{t(EDITING_LABEL_KEYS[video.editing]!)}</p>
          )}
          {/* Tags, on the same row as the metadata. */}
          {localId && (
            <div className={styles.tags}>
              <TagEditor
                assigned={resolveTags(video.tagIds, tagApi.byId)}
                all={tagApi.tags}
                onAssign={(next) => setTags(localId, next)}
                onCreate={tagApi.create}
              />
            </div>
          )}
        </div>
      </div>

      {showInAppCard && (
        <StatusCardPortal>
          <PostRecordingCard
            ui={uiArea("libraryDetail.postRecordingCard")}
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

      <div className={styles.body}>
        <div className={styles.media}>
          {master && showSavedNotice && (
            <div
              {...uiArea("libraryDetail.savedNotice")}
              className={styles.savedNotice}
              role="status"
            >
              <span className={styles.savedIcon} aria-hidden>
                <Check size={11} strokeWidth={3} />
              </span>
              <p className={styles.savedText}>
                <strong>{t("savedNoticeTitle")}</strong> {t("savedNoticeBody")}
              </p>
              <button
                type="button"
                className={styles.savedDismiss}
                aria-label={t("savedNoticeDismiss")}
                title={t("savedNoticeDismiss")}
                onClick={() => setNoticeDismissedFor(location.key)}
              >
                <X size={13} strokeWidth={2} />
              </button>
            </div>
          )}

          <div className={styles.stage}>
            {isScreenshot ? (
              <ScreenshotViewer
                key={video.assetId}
                src={video.thumbnailUrl}
                onCopy={localId ? copyScreenshot : undefined}
                onNaturalSize={(width, height) =>
                  setShotSize({ assetId: video.assetId, width, height })
                }
              />
            ) : isGif ? (
              localId && <GifViewer key={video.assetId} id={localId} />
            ) : (
              localId && (
                <div {...uiArea("libraryDetail.preview")} className={styles.player}>
                  <RecordingPlayer
                    key={video.assetId}
                    id={localId}
                    poster={video.thumbnailUrl}
                    webcam={video.webcam}
                    durationSeconds={video.durationSeconds}
                  />
                  {/* Under the video, not at the column's foot: the pair is centered together. */}
                  {fileName && (
                    <p className={styles.fileName} title={path ?? undefined}>
                      {fileName}
                    </p>
                  )}
                </div>
              )
            )}
          </div>
          {fileName && (isScreenshot || isGif) && (
            <p className={styles.fileName} title={path ?? undefined}>
              {fileName}
            </p>
          )}

          {heavy && tab !== "destinations" && (
            <HeavyToSendBanner
              sizeBytes={video.fileSizeBytes}
              lightEstimateBytes={lightEstimate(probe)}
              onMakeLightCopy={() => openPrepare("github")}
            />
          )}
        </div>

        <aside {...uiArea("libraryDetail.tabs")} className={styles.panel}>
          <div className={styles.tabList} role="tablist" aria-label={t("panelTabs")}>
            {tabs.map((id) => (
              <button
                key={id}
                ref={(node) => {
                  tabRefs.current[id] = node;
                }}
                type="button"
                role="tab"
                id={`library-tab-${id}`}
                aria-selected={tab === id}
                aria-controls={tab === id ? `library-tabpanel-${id}` : undefined}
                tabIndex={tab === id ? 0 : -1}
                className={styles.tabButton}
                data-active={tab === id || undefined}
                onClick={() => setPickedTab(id)}
                onKeyDown={(event) => onTabKey(event, id)}
              >
                {tabLabel[id]}
              </button>
            ))}
          </div>
          <div
            className={styles.tabPanel}
            role="tabpanel"
            id={`library-tabpanel-${tab}`}
            aria-labelledby={`library-tab-${tab}`}
          >
            {tab === "destinations" && preparable ? (
              <DestinationsList
                sizeBytes={video.fileSizeBytes}
                probe={probe}
                onPick={(destination) => openPrepare(destination)}
                onOpenExport={() => openPrepare()}
                note={heavyNote}
              />
            ) : tab === "details" ? (
              <ItemDetails
                video={video}
                probe={probe}
                dimensions={screenshotDimensions}
                capture={video.capture}
                path={path}
              />
            ) : (
              <VersionsList
                item={video}
                lineage={lineage}
                running={running}
                probe={probe}
                order={order}
                canExport={preparable !== null}
              />
            )}
          </div>
        </aside>
      </div>

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
 * promised only when the Light copy fits. While "Where is it going?" shows, the words live in
 * that panel instead; this banner is for every other page (a copy, a master with copies).
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
            : t("heavyBannerBodyNoGithub", {
                estimate: formatMB(lightEstimateBytes),
              })}
      </span>
    </p>
  );
}
