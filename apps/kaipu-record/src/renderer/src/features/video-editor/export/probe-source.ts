import { openRecordingInput } from "@renderer/lib/open-recording-input";
import { mediaUrl } from "@shared/media-url";

/**
 * Source facts the export presets need (NIW2-218): what the `<video>` element doesn't expose
 * in the editor, and everything Share needs where there is no `<video>` to ask.
 */
export interface SourceProbe {
  /** Display size of the video track (what `<video>.videoWidth/videoHeight` report); 0 if none. */
  width: number;
  height: number;
  /** Exact duration in seconds (the sidecar's `durationSeconds` is floored). */
  durationSec: number;
  /** Average frame rate over the first packets. */
  fps: number;
  /** Whether the recording has an audio track at all (mute is applied by the caller). */
  hasAudio: boolean;
  sampleRate: number;
}

/** Packets sampled for the frame-rate average: enough for a stable number, cheap to read. */
const SAMPLE_PACKETS = 120;

/**
 * Reads the recording's frame rate and audio layout through mediabunny over the Range-aware
 * `kaipu-media://` protocol, so only the container metadata and a few packets are fetched.
 * Never throws: the sheet falls back to conservative defaults (30 fps, audio on).
 */
export async function probeSource(sourceId: string): Promise<SourceProbe | null> {
  const input = openRecordingInput(mediaUrl("recording", sourceId));
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const stats = video ? await video.computePacketStats(SAMPLE_PACKETS) : null;
    return {
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      durationSec: await input.computeDuration(),
      fps: stats && stats.averagePacketRate > 0 ? stats.averagePacketRate : 30,
      hasAudio: audio !== null,
      sampleRate: audio ? (await audio.getSampleRate()) || 48000 : 48000,
    };
  } catch {
    return null;
  } finally {
    input.dispose();
  }
}
