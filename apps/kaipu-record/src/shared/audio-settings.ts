/**
 * The audio the take mixes in: the microphone's level and noise reduction, the system
 * audio's volume, and whether it ducks while the user talks. Pure and import-free on
 * purpose: main (settings merge), the preload bundle (through `types/ipc.ts`) and the
 * renderer (the settings UI, the recorder engine) all read it.
 *
 * The defaults reproduce the recording from before these settings existed.
 */

export interface AudioSettings {
  /** Mic gain in percent, 0..200; 100 leaves the signal unchanged. */
  micLevel: number;
  /** Chromium's noise suppression on the mic track (its `getUserMedia` default is on). */
  noiseSuppression: boolean;
  /** System-audio volume in the recording, percent, 0..100. */
  systemAudioVolume: number;
  /** Lower the system audio while the mic hears a voice. */
  duckSystemAudioWhileTalking: boolean;
}

export const MIC_LEVEL_MIN = 0;
export const MIC_LEVEL_MAX = 200;
export const SYSTEM_AUDIO_VOLUME_MIN = 0;
export const SYSTEM_AUDIO_VOLUME_MAX = 100;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  micLevel: 100,
  noiseSuppression: true,
  systemAudioVolume: 100,
  duckSystemAudioWhileTalking: false,
};

/** A finite level, rounded to a whole percent and held inside 0..200. */
export function clampMicLevel(level: number): number {
  if (!Number.isFinite(level)) return DEFAULT_AUDIO_SETTINGS.micLevel;
  return Math.min(MIC_LEVEL_MAX, Math.max(MIC_LEVEL_MIN, Math.round(level)));
}

/** A finite volume, rounded to a whole percent and held inside 0..100. */
export function clampSystemAudioVolume(volume: number): number {
  if (!Number.isFinite(volume)) return DEFAULT_AUDIO_SETTINGS.systemAudioVolume;
  return Math.min(SYSTEM_AUDIO_VOLUME_MAX, Math.max(SYSTEM_AUDIO_VOLUME_MIN, Math.round(volume)));
}

/**
 * Stored (possibly partial or hand-edited) audio settings merged over the defaults,
 * field by field: a wrong type falls back alone, a number out of range is clamped
 * rather than dropped.
 */
export function sanitizeAudioSettings(value: unknown): AudioSettings {
  const safe = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return {
    micLevel:
      typeof safe.micLevel === "number"
        ? clampMicLevel(safe.micLevel)
        : DEFAULT_AUDIO_SETTINGS.micLevel,
    noiseSuppression:
      typeof safe.noiseSuppression === "boolean"
        ? safe.noiseSuppression
        : DEFAULT_AUDIO_SETTINGS.noiseSuppression,
    systemAudioVolume:
      typeof safe.systemAudioVolume === "number"
        ? clampSystemAudioVolume(safe.systemAudioVolume)
        : DEFAULT_AUDIO_SETTINGS.systemAudioVolume,
    duckSystemAudioWhileTalking:
      typeof safe.duckSystemAudioWhileTalking === "boolean"
        ? safe.duckSystemAudioWhileTalking
        : DEFAULT_AUDIO_SETTINGS.duckSystemAudioWhileTalking,
  };
}
