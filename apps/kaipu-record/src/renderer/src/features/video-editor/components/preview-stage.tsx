import { useTranslations } from "@kaipu/i18n";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { DEFAULT_BACKGROUND, type VideoBackground } from "../background";
import { MediaSwitch, type SwitchElement } from "../media-switch";
import type { SourceAxis } from "../source-axis";
import type { PreviewPlayback } from "../use-preview-playback";
import { previewBackgroundStyle } from "./preview-background";
import styles from "./preview-stage.module.css";

const NO_RECORDINGS: readonly StageRecording[] = [];

/** A joined recording the stage can show (ADR 0058): one `<video>` each, only the active visible. */
export interface StageRecording {
  /** The `SceneSource.id`. */
  sourceId: string;
  title: string;
  /** The playable file, or null while it loads or when it is missing (no element then). */
  mediaUrl: string | null;
  /** The asset is gone, cloud-only or refused: the picture says so while the playhead is on it. */
  missing: boolean;
}

export function PreviewStage({
  playback,
  mediaUrl,
  axis,
  recordings = NO_RECORDINGS,
  slideUrl,
  overlay,
  underlay,
  webcam,
  media,
  cursor,
  chrome,
  contentRef,
  expanded = false,
  onFrameSize,
  background = DEFAULT_BACKGROUND,
}: {
  playback: PreviewPlayback;
  /** The opened recording's file. */
  mediaUrl: string;
  /** The scene's source axis; the stage's switch maps an axis second to a recording with it.
   *  Absent = the opened recording alone. */
  axis?: SourceAxis;
  /** The joined recordings, in any order. Absent = none. */
  recordings?: readonly StageRecording[];
  /** Image of the slide under the playhead, or null when the playhead is on a clip.
   *  When set, it covers the video (which is paused underneath) so the slide reads as
   *  its own frame; the annotation layer still renders on top. */
  slideUrl?: string | null;
  /** The annotation layer — rendered as a sibling of <video> inside this component's
   *  position:relative wrapper, which (per preview-stage.module.css) shrinks to
   *  exactly the video's own rendered box, so the overlay covers it exactly. */
  overlay?: React.ReactNode;
  /** Privacy regions (video-editor v2): inside the content layer, UNDER the annotations,
   *  so they zoom with the footage — export order frame → redactions → overlays → crop. */
  underlay?: React.ReactNode;
  /** The webcam layer (ADR 0038): a third kind of layer, ABOVE the content and below the
   *  chrome, and like the chrome never transformed by the camera path — so with a zoom
   *  active the face stays in its corner instead of being cropped away with the frame. */
  webcam?: React.ReactNode;
  /** Floating images (ADR 0057): above the footage and the cursor, below the webcam, and like the
   *  webcam OUTSIDE the zoomed content layer, so a zoom neither moves nor crops them. */
  media?: React.ReactNode;
  cursor?: React.ReactNode;
  /** Stage-level UI that must NOT zoom: camera box, hold-to-compare button and chip. */
  chrome?: React.ReactNode;
  /** The content layer (video + slide + underlay + overlay); the camera transform is
   *  written to it per frame by useCameraPreview. */
  contentRef?: React.Ref<HTMLDivElement>;
  /** In fullscreen the bounded (contained-player) size caps are lifted so the video
   *  fills the screen. Off by default — normal editing keeps the compact player. */
  expanded?: boolean;
  /** Decoded frame size, reported once metadata lands. The <video> element's own
   *  `videoWidth`/`videoHeight` are not reactive — reading them off the ref during a
   *  render gives whatever happened to be true at that render and never schedules
   *  another — so anything that needs them as state has to receive them here. */
  onFrameSize?: (size: { width: number; height: number }) => void;
  /** The background around the picture (ADR 0051). With `none` the picture fills the frame
   *  and nothing here draws; with a preset the frame is painted with it and the picture is
   *  inset, rounded and shadowed by the very numbers the export's composer draws with. */
  background?: VideoBackground;
}): React.JSX.Element {
  // The frame is sized from the DECODED frame ratio, not shrink-wrapped around the <video>:
  // with a height cap binding, a shrink-to-fit wrapper keeps its max-content width and ends
  // up wider than the picture, which would misplace the camera box (all of whose geometry is
  // a % of the picture) and its scrim. 16:9 until metadata lands.
  const [ratio, setRatio] = useState(16 / 9);
  // The frame's displayed size, in px: the background's padding, radius and shadow are
  // expressed at a 1080 px-high output and scaled to it (`previewBackgroundStyle`), exactly as
  // the export scales them to its own output. Read before paint, so a restored background
  // never flashes full-bleed.
  const frameRef = useRef<HTMLDivElement>(null);
  const [frameSize, setFrameSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = frameRef.current;
    if (!el) return;
    const measure = (): void =>
      setFrameSize((previous) => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        return previous && previous.w === w && previous.h === h ? previous : { w, h };
      });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  // One `<video>` per recording behind ONE switch that speaks axis seconds (ADR 0058): the
  // playback hook, the frame clock and the layers keep reading `playback.videoRef` as if it were
  // a single element. The switch is published before paint and withdrawn on unmount.
  const [mediaSwitch] = useState(() => new MediaSwitch());
  useLayoutEffect(() => {
    const ref = playback.videoRef;
    ref.current = mediaSwitch;
    return () => {
      if (ref.current === mediaSwitch) ref.current = null;
    };
  }, [mediaSwitch, playback.videoRef]);
  useLayoutEffect(() => {
    if (axis) mediaSwitch.setAxis(axis);
  }, [mediaSwitch, axis]);
  const attachOpened = useCallback(
    (el: HTMLVideoElement | null) => mediaSwitch.attach(null, el as SwitchElement | null),
    [mediaSwitch],
  );
  const attachers = useRef(new Map<string, (el: HTMLVideoElement | null) => void>());
  const attachJoined = (sourceId: string): ((el: HTMLVideoElement | null) => void) => {
    let attach = attachers.current.get(sourceId);
    if (!attach) {
      attach = (el) => mediaSwitch.attach(sourceId, el as SwitchElement | null);
      attachers.current.set(sourceId, attach);
    }
    return attach;
  };
  // The recording on screen, for the "missing" notice: the switch is the one that knows.
  const [activeKey, setActiveKey] = useState<string | null>(null);
  useEffect(() => {
    setActiveKey(mediaSwitch.activeKey);
    return mediaSwitch.onActiveChange(() => setActiveKey(mediaSwitch.activeKey));
  }, [mediaSwitch]);
  const t = useTranslations("videoEditor");
  const missingNow = slideUrl
    ? undefined
    : recordings.find((r) => r.missing && r.sourceId === activeKey);
  // Only the recording on screen drives the transport: a paused or primed standby also emits
  // `pause`, `timeupdate` and `ended`, and none of those may reach the hook.
  const events = (): React.ComponentProps<"video"> => ({
    onTimeUpdate: (event) => {
      if (mediaSwitch.isActive(event.currentTarget)) playback.onVideoTimeUpdate();
    },
    onEnded: (event) => {
      if (mediaSwitch.isActive(event.currentTarget)) playback.onVideoEnded();
    },
    onPlay: (event) => {
      if (mediaSwitch.isActive(event.currentTarget)) playback.onVideoPlay();
    },
    onPause: (event) => {
      if (mediaSwitch.isActive(event.currentTarget)) playback.onVideoPause();
    },
  });
  const look = previewBackgroundStyle(background, frameSize?.w ?? 0, frameSize?.h ?? 0);
  return (
    <div className={styles.stage}>
      {/* The frame is the output: ratio-exact, and the preset's paint when one is set. The
          picture inside it is the whole frame with `none`, or inset by the padding. Every
          layer of the footage — video, slide, privacy regions, annotations, the cursor, the
          webcam and the stage chrome — is inside the picture, so a zoom is clipped by it and
          never reaches the padding, and the camera box and the webcam are laid out against the
          picture, not the frame. The ambient glow lives behind all of it, on the video region. */}
      <div
        ref={frameRef}
        data-testid="preview-frame"
        className={expanded ? `${styles.frame} ${styles.frameExpanded}` : styles.frame}
        style={{ "--frame-ratio": ratio, ...look.frame } as React.CSSProperties}
      >
        <div data-testid="preview-picture" className={styles.picture} style={look.picture}>
          <div ref={contentRef} data-testid="preview-content" className={styles.content}>
            <video
              ref={attachOpened}
              className={styles.video}
              src={mediaUrl}
              {...events()}
              onLoadedMetadata={(event) => {
                // A new `src` resets the element's rate: put the chosen speed back first,
                // whatever the decoded size says.
                playback.onVideoLoadedMetadata();
                // The frame, its ratio and the export size are the OPENED recording's.
                const { videoWidth, videoHeight } = event.currentTarget;
                if (videoWidth > 0 && videoHeight > 0) {
                  setRatio(videoWidth / videoHeight);
                  onFrameSize?.({ width: videoWidth, height: videoHeight });
                }
              }}
              // Keep `playing` in sync with what the element actually does — a rejected play()
              // (e.g. interrupted by a seek) leaves it paused, and these events stop the
              // transport from getting stuck showing "pause" while nothing plays.
              // No onClick: a click on the picture does not toggle playback. The play
              // button and Space do (NIW2-611).
            />
            {recordings.map((recording) =>
              recording.mediaUrl === null ? null : (
                <video
                  key={recording.sourceId}
                  ref={attachJoined(recording.sourceId)}
                  data-recording={recording.sourceId}
                  className={styles.video}
                  src={recording.mediaUrl}
                  {...events()}
                  // A joined recording keeps its own aspect, letterboxed inside the opened
                  // recording's frame: the frame's ratio and the export size stay the opened one's.
                  onLoadedMetadata={playback.onVideoLoadedMetadata}
                />
              ),
            )}
            {slideUrl && <img className={styles.slide} src={slideUrl} alt="" draggable={false} />}
            {underlay}
            {overlay}
          </div>
          {missingNow && (
            <div role="status" data-testid="preview-missing" className={styles.missing}>
              {t("recordingMissing", { title: missingNow.title })}
            </div>
          )}
          {cursor}
          {media}
          {webcam}
          {chrome}
        </div>
      </div>
    </div>
  );
}
