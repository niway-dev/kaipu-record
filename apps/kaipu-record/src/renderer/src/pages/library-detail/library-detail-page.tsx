import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderOpen, Trash2, VideoOff } from "lucide-react";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { StorageMeta } from "@renderer/features/library/components/storage-meta";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { RecordingPlayer } from "@renderer/features/library/components/recording-player";
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

  const back = (): void => {
    navigate("/library");
  };

  if (isLoading) {
    return <div className={styles.centered}>Loading…</div>;
  }

  if (!video || !id) {
    return (
      <div className={styles.centered}>
        <VideoOff size={40} strokeWidth={1.5} className={styles.missingIcon} />
        <h2 className={styles.missingTitle}>Recording not found</h2>
        <Button variant="ghost" onClick={back}>
          Back to Library
        </Button>
      </div>
    );
  }

  const doDelete = (): void => {
    void remove(id);
    setConfirmingDelete(false);
    back();
  };

  return (
    <div className={styles.page}>
      <button type="button" className={styles.back} onClick={back}>
        <ArrowLeft size={16} strokeWidth={1.8} />
        Library
      </button>

      <RecordingPlayer id={id} poster={video.thumbnailUrl} />

      <div className={styles.bar}>
        <div className={styles.titleBlock}>
          <RecordingTitle title={video.title} onRename={(title) => void rename(id, title)} />
          <div className={styles.meta}>
            <StorageMeta video={video} />
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem}>{relativeDate(video.createdAt)}</span>
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem}>{formatDuration(video.durationSeconds)}</span>
            <span className={styles.dot}>·</span>
            <span className={styles.metaItem}>{formatSize(video.fileSizeBytes)}</span>
          </div>
        </div>

        <div className={styles.actions}>
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
