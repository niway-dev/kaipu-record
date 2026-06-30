import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Check, Copy, FileX2, FolderOpen, Pencil, Trash2 } from "lucide-react";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { StorageMeta } from "@renderer/features/library/components/storage-meta";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { RecordingPlayer } from "@renderer/features/library/components/recording-player";
import { ScreenshotViewer } from "@renderer/features/library/components/screenshot-viewer";
import { RecordingTitle } from "@renderer/features/library/components/recording-title";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format";
import { Button } from "@renderer/ui/button";
import styles from "./library-detail-page.module.css";

export function LibraryDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { videos, isLoading, rename, remove, reveal } = useLocalLibrary();

  const video = videos.find((v) => v.id === id);

  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const back = (): void => {
    navigate("/library");
  };

  if (isLoading) {
    return <div className={styles.centered}>Loading…</div>;
  }

  if (!video || !id) {
    return (
      <div className={styles.centered}>
        <FileX2 size={40} strokeWidth={1.5} className={styles.missingIcon} />
        <h2 className={styles.missingTitle}>File not found</h2>
        <Button variant="ghost" onClick={back}>
          Back to Library
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
    await window.electronAPI.copyScreenshotById(video.id);
    setCopied(true);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopied(false), 2200);
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

  return (
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={back}>
        <ArrowLeft size={16} strokeWidth={1.8} />
        Library
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
                Edit
              </Button>
              <Button variant="outline" size="sm" onClick={copyScreenshot}>
                {copied ? (
                  <Check size={15} strokeWidth={1.8} />
                ) : (
                  <Copy size={15} strokeWidth={1.8} />
                )}
                {copied ? "Copied" : "Copy"}
              </Button>
            </>
          )}
          <Button variant="outline" size="sm" onClick={() => reveal(id)}>
            <FolderOpen size={15} strokeWidth={1.8} />
            Reveal
          </Button>
          <Button variant="outline" size="sm" onClick={() => setConfirmingDelete(true)}>
            <Trash2 size={15} strokeWidth={1.8} />
            Delete
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
