import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, FolderOpen, Trash2, Pencil, Check, X, VideoOff } from "lucide-react";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { StorageMeta } from "@renderer/features/library/components/storage-meta";
import { DeleteConfirmDialog } from "@renderer/features/library/components/delete-confirm-dialog";
import { formatDuration, formatSize, relativeDate } from "@renderer/features/library/format";
import { Button } from "@renderer/ui/button";
import styles from "./library-detail-page.module.css";

/** Playable URL for a vault recording, served by the main-process media protocol. */
const mediaUrl = (id: string): string => `kaipu-media://recording/${encodeURIComponent(id)}`;

export function LibraryDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { videos, isLoading, rename, remove, reveal } = useLocalLibrary();

  const video = videos.find((v) => v.id === id);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [playable, setPlayable] = useState(true);

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

  const startEdit = (): void => {
    setDraft(video.title);
    setEditing(true);
  };

  const commitEdit = (): void => {
    const next = draft.trim();
    if (next && next !== video.title) void rename(id, next);
    setEditing(false);
  };

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

      <div className={styles.player}>
        {playable ? (
          <video
            className={styles.video}
            src={mediaUrl(id)}
            poster={video.thumbnailUrl ?? undefined}
            controls
            autoPlay
            onError={() => setPlayable(false)}
          />
        ) : (
          <div className={styles.unavailable}>
            <VideoOff size={32} strokeWidth={1.5} />
            <span>Video unavailable</span>
          </div>
        )}
      </div>

      <div className={styles.bar}>
        <div className={styles.titleBlock}>
          {editing ? (
            <div className={styles.titleEdit}>
              <input
                className={styles.titleInput}
                value={draft}
                autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <button type="button" className={styles.iconButton} onClick={commitEdit} title="Save">
                <Check size={16} strokeWidth={2} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                onClick={() => setEditing(false)}
                title="Cancel"
              >
                <X size={16} strokeWidth={2} />
              </button>
            </div>
          ) : (
            <div className={styles.titleRow}>
              <h1 className={styles.title}>{video.title || "Untitled recording"}</h1>
              <button
                type="button"
                className={styles.iconButton}
                onClick={startEdit}
                title="Rename"
              >
                <Pencil size={15} strokeWidth={1.8} />
              </button>
            </div>
          )}
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
