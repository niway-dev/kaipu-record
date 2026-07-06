import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, FileX2, FolderOpen, Pencil, Scissors, Trash2 } from "lucide-react";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { useTransientValue } from "@renderer/ui/use-transient-value";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { reportError } from "@renderer/features/analytics";
import { StorageMeta } from "@renderer/features/library/components/storage-meta";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { RecordingPlayer } from "@renderer/features/library/components/recording-player";
import { ScreenshotViewer } from "@renderer/features/library/components/screenshot-viewer";
import { RecordingTitle } from "@renderer/features/library/components/recording-title";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format";
import { Button } from "@renderer/ui/button";
import { useTranslations } from "@kaipu/i18n";
import styles from "./library-detail-page.module.css";

export function LibraryDetailPage(): React.JSX.Element {
  const t = useTranslations("library");
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { videos, isLoading, rename, remove, reveal } = useLocalLibrary();

  const video = videos.find((v) => v.id === id);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, showCopied] = useTransientValue<true>(2200);

  const back = (): void => {
    navigate("/library");
  };

  if (isLoading) {
    return <div className={styles.centered}>{t("loading")}</div>;
  }

  if (!video || !id) {
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

  const isScreenshot = video.kind === "screenshot";

  const doDelete = (): void => {
    void remove(id);
    setConfirmingDelete(false);
    back();
  };

  // Copy a saved screenshot to the clipboard — main reads the vault file by id
  // (fetch on the kaipu-media:// scheme doesn't return bytes in the renderer).
  const copyScreenshot = async (): Promise<void> => {
    try {
      await window.electronAPI.copyScreenshotById(video.id);
      showCopied(true);
    } catch (error) {
      reportError(t("copyError"), error, {
        context: { id: video.id, phase: "copy-by-id" },
        retry: () => void copyScreenshot(),
      });
    }
  };

  // Re-open a saved screenshot in the editor. It's a flat PNG, so the editor treats
  // it as a new base image (the local source starts with no beautify re-frame). Carry
  // the `?v=` token from the thumbnail URL so the editor loads the current bytes.
  const editScreenshot = (): void => {
    const v = video.thumbnailUrl ? Number(new URL(video.thumbnailUrl).searchParams.get("v")) : NaN;
    const source: ImageSource = {
      kind: "local",
      id: video.id,
      title: video.title,
      version: Number.isFinite(v) ? v : undefined,
    };
    navigate("/screenshot-editor", { state: source });
  };

  // The editor builds its initial scene from the recording's duration — an older
  // vault item without one (pre-duration-tracking capture) can't be opened.
  const canEditVideo = video.durationSeconds > 0;
  const editVideo = (): void => {
    if (!canEditVideo) return;
    navigate("/video-editor", {
      state: { id: video.id, title: video.title, durationSeconds: video.durationSeconds },
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
        <RecordingPlayer id={id} poster={video.thumbnailUrl} />
      )}

      <div className={styles.bar}>
        <div className={styles.titleBlock}>
          <RecordingTitle title={video.title} onRename={(title) => void rename(id, title)} />
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
          </div>
        </div>

        <div className={styles.actions}>
          {isScreenshot && (
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
          {!isScreenshot && (
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
          <Button variant="outline" size="sm" onClick={() => reveal(id)}>
            <FolderOpen size={15} strokeWidth={1.8} />
            {t("reveal")}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={15} strokeWidth={1.8} />
            {t("delete")}
          </Button>
        </div>
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
