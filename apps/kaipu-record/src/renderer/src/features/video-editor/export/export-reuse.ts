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
import { parseSession, serializeSession } from "../session";
import type { ExportPresetId } from "./export-presets";

/** Share (no editor): the whole source file, as it is on disk. */
export const WHOLE_RECORDING_FINGERPRINT = "whole";

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

/**
 * The editor's fingerprint: the scene as the export burns it in. Hashed in its saved form
 * (a session round-trip), so reopening the editor on the same edit — the scene rebuilt by
 * `parseSession` — gives the same fingerprint as the in-memory scene that was exported.
 */
export function editFingerprint(scene: VideoScene): string {
  const saved = parseSession(serializeSession(scene))?.scene ?? scene;
  return `edit:${hash53(stableStringify(saved))}`;
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
    if (e.export.fingerprint !== fingerprint) continue;
    found[e.export.preset] ??= e;
  }
  return found;
}
