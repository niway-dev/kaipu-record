import { useCallback, useEffect, useRef, useState } from "react";
import {
  Layers,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { skipTarget, type LayoutEntry } from "../timeline";
import { visibleCount, type TrackKey } from "../tracks";
import { editShortcuts, SPLIT_SHORTCUT } from "./editor-toolbar";
import { TracksPopover } from "./tracks-popover";
import styles from "./transport-bar.module.css";

export interface TransportBarProps {
  /** The cut layout: Shift + rewind/forward jump between its entries. */
  layout: LayoutEntry[];
  playing: boolean;
  muted: boolean;
  timelineTime: number;
  duration: number;
  isFullscreen: boolean;
  /** Zooms to count, or null when the recording has no zooms to speak of (no cursor
   *  track and none hand-made): the count is then not shown at all. */
  zoomCount: number | null;
  privacyCount: number;
  /** The Tracks popover (NIW2-665): the lanes this recording can show, the ones the user
   *  hid, and the toggle. View state only; nothing here reaches the preview or the export. */
  tracks: {
    available: readonly TrackKey[];
    hidden: readonly TrackKey[];
    onToggle(key: TrackKey): void;
  };
  onTogglePlay(): void;
  onToggleMute(): void;
  onSeek(t: number): void;
  /** Split the clip under the playhead. Disabled when the playhead isn't inside a clip. */
  onSplit(): void;
  splitDisabled: boolean;
  /** Delete the selected segment. Disabled when nothing is selected. */
  onDeleteSelected(): void;
  deleteDisabled: boolean;
  onToggleFullscreen(): void;
}

/** "0:09.0": minutes, seconds and tenths, so a 5 s skip or a split is visible. */
function formatTime(seconds: number): string {
  const tenths = Math.max(0, Math.floor(seconds * 10 + 1e-6));
  const m = Math.floor(tenths / 600);
  const s = Math.floor((tenths % 600) / 10);
  return `${m}:${String(s).padStart(2, "0")}.${tenths % 10}`;
}

/**
 * A count in the left cluster: the full sentence ("4 zooms detected"), or the short
 * form ("4 zooms") once the bar is too narrow for both sentences (a container query in
 * the CSS). The full text stays in the accessibility tree and in the tooltip either way.
 */
function Count({ full, short }: { full: string; short: string }): React.JSX.Element {
  return (
    <span className={styles.counts} title={full}>
      <span className={styles.countFull}>{full}</span>
      <span className={styles.countShort} aria-hidden="true">
        {short}
      </span>
    </span>
  );
}

/**
 * Everything that acts on the timeline, in one row under the video (NIW2-664):
 * left, the Tracks trigger (it opens the lane popover) and the counts; centre, rewind / play / forward and the
 * time; right, split, delete, mute and fullscreen. The page keeps the handlers (and the
 * keyboard shortcuts that share them); this component only owns where the buttons sit.
 */
export function TransportBar({
  layout,
  playing,
  muted,
  timelineTime,
  duration,
  isFullscreen,
  zoomCount,
  privacyCount,
  tracks,
  onTogglePlay,
  onToggleMute,
  onSeek,
  onSplit,
  splitDisabled,
  onDeleteSelected,
  deleteDisabled,
  onToggleFullscreen,
}: TransportBarProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const shortcuts = editShortcuts();
  const tracksButtonRef = useRef<HTMLButtonElement | null>(null);
  const [tracksOpen, setTracksOpen] = useState(false);
  const closeTracks = useCallback(() => setTracksOpen(false), []);
  // Only the stage goes fullscreen and the panel is portaled to <body>, so in fullscreen
  // it would be invisible while focus sat inside it. The trigger is disabled there (the
  // timeline footer is not drawn either), and a panel open when fullscreen starts closes.
  useEffect(() => {
    if (isFullscreen) setTracksOpen(false);
  }, [isFullscreen]);
  const { shown, total } = visibleCount(tracks.available, tracks.hidden);

  return (
    <div {...uiArea("editorVideo.transport")} className={styles.transport}>
      <div className={styles.side}>
        <button
          ref={tracksButtonRef}
          type="button"
          className={`${styles.tracksButton} ${tracksOpen ? styles.tracksButtonOpen : ""}`}
          aria-label={t("tracksLabel", { shown, total })}
          aria-haspopup="menu"
          aria-expanded={tracksOpen}
          disabled={isFullscreen}
          onClick={() => setTracksOpen((open) => !open)}
        >
          <Layers size={14} aria-hidden />
          {t("tracks")}{" "}
          <span className={styles.tracksCount}>
            {shown}/{total}
          </span>
        </button>
        {tracksOpen && tracksButtonRef.current && (
          <TracksPopover
            anchor={tracksButtonRef.current}
            available={tracks.available}
            hidden={tracks.hidden}
            onToggle={tracks.onToggle}
            onClose={closeTracks}
          />
        )}
        {/* Shown whenever there is something to count: a pre-v2 recording has no
            cursor track but can still carry hand-made zooms. */}
        {zoomCount !== null && (
          <Count
            full={t("zoomCount", { count: zoomCount })}
            short={t("zoomCountShort", { count: zoomCount })}
          />
        )}
        {privacyCount > 0 && (
          <Count
            full={t("privacyCount", { count: privacyCount })}
            short={t("privacyCountShort", { count: privacyCount })}
          />
        )}
      </div>
      <div className={styles.centre}>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.skipButton}`}
          title={t("rewindTitle")}
          aria-label={t("rewind")}
          onClick={(event) => onSeek(skipTarget(layout, timelineTime, -1, event.shiftKey))}
        >
          <SkipBack size={15} />
        </button>
        <button
          type="button"
          className={styles.playButton}
          aria-label={playing ? t("pause") : t("play")}
          onClick={onTogglePlay}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <button
          type="button"
          className={`${styles.iconButton} ${styles.skipButton}`}
          title={t("forwardTitle")}
          aria-label={t("forward")}
          onClick={(event) => onSeek(skipTarget(layout, timelineTime, 1, event.shiftKey))}
        >
          <SkipForward size={15} />
        </button>
        <span className={styles.timeDisplay}>
          {formatTime(timelineTime)} / {formatTime(duration)}
        </span>
      </div>
      <div className={`${styles.side} ${styles.right}`}>
        <button
          type="button"
          className={styles.iconButton}
          title={`${t("splitHere")} (${SPLIT_SHORTCUT})`}
          aria-label={t("splitHere")}
          disabled={splitDisabled}
          onClick={onSplit}
        >
          <Scissors size={15} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          title={`${t("deleteSegment")} (${shortcuts.remove})`}
          aria-label={t("deleteSegment")}
          disabled={deleteDisabled}
          onClick={onDeleteSelected}
        >
          <Trash2 size={15} />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={muted ? t("unmute") : t("mute")}
          onClick={onToggleMute}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label={isFullscreen ? t("exitFullscreen") : t("fullscreen")}
          onClick={onToggleFullscreen}
        >
          {isFullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
        </button>
      </div>
    </div>
  );
}
