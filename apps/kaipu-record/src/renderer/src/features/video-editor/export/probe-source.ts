import { ALL_FORMATS, Input, UrlSource } from "mediabunny";

/** Source facts the export presets need (NIW2-218) that the `<video>` element doesn't expose. */
export interface SourceProbe {
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
  const input = new Input({
    source: new UrlSource(`kaipu-media://recording/${sourceId}`),
    formats: ALL_FORMATS,
  });
  try {
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    const stats = video ? await video.computePacketStats(SAMPLE_PACKETS) : null;
    return {
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
