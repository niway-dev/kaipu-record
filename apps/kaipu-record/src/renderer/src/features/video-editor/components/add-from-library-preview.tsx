import { Film, Pause, Play, VideoOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { formatDuration } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { mediaUrl } from "@renderer/lib/media-url";
import styles from "./add-from-library-modal.module.css";

/** One step of the scrub bar, in seconds. */
const SCRUB_STEP = 0.05;

/**
 * A quick look at the selected Library recording (NIW2-790): one muted `<video>` that plays
 * from the start as soon as the recording is selected, with a play/pause button and a scrub bar.
 *
 * There is only ever one element: choosing another recording swaps its `src` (the old file's
 * decoder is released when the source changes), and unmounting (the modal closing, the search
 * emptying the list, a switch of tab) pauses it and clears `src`, so no decoder outlives the
 * preview. The file is served through `mediaUrl("recording", id)`, like the Library's own player.
 */
export function AddFromLibraryPreview({ video }: { video: LibraryVideo }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const ref = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [failed, setFailed] = useState(false);
  const id = video.id;

  // Point the element at the selected recording and start it; a cleanup (another selection, or
  // unmount) stops it and drops the source.
  useEffect(() => {
    const el = ref.current;
    if (!el || id === null) return;
    setFailed(false);
    setTime(0);
    el.src = mediaUrl("recording", id);
    const started: unknown = el.play();
    // Autoplay can be refused or interrupted by the next selection: a quick look, not an error.
    if (started instanceof Promise) started.catch(() => {});
    return () => {
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [id]);

  const toggle = (): void => {
    const el = ref.current;
    if (!el) return;
    if (el.paused) {
      const started: unknown = el.play();
      if (started instanceof Promise) started.catch(() => {});
    } else el.pause();
  };

  return (
    <div className={styles.preview}>
      <div className={styles.previewFrame}>
        {/* Always mounted, hidden when the file cannot play: the next selection needs this same
            element to point at its own file. */}
        <video
          ref={ref}
          className={`${styles.previewVideo} ${failed ? styles.previewHidden : ""}`}
          data-testid="add-from-library-video"
          poster={video.thumbnailUrl ?? undefined}
          muted
          playsInline
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
          onTimeUpdate={(event) => setTime(event.currentTarget.currentTime)}
          onError={() => setFailed(true)}
        />
        {failed && (
          <div className={styles.previewUnavailable} data-testid="add-from-library-unavailable">
            <VideoOff size={28} strokeWidth={1.5} aria-hidden />
            <span>{t("addFromLibraryPreviewUnavailable")}</span>
          </div>
        )}
        {!video.thumbnailUrl && !playing && !failed && (
          <span className={styles.previewPlaceholder} aria-hidden>
            <Film size={28} />
          </span>
        )}
        <span className={styles.previewBadge}>{formatDuration(video.durationSeconds)}</span>
      </div>
      <div className={styles.transport}>
        <button
          type="button"
          className={styles.playButton}
          aria-label={playing ? t("addFromLibraryPause") : t("addFromLibraryPlay")}
          title={playing ? t("addFromLibraryPause") : t("addFromLibraryPlay")}
          disabled={failed}
          onClick={toggle}
        >
          {playing ? <Pause size={13} aria-hidden /> : <Play size={13} aria-hidden />}
        </button>
        <input
          type="range"
          className={styles.scrub}
          aria-label={t("addFromLibrarySeek")}
          min={0}
          max={Math.max(video.durationSeconds, SCRUB_STEP)}
          step={SCRUB_STEP}
          value={Math.min(time, video.durationSeconds)}
          disabled={failed}
          onChange={(event) => {
            const next = Number(event.target.value);
            setTime(next);
            if (ref.current) ref.current.currentTime = next;
          }}
        />
      </div>
    </div>
  );
}
