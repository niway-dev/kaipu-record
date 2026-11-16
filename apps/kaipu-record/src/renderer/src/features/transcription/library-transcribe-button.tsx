import React from "react";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { UiAreaProps } from "@renderer/lib/ui-area";
import { mediaUrl } from "@renderer/lib/media-url";
import { TranscribeButton, type TranscribeButtonVariant } from "./transcribe-button";

export interface LibraryTranscribeButtonProps {
  video: LibraryVideo;
  variant: Extract<TranscribeButtonVariant, "card" | "row" | "detail">;
  /**
   * Whether the file has an audio track, when the host has read it (the detail page probes the
   * file). `false` hides the button; `undefined` means unknown, which the list cannot read per
   * item, so the button shows and a video without audio says so when its job fails.
   */
  hasAudio?: boolean;
  ui?: UiAreaProps;
}

/**
 * The Transcribe action of a Library item. Only a local recording has audio to transcribe: a
 * screenshot, a GIF export and a cloud-only item get nothing.
 */
export function LibraryTranscribeButton({
  video,
  variant,
  hasAudio,
  ui,
}: LibraryTranscribeButtonProps): React.JSX.Element | null {
  if (video.kind !== "recording" || video.id === null || hasAudio === false) return null;
  return (
    <TranscribeButton
      variant={variant}
      ui={ui}
      item={{
        id: video.id,
        assetId: video.assetId,
        mediaUrl: mediaUrl("recording", video.id),
        durationMs: Math.round(video.durationSeconds * 1000),
        transcribedAt: video.transcribedAt,
      }}
    />
  );
}
