import React from "react";
import { uiArea } from "@renderer/lib/ui-area";
import { mediaUrl } from "@renderer/lib/media-url";
import { TranscribeButton } from "./transcribe-button";
import { useTranscript } from "./use-transcript";

export interface EditorTranscribeButtonProps {
  /** The recording's local id (its filename id). */
  videoId: string;
  assetId: string;
  durationSeconds: number;
  /**
   * Epoch ms of the transcript file when the host knows one exists (the Library item's
   * `transcribedAt`); `null` when it does not. A job finished in this session shows as done
   * either way.
   */
  transcribedAt?: number | null;
  /** `false` when the file has no audio track: nothing renders. */
  hasAudio?: boolean;
}

/**
 * The Transcribe action for the video editor's top bar: one self-contained mount point, so the
 * editor page adds a single element and none of the transcription logic.
 */
export function EditorTranscribeButton({
  videoId,
  assetId,
  durationSeconds,
  transcribedAt: hostTranscribedAt = null,
  hasAudio,
}: EditorTranscribeButtonProps): React.JSX.Element | null {
  // The editor has no Library item at hand, so it asks the vault whether a transcript file is
  // there: without this a video transcribed in an earlier session would offer Transcribe again.
  const { state } = useTranscript(hasAudio === false ? null : videoId);
  // While the read is out the button cannot tell Transcribe from Transcribed, and a click on the
  // wrong one would start a job that overwrites the transcript.
  if (hasAudio === false || state === "loading") return null;
  const hasTranscript = state === "ready" || state === "invalid";
  return (
    <TranscribeButton
      variant="editor"
      ui={uiArea("editorVideo.transcribe")}
      item={{
        id: videoId,
        assetId,
        mediaUrl: mediaUrl("recording", videoId),
        durationMs: Math.round(durationSeconds * 1000),
        transcribedAt: hostTranscribedAt,
        hasTranscript,
      }}
    />
  );
}
