import type { RecordingSettings } from "@shared/types/ipc";
import type { PermissionKind } from "@shared/types/electron-api";
import { WINDOW_PRESETS, type WindowPresetName } from "@shared/window-size";

/**
 * Argument validators for IPC handlers whose payload is not a file id. The
 * renderer is not trusted to send well-formed values, so each handler narrows
 * what it receives before acting on it.
 */

export function isPermissionKind(value: unknown): value is PermissionKind {
  return value === "screen" || value === "microphone" || value === "camera";
}

export function isWindowPresetName(value: unknown): value is WindowPresetName {
  return typeof value === "string" && Object.hasOwn(WINDOW_PRESETS, value);
}

export function isTrayMode(value: unknown): value is "record" | "screenshot" {
  return value === "record" || value === "screenshot";
}

/** A finite number, or null. */
export function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const BOOLEAN_KEYS = ["isMicrophoneEnabled", "isSystemAudioEnabled", "isCameraEnabled"] as const;
const MAX_LABEL = 500;

function isShortString(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_LABEL;
}

/** Keep only the known recording-setting fields, each with its expected shape. */
export function sanitizeRecordingSettingsPatch(patch: unknown): Partial<RecordingSettings> {
  const input = (patch && typeof patch === "object" ? patch : {}) as Record<string, unknown>;
  const out: Partial<RecordingSettings> = {};
  for (const key of BOOLEAN_KEYS) {
    const value = input[key];
    if (typeof value === "boolean") out[key] = value;
  }
  if ("selectedSource" in input) {
    const s = input["selectedSource"] as Record<string, unknown> | null;
    if (s === null) {
      out.selectedSource = null;
    } else if (
      s &&
      isShortString(s["id"]) &&
      isShortString(s["name"]) &&
      (s["type"] === "screen" || s["type"] === "window")
    ) {
      out.selectedSource = { id: s["id"], name: s["name"], type: s["type"] };
    }
  }
  if ("selectedMicrophone" in input) {
    const m = input["selectedMicrophone"] as Record<string, unknown> | null;
    if (m === null) {
      out.selectedMicrophone = null;
    } else if (m && isShortString(m["deviceId"]) && isShortString(m["label"])) {
      out.selectedMicrophone = { deviceId: m["deviceId"], label: m["label"] };
    }
  }
  return out;
}
