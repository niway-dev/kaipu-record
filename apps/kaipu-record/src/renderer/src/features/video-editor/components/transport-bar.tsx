import { useCallback, useEffect, useRef, useState } from "react";
import {
  Layers,
  Maximize2,
  Minimize2,
  Minus,
  Pause,
  Play,
  Plus,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { formatSpeed, nextSpeed } from "../playback-speed";
import { skipTarget, type LayoutEntry } from "../timeline";
import { visibleCount, type TrackKey } from "../tracks";
import { useTimelineMaxZoom, useTimelineZoom, type TimelineViewStore } from "../use-timeline-view";
import { editShortcuts, SPLIT_SHORTCUT } from "./editor-toolbar";
import { formatZoom, sliderToZoom, zoomToSlider } from "./timeline-view";
import { TracksPopover } from "./tracks-popover";
import styles from "./transport-bar.module.css";

export interface TransportBarProps {
  /** The cut layout: Shift + rewind/forward jump between its entries. */
  layout: LayoutEntry[];
  playing: boolean;
  muted: boolean;
  /** Preview playback rate (0.5, 1, 1.5, 2): view state, never saved or exported. */
  speed: number;
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
  /** The next rate in the cycle 1× → 1.5× → 2× → 0.5× → 1×; the page applies it. */
  onSpeedChange(speed: number): void;
  onSeek(t: number): void;
  /** Split the clip under the playhead. Disabled when the playhead isn't inside a clip. */
  onSplit(): void;
  splitDisabled: boolean;
  /** Delete the selected segment. Disabled when nothing is selected. */
  onDeleteSelected(): void;
  deleteDisabled: boolean;
  onToggleFullscreen(): void;
  /** The timeline's zoom and scroll (NIW2-667). The strip reads the same store, so the
   *  buttons, the slider and the wheel on the lanes all move one view. */
  timelineView: TimelineViewStore;
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

/** The arrow keys on the zoom slider: right and up zoom in, left and down zoom out. */
function zoomKeyDirection(key: string): 1 | -1 | 0 {
  switch (key) {
    case "ArrowRight":
    case "ArrowUp":
      return 1;
    case "ArrowLeft":
    case "ArrowDown":
      return -1;
    default:
      return 0;
  }
}

/**
 * `−`, slider, FIT, `+` (NIW2-667). It subscribes to the zoom factor and the deepest zoom
 * only: a scroll, which fires every frame, never re-renders the bar. The slider is
 * logarithmic, so each step feels the same size whether the recording is 10 s or 10 min.
 */
function TimelineZoomControl({ store }: { store: TimelineViewStore }): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const zoom = useTimelineZoom(store);
  const max = useTimelineMaxZoom(store);
  const canZoom = max > 1;
  return (
    <div className={styles.zoomGroup}>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t("timelineZoomOut")}
        title={t("timelineZoomOut")}
        disabled={zoom <= 1}
        onClick={() => store.zoomStep(-1)}
      >
        <Minus size={15} />
      </button>
      <input
        type="range"
        className={styles.zoomSlider}
        min={0}
        max={1}
        step={0.001}
        value={zoomToSlider(zoom, max)}
        disabled={!canZoom}
        aria-label={t("timelineZoomSlider")}
        aria-valuetext={t("timelineZoomValue", { zoom: formatZoom(zoom, locale) })}
        onChange={(event) => store.zoomTo(sliderToZoom(Number(event.target.value), max))}
        // The native keyboard step is one thousandth of the range, and the range is
        // logarithmic: a press would zoom by 0.3 % and the readout would not change for dozens
        // of presses. The arrows step like the + and − buttons; Home, End and Page keys stay
        // native. ⌘, Ctrl and Alt are left to the browser and the OS.
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          const direction = zoomKeyDirection(event.key);
          if (direction === 0) return;
          event.preventDefault();
          store.zoomStep(direction);
        }}
      />
      <button
        type="button"
        className={styles.fitButton}
        aria-label={t("timelineZoomFitTitle")}
        title={t("timelineZoomFitTitle")}
        disabled={zoom <= 1}
        onClick={() => store.fit()}
      >
        {t("timelineZoomFit")}
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label={t("timelineZoomIn")}
        title={t("timelineZoomIn")}
        disabled={!canZoom || zoom >= max - 1e-6}
        onClick={() => store.zoomStep(1)}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

/**
 * Everything that acts on the timeline, in one row under the video (NIW2-664):
 * left, the Tracks trigger (it opens the lane popover) and the counts; centre, rewind / play / forward and the
 * time; right, split, delete, mute, playback speed, the timeline zoom (NIW2-667) and fullscreen. The page keeps the handlers (and the
 * keyboard shortcuts that share them); this component only owns where the buttons sit.
 */
export function TransportBar({
  layout,
  playing,
  muted,
  speed,
  timelineTime,
  duration,
  isFullscreen,
  zoomCount,
  privacyCount,
  tracks,
  onTogglePlay,
  onToggleMute,
  onSpeedChange,
  onSeek,
  onSplit,
  splitDisabled,
  onDeleteSelected,
  deleteDisabled,
  onToggleFullscreen,
  timelineView,
}: TransportBarProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const speedText = formatSpeed(speed, locale);
  const nextSpeedText = formatSpeed(nextSpeed(speed), locale);
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
        {/* The full "0:09.0 / 0:29.0", or just the current time once the bar is too narrow
            for the buttons AND the whole label (a container query in the CSS): the same
            full-and-short pair the counts use, the full text staying for screen readers. */}
        <span className={styles.timeDisplay}>
          <span className={styles.timeFull}>
            {formatTime(timelineTime)} / {formatTime(duration)}
          </span>
          <span className={styles.timeShort} aria-hidden="true">
            {formatTime(timelineTime)}
          </span>
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
          className={styles.speedButton}
          title={t("playbackSpeedTitle", { next: nextSpeedText })}
          aria-label={t("playbackSpeedLabel", { speed: speedText })}
          onClick={() => onSpeedChange(nextSpeed(speed))}
        >
          {speedText}×
        </button>
        <TimelineZoomControl store={timelineView} />
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
