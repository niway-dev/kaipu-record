/**
 * Source ↔ export relations and the "edited, not exported" badge, derived from the
 * list `useLocalLibrary` already holds (no IPC). `derivedFromAssetId` is written by the
 * editor on export (ADR 0003: an export never replaces its source), so an export's
 * parent is always by assetId — never by title, never by local id.
 */
import type { LibraryVideo } from "./types";

export interface Lineage {
  byAssetId: Map<string, LibraryVideo>;
  /** Exports of a recording, newest first. Screenshots are never keys or values. */
  exportsOf: Map<string, LibraryVideo[]>;
}

export function buildLineage(videos: readonly LibraryVideo[]): Lineage {
  const byAssetId = new Map<string, LibraryVideo>();
  const exportsOf = new Map<string, LibraryVideo[]>();
  for (const v of videos) byAssetId.set(v.assetId, v);
  for (const v of videos) {
    if (v.kind !== "recording" || !v.derivedFromAssetId) continue;
    const list = exportsOf.get(v.derivedFromAssetId) ?? [];
    list.push(v);
    exportsOf.set(v.derivedFromAssetId, list);
  }
  for (const list of exportsOf.values()) list.sort((a, b) => b.createdAt - a.createdAt);
  return { byAssetId, exportsOf };
}

export type EditBadge = "not-exported" | "edited" | null;

/**
 * "not-exported": a session exists and no export of this recording is newer than it —
 * the file on disk is the original and sharing it ships none of the edits.
 * "edited": a session exists and a newer export exists. Exports and screenshots never
 * carry a badge: an export IS the edited file, and screenshots have no session.
 */
export function editBadge(video: LibraryVideo, lineage: Lineage): EditBadge {
  if (video.kind !== "recording" || video.derivedFromAssetId || video.editSavedAt === null) {
    return null;
  }
  const newest = lineage.exportsOf.get(video.assetId)?.[0];
  return newest && newest.createdAt >= video.editSavedAt ? "edited" : "not-exported";
}
