import { useMemo, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, FileX2, FolderOpen, Pencil, Scissors, Trash2 } from "lucide-react";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { useTransientValue } from "@renderer/ui/use-transient-value";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { useMissingRecordingRecovery } from "@renderer/features/library/hooks/use-missing-recording-recovery";
import { reportError } from "@renderer/features/analytics";
import { showToast } from "@renderer/ui/toast-store";
import { StorageMeta } from "@renderer/features/library/components/storage-meta";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { RecordingPlayer } from "@renderer/features/library/components/recording-player";
import { ScreenshotViewer } from "@renderer/features/library/components/screenshot-viewer";
import { RecordingTitle } from "@renderer/features/library/components/recording-title";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format";
import { buildLineage, editBadge } from "@renderer/features/library/lineage";
import type { EditingState, RemoveLocalCopyResult } from "@shared/types/library-item";
import { Button } from "@renderer/ui/button";
import { Badge } from "@renderer/ui/badge";
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
  const { videos, isLoading, refresh, rename, remove, reveal, removeLocalCopy } = useLocalLibrary();

  const video = videos.find((v) => v.assetId === assetId);

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
  const lineage = useMemo(() => buildLineage(videos), [videos]);

  const back = (): void => {
    navigate("/library");
  };

  if (isLoading || recovering) {
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
  const source = video.derivedFromAssetId
    ? lineage.byAssetId.get(video.derivedFromAssetId)
    : undefined;
  const sourceDeleted = video.derivedFromAssetId !== null && source === undefined;
  const exports = lineage.exportsOf.get(video.assetId) ?? [];
  const badge = editBadge(video, lineage);

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

  // Re-open a saved screenshot in the editor. It's a flat PNG, so the editor treats
  // it as a new base image (the local source starts with no beautify re-frame). Carry
  // the `?v=` token from the thumbnail URL so the editor loads the current bytes.
  const editScreenshot = (): void => {
    if (!localId) return;
    const v = video.thumbnailUrl ? Number(new URL(video.thumbnailUrl).searchParams.get("v")) : NaN;
    const source: ImageSource = {
      kind: "local",
      id: localId,
      title: video.title,
      version: Number.isFinite(v) ? v : undefined,
    };
    navigate("/screenshot-editor", { state: source });
  };

  // The editor builds its initial scene from the recording's duration — an older
  // vault item without one (pre-duration-tracking capture) can't be opened.
  const canEditVideo = localId !== null && video.durationSeconds > 0;
  const editVideo = (): void => {
    if (!canEditVideo || !localId) return;
    navigate("/video-editor", {
      state: {
        id: localId,
        assetId: video.assetId,
        title: video.title,
        durationSeconds: video.durationSeconds,
      },
    });
  };

  return (
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={back}>
        <ArrowLeft size={16} strokeWidth={1.8} />
        {t("title")}
      </button>

      {isScreenshot ? (
        <ScreenshotViewer src={video.thumbnailUrl} />
      ) : (
        localId && <RecordingPlayer id={localId} poster={video.thumbnailUrl} />
      )}

      <div className={styles.bar}>
        <div className={styles.titleBlock}>
          <RecordingTitle
            title={video.title}
            onRename={(title) => {
              if (localId) void rename(localId, title);
            }}
          />
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
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem}>{formatSize(video.fileSizeBytes)}</span>
            {video.cloudSizeBytes !== null && video.cloudSizeBytes !== video.fileSizeBytes && (
              <>
                <span className={styles.dot}>·</span>
                <span className={styles.metaItem}>
                  {t("availabilityCloud")} {formatSize(video.cloudSizeBytes)}
                </span>
              </>
            )}
          </div>
          {!isScreenshot && badge === null && (
            <p className={styles.editingLine}>{t(EDITING_LABEL_KEYS[video.editing])}</p>
          )}
          {badge === "not-exported" && (
            <button
              type="button"
              className={styles.badgeButton}
              title={t("editedNotExportedHint")}
              onClick={editVideo}
              disabled={!canEditVideo}
            >
              <Badge variant="warning">{t("editedNotExported")}</Badge>
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
          {!isScreenshot && localId && (
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

      {exports.length > 0 && (
        <section className={styles.exports} aria-labelledby="exports-heading">
          <h2 id="exports-heading" className={styles.exportsHeading}>
            {t("exports")}
          </h2>
          <ul className={styles.exportsList}>
            {exports.map((e) => (
              <li key={e.assetId} className={styles.exportItem}>
                {e.thumbnailUrl ? (
                  <img src={e.thumbnailUrl} alt="" className={styles.exportThumb} />
                ) : (
                  <span className={styles.exportThumb} aria-hidden />
                )}
                <Link to={`/library/${e.assetId}`} className={styles.lineageLink}>
                  {e.title}
                </Link>
                <span className={styles.metaItem}>
                  {relativeDate(e.createdAt)} · {formatDuration(e.durationSeconds)}
                </span>
              </li>
            ))}
          </ul>
        </section>
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
