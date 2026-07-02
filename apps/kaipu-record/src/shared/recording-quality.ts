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

// Each enum-like set is ONE source of truth: the `as const` array defines the
// runtime values AND the type (`(typeof […])[number]`). No TS `enum` — the
// const-array + typeof idiom is the house style (same as `IPC_CHANNELS`).
export const RESOLUTION_STEPS = [720, 1080, 1440, 2160] as const;
export type ResolutionStep = (typeof RESOLUTION_STEPS)[number];

export const FPS_STEPS = [24, 30, 48, 60] as const;
export type FpsStep = (typeof FPS_STEPS)[number];

export const BITRATE_STEPS = ["light", "medium", "high", "max"] as const;
export type BitrateStep = (typeof BITRATE_STEPS)[number];

/** The three named presets; "custom" is appended for the chip render order. */
export const NAMED_PRESETS = ["light", "balanced", "max"] as const;
export type NamedPresetId = (typeof NAMED_PRESETS)[number];

export const PRESET_ORDER = [...NAMED_PRESETS, "custom"] as const;
export type QualityPresetId = (typeof PRESET_ORDER)[number];

/** The three knobs the user controls. The active preset is *derived* from these. */
export interface RecordingQuality {
  resolution: ResolutionStep;
  fps: FpsStep;
  bitrate: BitrateStep;
}

/**
 * 16:9 pixel dimensions for each resolution step. Used for the file-weight
 * estimate and the 16:9 reference; the ACTUAL recorded frame is derived from the
 * real screen aspect ratio via {@link fitToCap}, never forced to these.
 */
export const RESOLUTION_DIMENSIONS: Record<ResolutionStep, { width: number; height: number }> = {
  720: { width: 1280, height: 720 },
  1080: { width: 1920, height: 1080 },
  1440: { width: 2560, height: 1440 },
  2160: { width: 3840, height: 2160 },
};

/** Round to the nearest even integer — H.264 requires even frame dimensions. */
function toEven(value: number): number {
  return Math.round(value / 2) * 2;
}

/**
 * Derive the real recorded dimensions from the source's TRUE pixel size,
 * preserving its aspect ratio. The resolution step is a **height cap**, never a
 * fixed 16:9 box — so a 3024×1964 MacBook panel records as 1662×1080 (its real
 * 1.54 ratio), not stretched into 1920×1080. Never upscales (a source smaller
 * than the cap stays native) and always returns even dimensions.
 */
export function fitToCap(
  sourceW: number,
  sourceH: number,
  capHeight: number,
): { width: number; height: number } {
  const height = Math.min(capHeight, sourceH);
  const width = (height * sourceW) / sourceH;
  return { width: toEven(width), height: toEven(height) };
}

/** Encoder video bitrate (bits/s) for each tier. File weight ≈ this value. */
export const BITRATE_BPS: Record<BitrateStep, number> = {
  light: 4_000_000,
  medium: 8_000_000,
  high: 16_000_000,
  max: 24_000_000,
};

/**
 * Audio (AAC) bitrate. Not a user knob yet, but it lives here so EVERY encoder
 * number sits in one place — the engine never restates an encoder value.
 */
export const AUDIO_BITRATE_BPS = 128_000;

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
export const QUALITY_PRESETS: Record<NamedPresetId, RecordingQuality> = {
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
  for (const id of NAMED_PRESETS) {
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
