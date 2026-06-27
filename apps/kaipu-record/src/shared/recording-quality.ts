/**
 * Pure recording-quality model: the named presets, the discrete slider steps,
 * and the mapping to real encoder parameters.
 *
 * Imported by BOTH processes — the main process (settings validation) and the
 * renderer (the Settings UI + engine wiring) — so it must stay free of any
 * `electron`, `node:*`, or React imports, exactly like the IPC contract.
 *
 * Copy is neutral Spanish (no regionalisms), benefit-first for non-technical
 * users — see the `copy-language` rule.
 */

export type ResolutionStep = 720 | 1080 | 1440 | 2160;
export type FpsStep = 24 | 30 | 48 | 60;
export type BitrateStep = "light" | "medium" | "high" | "max";
export type QualityPresetId = "light" | "balanced" | "max" | "custom";

/** The three knobs the user controls. The active preset is *derived* from these. */
export interface RecordingQuality {
  resolution: ResolutionStep;
  fps: FpsStep;
  bitrate: BitrateStep;
}

export const RESOLUTION_STEPS: readonly ResolutionStep[] = [720, 1080, 1440, 2160];
export const FPS_STEPS: readonly FpsStep[] = [24, 30, 48, 60];
export const BITRATE_STEPS: readonly BitrateStep[] = ["light", "medium", "high", "max"];

/** 16:9 pixel dimensions for each resolution step (also the encoder cap). */
export const RESOLUTION_DIMENSIONS: Record<ResolutionStep, { width: number; height: number }> = {
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  1440: { width: 2560, height: 1440 },
  2160: { width: 3840, height: 2160 },
};

/** Encoder video bitrate (bits/s) for each tier. File weight ≈ this value. */
export const BITRATE_BPS: Record<BitrateStep, number> = {
  light: 4_000_000,
  medium: 8_000_000,
  high: 16_000_000,
  max: 24_000_000,
};

/** Short label shown under each resolution step. */
export const RESOLUTION_STEP_LABELS: Record<ResolutionStep, string> = {
  720: "720p",
  1080: "1080p",
  1440: "1440p",
  2160: "4K",
};

/**
 * Right-side word describing the fps "feel". 48 keeps the plain number (the user
 * only wanted Cine / Estándar / Muy fluido — no invented word for 48).
 */
export const FPS_VALUE_LABELS: Record<FpsStep, string> = {
  24: "Cine",
  30: "Estándar",
  48: "48 fps",
  60: "Muy fluido",
};

export const FPS_STEP_LABELS: Record<FpsStep, string> = {
  24: "24",
  30: "30",
  48: "48",
  60: "60",
};

export const BITRATE_STEP_LABELS: Record<BitrateStep, string> = {
  light: "Ligero",
  medium: "Medio",
  high: "Alto",
  max: "Máximo",
};

/**
 * The three named presets. "Personalizado" is never stored as a combo — it is
 * derived whenever the values don't match one of these (see `activePreset`).
 * 4K and the "max" bitrate are intentionally reachable only via Personalizado.
 */
export const QUALITY_PRESETS: Record<"light" | "balanced" | "max", RecordingQuality> = {
  light: { resolution: 720, fps: 24, bitrate: "light" },
  balanced: { resolution: 1080, fps: 30, bitrate: "medium" },
  max: { resolution: 1440, fps: 60, bitrate: "high" },
};

export const DEFAULT_QUALITY: RecordingQuality = QUALITY_PRESETS.balanced;

export interface PresetMeta {
  id: QualityPresetId;
  emoji: string;
  label: string;
  /** One-line caption shown under the chips, explaining where this preset is headed. */
  caption: string;
}

/** Chip emoji/label + the caption that swaps in below the chips. */
export const PRESET_META: Record<QualityPresetId, PresetMeta> = {
  light: {
    id: "light",
    emoji: "🚀",
    label: "Liviano",
    caption: "Ocupa poco espacio. Perfecto para compartir o subir rápido.",
  },
  balanced: {
    id: "balanced",
    emoji: "🎯",
    label: "Equilibrado",
    caption: "La mejor relación entre nitidez y tamaño. Ideal para casi todo.",
  },
  max: {
    id: "max",
    emoji: "✨",
    label: "Máxima calidad",
    caption: "La mayor nitidez y fluidez. Pensado para editar o presentar.",
  },
  custom: {
    id: "custom",
    emoji: "🎛️",
    label: "Personalizado",
    caption: "Ajusta cada control a tu gusto. El peso se calcula en vivo.",
  },
};

/** The order the chips render in. */
export const PRESET_ORDER: readonly QualityPresetId[] = ["light", "balanced", "max", "custom"];

/** Deep-dive copy behind each ⓘ icon, for the curious. */
export const QUALITY_INFO = {
  resolution:
    "Cantidad de píxeles: más alta se ve más nítida pero pesa más. 1080p es ideal para casi todo. No supera la resolución real de tu pantalla.",
  fps: "Cuadros por segundo: más fps hacen el movimiento más suave y aumentan el peso. 30 va perfecto para grabar pantalla; 60 para movimiento rápido.",
  bitrate:
    "Datos por segundo: es lo que más afecta el peso del archivo. Más alto = imagen más limpia; más bajo = archivo liviano que puede pixelarse en escenas con movimiento.",
} as const;

/** Which preset a combo matches; "custom" when it matches none. */
export function activePreset(quality: RecordingQuality): QualityPresetId {
  for (const id of ["light", "balanced", "max"] as const) {
    const preset = QUALITY_PRESETS[id];
    if (
      preset.resolution === quality.resolution &&
      preset.fps === quality.fps &&
      preset.bitrate === quality.bitrate
    ) {
      return id;
    }
  }
  return "custom";
}

/** Approximate file weight in MB per minute (driven by the video bitrate). */
export function mbPerMinute(bitrate: BitrateStep): number {
  return Math.round((BITRATE_BPS[bitrate] * 60) / 8 / 1_000_000);
}

export interface EngineQuality {
  width: number;
  height: number;
  frameRate: number;
  videoBitrate: number;
}

/** Resolve a quality combo to the real encoder parameters the engine consumes. */
export function qualityToEngine(quality: RecordingQuality): EngineQuality {
  const { width, height } = RESOLUTION_DIMENSIONS[quality.resolution];
  return {
    width,
    height,
    frameRate: quality.fps,
    videoBitrate: BITRATE_BPS[quality.bitrate],
  };
}

/** Coerce a possibly-untrusted/partial stored value back to a safe combo. */
export function sanitizeQuality(value: unknown): RecordingQuality {
  const q = (value ?? {}) as Partial<RecordingQuality>;
  return {
    resolution: (RESOLUTION_STEPS as readonly number[]).includes(q.resolution as number)
      ? (q.resolution as ResolutionStep)
      : DEFAULT_QUALITY.resolution,
    fps: (FPS_STEPS as readonly number[]).includes(q.fps as number)
      ? (q.fps as FpsStep)
      : DEFAULT_QUALITY.fps,
    bitrate: (BITRATE_STEPS as readonly string[]).includes(q.bitrate as string)
      ? (q.bitrate as BitrateStep)
      : DEFAULT_QUALITY.bitrate,
  };
}
