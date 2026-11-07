/**
 * "Already exported → reuse" (NIW2-218): before encoding, the export sheet looks for a file
 * that already IS what the user is about to make — same source (`derivedFromAssetId`), same
 * preset (sidecar `exportPreset`), same content (sidecar `exportFingerprint`) — and offers to
 * open it instead.
 *
 * The fingerprint is what makes "the edit is unchanged" exact. The session's
 * `exportedSavedAt` stamp only says the NEWEST export carries the current edit; an older
 * export with the same preset may hold an earlier edit, and reusing it would ship the wrong
 * cut. Hashing the scene itself answers per file.
 */
import type { LibraryVideo } from "@renderer/features/library/types";
import type { VideoScene } from "../scene";
import { DEFAULT_CURSOR } from "../cursor/cursor-model";
import type { WebcamScene } from "../webcam/webcam-model";
import { hasBackground } from "../background";
import { parseSession, serializeSession } from "../session";
import { encodeFingerprint, type ExportPresetId } from "./export-presets";

/** Share (no editor): the whole source file, as it is on disk. */
export const WHOLE_RECORDING_FINGERPRINT = "whole";
/** The painter revision of a redrawn cursor; bump it when the cursor's drawing changes. */
export const CURSOR_COMPOSE_REVISION = "cursor3";

/** True for Share's fingerprints: `whole`, or `whole:<hash>` when the face is composed. */
export function isWholeFingerprint(fingerprint: string | undefined): boolean {
  return (
    fingerprint === WHOLE_RECORDING_FINGERPRINT ||
    fingerprint?.startsWith(`${WHOLE_RECORDING_FINGERPRINT}:`) === true
  );
}

/** JSON with object keys sorted, so a scene re-read from its session file hashes the same. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** cyrb53: a fast 53-bit string hash. Collisions only cost a re-encode, never a wrong file in practice. */
function hash53(text: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The composer revision that draws the webcam layer; bump it when that drawing changes. */
export const WEBCAM_COMPOSE_REVISION = "wc2";
/**
 * The composer revision that draws the background (ADR 0051); bump it when that drawing
 * changes. Tagged only when a background is set: with `none` the scene is the plain picture.
 */
export const BACKGROUND_COMPOSE_REVISION = "bg1";

/**
 * The editor's fingerprint: the scene as the export burns it in. Hashed in its saved form
 * (a session round-trip), so reopening the editor on the same edit — the scene rebuilt by
 * `parseSession` — gives the same fingerprint as the in-memory scene that was exported.
 */
export function editFingerprint(scene: VideoScene, editableCursor = false): string {
  // The background is part of the edit only when one is drawn (ADR 0051): with `none` its
  // stored padding, radius and shadow are never drawn, so a plain scene hashes exactly as it
  // did before the key existed and its old exports stay reusable. With one, the field is
  // hashed and the fingerprint carries the composer revision that first drew it, so an
  // export made before then (which has no frame around the picture) is never offered.
  const { background, ...saved } = parseSession(serializeSession(scene))?.scene ?? scene;
  const drawn = background && hasBackground(background) ? background : null;
  const fingerprint = (revision: string | null, body: object): string =>
    [
      "edit",
      revision,
      drawn ? BACKGROUND_COMPOSE_REVISION : null,
      hash53(stableStringify(drawn ? { ...body, background: drawn } : body)),
    ]
      .filter(Boolean)
      .join(":");
  // A recording without a webcam hashes as it did before the layer existed, so the exports
  // already made from it stay reusable. With one, the layer is hashed (a layout change is a
  // new export) and the fingerprint is tagged with the composer revision that first drew it
  // (NIW2-575): an export made before then fingerprinted as `edit:<hash>` and has no face.
  // Default cursor settings do not change legacy embedded-cursor exports. Eligible
  // cursor-free sources carry a compositor revision, including with default settings,
  // so a pre-overlay export can never be reused as an export containing the pointer.
  const { cursor, ...rest } = saved;
  const normalized = stableStringify(cursor) === stableStringify(DEFAULT_CURSOR) ? rest : saved;
  if (editableCursor) return fingerprint(CURSOR_COMPOSE_REVISION, normalized);
  const { webcam, ...withoutWebcam } = normalized;
  return webcam
    ? fingerprint(WEBCAM_COMPOSE_REVISION, normalized)
    : fingerprint(null, withoutWebcam);
}

/**
 * Share's fingerprint (NIW2-576): plain `whole` for a recording without a webcam, so the
 * Share files already made stay reusable; `whole:<hash of the seeded webcam layer>` with one.
 * A pre-webcam "whole" export has no face and an editor export has its own `edit:` prefix,
 * so neither is mistaken for it.
 */
export function wholeFingerprint(webcam: WebcamScene | null): string {
  return webcam
    ? `${WHOLE_RECORDING_FINGERPRINT}:${hash53(stableStringify(webcam))}`
    : WHOLE_RECORDING_FINGERPRINT;
}

/**
 * What an export records when the scene has a webcam layer but the file came out without the
 * face (the webcam file was missing, unreadable or could not be decoded): its fingerprint
 * says "with the face", so stamping it would offer a faceless file as the reusable one. Share
 * records the plain `whole` (the source as it is on disk, which this file is); an editor
 * export records none, so it is never reused.
 */
export function facelessFingerprint(fingerprint: string): string | undefined {
  if (!isWholeFingerprint(fingerprint)) return undefined;
  // A copy that redraws the cursor keeps that revision: the faceless file still has it.
  return fingerprint.endsWith(`:${CURSOR_COMPOSE_REVISION}`)
    ? `${WHOLE_RECORDING_FINGERPRINT}:${CURSOR_COMPOSE_REVISION}`
    : WHOLE_RECORDING_FINGERPRINT;
}

/** The newest playable MP4 export of each preset whose content matches `fingerprint`. */
export type ReusableExports = Partial<Record<ExportPresetId, LibraryVideo>>;

/**
 * Picks, per preset, the newest local MP4 export in `exports` (a source's exports, as
 * `buildLineage().exportsOf` lists them) that encoded `fingerprint`. Exports made before
 * fingerprints existed never match: re-encoding is the safe answer when we can't tell.
 */
export function findReusableExports(
  exports: readonly LibraryVideo[],
  fingerprint: string,
): ReusableExports {
  const found: ReusableExports = {};
  const newestFirst = [...exports].sort((a, b) => b.createdAt - a.createdAt);
  for (const e of newestFirst) {
    if (e.kind !== "recording" || e.id === null || !e.export) continue;
    // Same content AND the same encode: an older file of this preset made with different
    // numbers (or an old Small-file export, now read as Light) never matches.
    if (e.export.fingerprint !== encodeFingerprint(fingerprint, e.export.preset)) continue;
    found[e.export.preset] ??= e;
  }
  return found;
}
