/**
 * "Your video is ready" floating window (main/recording/recording-ready-window.ts): the
 * contract between the main window that asks for it, main, and the card window itself.
 * Pure, and no value imports from workspace packages (it is reachable from the preload).
 */

/**
 * The chips' destinations. A subset of the renderer's `DestinationId` (Prepare's ids);
 * `post-recording-card.tsx` pins it with `satisfies`, so a renamed id fails to compile.
 */
export const RECORDING_READY_DESTINATIONS = ["youtube", "vertical", "github"] as const;
export type RecordingReadyDestination = (typeof RECORDING_READY_DESTINATIONS)[number];

/** Main window → main → card: what the card shows about the fresh recording. */
export interface RecordingReadyPayload {
  assetId: string;
  durationSeconds: number;
  /** Width × height once the file has been read; null when it could not be. */
  dimensions: { width: number; height: number } | null;
  sizeBytes: number;
  /** "Edit first" shows only when the recording can open in the editor. */
  canEdit: boolean;
}

/** Card → main: what the user pressed. `destination: null` is "More places". */
export type RecordingReadyAction =
  | { kind: "pick"; destination: RecordingReadyDestination | null }
  | { kind: "edit" }
  | { kind: "open" }
  | { kind: "dismiss" };

/**
 * Main → main window (`recording-ready:open`): where to take the user. The renderer turns
 * it into a path with its own helpers (`preparePath`, `editorPathFor`), so main never
 * names a renderer route.
 */
export type RecordingReadyHandOff =
  | { target: "prepare"; assetId: string; destination: RecordingReadyDestination | null }
  | { target: "editor"; assetId: string }
  | { target: "detail"; assetId: string };

function isDestination(value: unknown): value is RecordingReadyDestination {
  return (RECORDING_READY_DESTINATIONS as readonly unknown[]).includes(value);
}

/** An action from the card window, made safe: anything malformed is null. */
export function parseRecordingReadyAction(value: unknown): RecordingReadyAction | null {
  if (!value || typeof value !== "object") return null;
  const { kind, destination } = value as { kind?: unknown; destination?: unknown };
  switch (kind) {
    case "pick":
      if (destination === null || isDestination(destination)) return { kind, destination };
      return null;
    case "edit":
    case "open":
    case "dismiss":
      return { kind };
    default:
      return null;
  }
}

/** A payload from the main window, made safe: anything malformed is null. */
export function parseRecordingReadyPayload(value: unknown): RecordingReadyPayload | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);
  if (typeof v.assetId !== "string" || v.assetId === "") return null;
  if (!finite(v.durationSeconds) || !finite(v.sizeBytes) || typeof v.canEdit !== "boolean") {
    return null;
  }
  let dimensions: RecordingReadyPayload["dimensions"] = null;
  if (v.dimensions !== null) {
    const d = v.dimensions as { width?: unknown; height?: unknown } | undefined;
    if (!d || !finite(d.width) || !finite(d.height)) return null;
    dimensions = { width: d.width, height: d.height };
  }
  return {
    assetId: v.assetId,
    durationSeconds: v.durationSeconds,
    dimensions,
    sizeBytes: v.sizeBytes,
    canEdit: v.canEdit,
  };
}

/**
 * Where an action takes the user: a chip or More places into Prepare, Edit first into the
 * editor (only when the card offered it), Open onto the recording's page. × goes nowhere.
 */
export function handOffFor(
  action: RecordingReadyAction,
  payload: RecordingReadyPayload,
): RecordingReadyHandOff | null {
  const { assetId } = payload;
  switch (action.kind) {
    case "pick":
      return { target: "prepare", assetId, destination: action.destination };
    case "edit":
      return payload.canEdit ? { target: "editor", assetId } : null;
    case "open":
      return { target: "detail", assetId };
    case "dismiss":
      return null;
  }
}
