import { useMemo } from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { PlayerHandle } from "@renderer/features/library/components/recording-player";
import { mediaUrl } from "@renderer/lib/media-url";
import { uiArea } from "@renderer/lib/ui-area";
import type { LayoutEntry } from "@renderer/features/video-editor/timeline";
import { TranscriptPanel } from "@renderer/features/video-editor/transcript-panel";

interface LibraryTranscriptTabProps {
  /** A local recording: the page only mounts the tab for one (`canTranscribeVideo`). */
  video: LibraryVideo & { id: string };
  /** `false`: the recording has no audio track. `null`: the file has not been read yet. */
  hasAudio: boolean | null;
  /** The detail page's player, or `null` while it is not on screen (it left, or could not play). */
  player: PlayerHandle | null;
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
}: LibraryTranscriptTabProps): React.JSX.Element {
  const layout = useMemo<LayoutEntry[]>(
    () => [
      {
        itemId: video.id,
        kind: "clip",
        timelineStart: 0,
        timelineEnd: video.durationSeconds,
        sourceStart: 0,
        sourceEnd: video.durationSeconds,
      },
    ],
    [video.id, video.durationSeconds],
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
      durationMs={Math.round(video.durationSeconds * 1000)}
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
