import { useMemo } from "react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { PlayerHandle } from "@renderer/features/library/components/recording-player";
import { mediaUrl } from "@renderer/lib/media-url";
import { uiArea } from "@renderer/lib/ui-area";
import type { LayoutEntry } from "@renderer/features/video-editor/timeline";
import { TranscriptPanel } from "@renderer/features/video-editor/transcript-panel";
import styles from "@renderer/features/video-editor/transcript-panel.module.css";

interface LibraryTranscriptTabProps {
  /** A local recording: the page only mounts the tab for one (`canTranscribeVideo`). */
  video: LibraryVideo & { id: string };
  /** `false`: the recording has no audio track. `null`: the file has not been read yet. */
  hasAudio: boolean | null;
  /** The detail page's player, or `null` while it is not on screen (it left, or could not play). */
  player: PlayerHandle | null;
  /** The file's probed duration, `null` until read: it leads over the stored (floored) one. */
  probedDurationSeconds: number | null;
}

const NO_MUTES: never[] = [];
const NO_TIME = (): number => 0;
const NO_UNSUBSCRIBE = (): void => {};

/**
 * The Transcript tab of the Library detail page (NIW2-870): the editor's TranscriptPanel beside
 * the page's own video. The page plays the untouched recording, so the panel gets one clip from 0
 * to the duration on both axes, nothing muted: timeline time is the player's `currentTime` and the
 * projection (ADR 0063) returns every word where it was spoken.
 */
export function LibraryTranscriptTab({
  video,
  hasAudio,
  player,
  probedDurationSeconds,
}: LibraryTranscriptTabProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  // The probed duration is the file's own, so it leads. The stored one is floored on import (30
  // for a 30.6 s file, dropping the last words) and can be 0 when the vault could not read the
  // metadata (a zero-length clip would say "everything is cut"); it only fills in until the
  // probe lands, or when the probe fails.
  const probed = probedDurationSeconds ?? 0;
  const durationSeconds = probed > 0 ? probed : video.durationSeconds;
  const layout = useMemo<LayoutEntry[]>(
    () => [
      {
        itemId: video.id,
        kind: "clip",
        timelineStart: 0,
        timelineEnd: durationSeconds,
        sourceStart: 0,
        sourceEnd: durationSeconds,
      },
    ],
    [video.id, durationSeconds],
  );
  // New functions only when the player changes: the panel re-subscribes to its clock then, and
  // at no other moment.
  const clock = useMemo(
    () => ({
      seek: (seconds: number): void => player?.seek(seconds),
      readTime: (): number => player?.readTime() ?? NO_TIME(),
      subscribeTime: (listener: (seconds: number) => void): (() => void) =>
        player ? player.subscribeTime(listener) : NO_UNSUBSCRIBE,
    }),
    [player],
  );
  // No positive duration yet (the file is still being read): the loading look, never a layout
  // that would cut every word.
  if (durationSeconds <= 0) return <p className={styles.note}>{t("transcriptLoading")}</p>;
  return (
    <TranscriptPanel
      // Another item starts from its own state at once, never the previous video's words.
      key={video.id}
      embedded
      area={uiArea("libraryDetail.transcriptPanel")}
      itemId={video.id}
      assetId={video.assetId}
      title={video.title}
      mediaUrl={mediaUrl("recording", video.id)}
      durationMs={Math.round(durationSeconds * 1000)}
      layout={layout}
      audioMuted={false}
      mutedRanges={NO_MUTES}
      hasAudio={hasAudio}
      onSeek={clock.seek}
      subscribeTime={clock.subscribeTime}
      readTime={clock.readTime}
    />
  );
}
