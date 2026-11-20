/**
 * Source ↔ export relations and the "edited, not exported" badge, derived from the
 * list `useLocalLibrary` already holds (no IPC). `derivedFromAssetId` is written by the
 * editor on export (ADR 0003: an export never replaces its source), so an export's
 * parent is always by assetId — never by title, never by local id.
 */
import type { LibraryVideo } from "./types";

export interface Lineage {
  byAssetId: Map<string, LibraryVideo>;
  /** Exports of a recording (videos and GIFs), newest first. Screenshots are never keys or values. */
  exportsOf: Map<string, LibraryVideo[]>;
}

export function buildLineage(videos: readonly LibraryVideo[]): Lineage {
  const byAssetId = new Map<string, LibraryVideo>();
  const exportsOf = new Map<string, LibraryVideo[]>();
  for (const v of videos) byAssetId.set(v.assetId, v);
  for (const v of videos) {
    // A GIF export (NIW2-217) is an export like an MP4 one: it carries the edits too.
    if (v.kind === "screenshot" || !v.derivedFromAssetId) continue;
    const list = exportsOf.get(v.derivedFromAssetId) ?? [];
    list.push(v);
    exportsOf.set(v.derivedFromAssetId, list);
  }
  for (const list of exportsOf.values()) list.sort((a, b) => b.createdAt - a.createdAt);
  return { byAssetId, exportsOf };
}

/**
 * The family an item belongs to: its root original and every descendant (copies of copies
 * included), so the original and any copy show the same list. When the chain is broken anywhere
 * (a link points at an asset that no longer exists) the family has no master (`master: null`)
 * and its list is headed by the topmost surviving item, so every member shows the same rows
 * ("source deleted" included). Cycles are cut at the first repeat.
 */
export function familyOf(
  item: LibraryVideo,
  lineage: Lineage,
): { master: LibraryVideo | null; copies: LibraryVideo[] } {
  let root = item;
  const seen = new Set([item.assetId]);
  let cur: LibraryVideo = item;
  while (cur.derivedFromAssetId !== null) {
    const parent = lineage.byAssetId.get(cur.derivedFromAssetId);
    if (!parent) {
      return { master: null, copies: [root, ...descendantsOf(root, lineage)] };
    }
    if (seen.has(parent.assetId)) break;
    seen.add(parent.assetId);
    root = parent;
    cur = parent;
  }
  return { master: root, copies: descendantsOf(root, lineage) };
}

function descendantsOf(root: LibraryVideo, lineage: Lineage): LibraryVideo[] {
  const out: LibraryVideo[] = [];
  const seen = new Set([root.assetId]);
  let level = [root.assetId];
  while (level.length > 0) {
    const next: string[] = [];
    for (const id of level) {
      for (const c of lineage.exportsOf.get(id) ?? []) {
        if (seen.has(c.assetId)) continue;
        seen.add(c.assetId);
        out.push(c);
        next.push(c.assetId);
      }
    }
    level = next;
  }
  return out;
}

export type EditBadge = "never-exported" | "stale" | "edited" | null;

/**
 * Which export state a recording's edit session is in.
 *
 *   "never-exported"  a session exists and no export of it does — the file on disk is
 *                     the original and sharing it ships none of the edits.
 *   "stale"           an export exists, but the session has been saved since it was
 *                     made, so the newest edits are in no file.
 *   "edited"          every edit is in an export; nothing is at risk.
 *
 * Exports and screenshots never carry a badge: an export IS the edited file, and a
 * screenshot has no session.
 *
 * "stale" is decided by the export STAMP (`editExportedSavedAt`), never by comparing
 * `editSavedAt` against an export's `createdAt`. That older rule was wrong in every
 * case: exporting writes the session right afterwards, and `createdAt` is the export
 * file's birthtime — the moment the encode *started* — so the session always looked
 * newer than the export it had just produced. See `SessionMeta.exportedSavedAt`.
 */
export function editBadge(video: LibraryVideo, lineage: Lineage): EditBadge {
  if (video.kind !== "recording" || video.derivedFromAssetId || video.editSavedAt === null) {
    return null;
  }
  // `exportsOf` is the authority on whether a file with the edits still exists: an
  // export the user deleted should read as "never exported" again, however recently
  // the stamp was written.
  if ((lineage.exportsOf.get(video.assetId)?.length ?? 0) === 0) return "never-exported";
  return video.editExportedSavedAt === video.editSavedAt ? "edited" : "stale";
}

/**
 * The master (NIW2-585): an original recording or screenshot, the file every copy and edit is
 * made from. Copies and GIFs are never masters.
 */
export function isMaster(video: Pick<LibraryVideo, "kind" | "derivedFromAssetId">): boolean {
  return video.kind !== "gif" && video.derivedFromAssetId === null;
}
