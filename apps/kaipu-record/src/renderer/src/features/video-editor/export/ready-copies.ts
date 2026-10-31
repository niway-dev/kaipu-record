import { useSyncExternalStore } from "react";
import type { DestinationId } from "@renderer/features/prepare/destinations";

/**
 * Finished copies the user has not looked at yet (NIW2-586). A background export can finish
 * while its "ready" card is hidden, or after the user closed it: the Library rail item then
 * carries a count, and the Library page says "1 copy ready" and outlines the copy.
 *
 * Two levels, because they clear at different moments:
 * - a copy is UNSEEN until the user opens it (its Library page) or acts on its ready card
 *   (Show in Finder, drag it out) — the Library page's chip and outline follow this;
 * - an unseen copy is ANNOUNCED once the Library page has been open since it finished —
 *   the rail badge counts the copies not announced yet.
 *
 * The Library also leads with a "Ready to upload" card for each copy (`card`) until the user
 * opens the copy, closes the card, or leaves the Library after seeing it.
 *
 * In memory, like the export runner: a relaunch starts with nothing pending.
 */
export interface ReadyCopy {
  assetId: string;
  announced: boolean;
  /** The Library still shows this copy's "Ready to upload" card. */
  card: boolean;
  /** Where the copy is going, when Prepare started it (the export job's destination). */
  destination?: DestinationId;
  /** The output size the export encoded; absent when the runner did not say. */
  width?: number;
  height?: number;
}

/** What the export runner knows about a finished copy, for its Library card. */
export interface FinishedCopyInfo {
  destination?: DestinationId;
  width?: number;
  height?: number;
}

export interface ReadyCopiesSnapshot {
  /** Oldest first. */
  copies: readonly ReadyCopy[];
}

const EMPTY: ReadyCopiesSnapshot = { copies: [] };

let snapshot: ReadyCopiesSnapshot = EMPTY;
const listeners = new Set<() => void>();

function set(copies: readonly ReadyCopy[]): void {
  snapshot = { copies };
  for (const listener of listeners) listener();
}

export function getReadyCopies(): ReadyCopiesSnapshot {
  return snapshot;
}

export function subscribeReadyCopies(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useReadyCopies(): ReadyCopiesSnapshot {
  return useSyncExternalStore(subscribeReadyCopies, getReadyCopies);
}

/** An export landed in the Library: unseen, not announced, and with its Library card. */
export function noteFinishedCopy(assetId: string, info: FinishedCopyInfo = {}): void {
  set([
    ...snapshot.copies.filter((c) => c.assetId !== assetId),
    { assetId, announced: false, card: true, ...info },
  ]);
}

/** The user opened the copy or acted on it: nothing left to point at. */
export function markCopySeen(assetId: string): void {
  if (!snapshot.copies.some((c) => c.assetId === assetId)) return;
  set(snapshot.copies.filter((c) => c.assetId !== assetId));
}

/** The Library page is open: every unseen copy is there to see, so the rail badge clears. */
export function announceReadyCopies(): void {
  if (snapshot.copies.every((c) => c.announced)) return;
  set(snapshot.copies.map((c) => (c.announced ? c : { ...c, announced: true })));
}

/** The ✕ on a copy's Library card: the card goes, the copy stays unseen (chip, outline). */
export function dismissReadyCard(assetId: string): void {
  if (!snapshot.copies.some((c) => c.assetId === assetId && c.card)) return;
  set(snapshot.copies.map((c) => (c.assetId === assetId ? { ...c, card: false } : c)));
}

/**
 * The user left the Library: every card it showed has been seen, so a later visit opens on the
 * plain grid. A copy that finishes afterwards gets its own card on the next visit.
 */
export function retireReadyCards(): void {
  if (snapshot.copies.every((c) => !c.card)) return;
  set(snapshot.copies.map((c) => (c.card ? { ...c, card: false } : c)));
}

/** The copies the Library leads with, newest first. */
export function readyCards({ copies }: ReadyCopiesSnapshot): readonly ReadyCopy[] {
  return copies.filter((c) => c.card).reverse();
}

/**
 * The rail badge's count: copies not announced yet, except the one whose ready card is on
 * screen right now (`onScreenAssetId`) — that card already says it.
 */
export function libraryBadgeCount(
  { copies }: ReadyCopiesSnapshot,
  onScreenAssetId: string | null,
): number {
  return copies.filter((c) => !c.announced && c.assetId !== onScreenAssetId).length;
}

/** The asset ids the Library page outlines, and counts in its "copy ready" chip. */
export function unseenCopyIds({ copies }: ReadyCopiesSnapshot): ReadonlySet<string> {
  return new Set(copies.map((c) => c.assetId));
}

/** Tests only. */
export function __resetReadyCopiesForTests(): void {
  set([]);
}
