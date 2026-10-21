import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { ticketWindowClosed, ticketWindowClosesAt, ticketWindowCutoff } from "./ticket-window";

/**
 * Why a cancel did not release. Internal to the application layer: the public contract still
 * answers `{ released: boolean }`, the router uses the reason only to log `cloud.cancel.deferred`.
 */
export type CancelUploadResult =
  | { released: true }
  | { released: false; reason: "not-reserved" }
  | { released: false; reason: "deferred"; settlesAt: Date };

/**
 * Release a reservation the client gave up on. Claims the reservation FIRST — `release` is a
 * status-guarded transition that only succeeds while the revision is still `reserved` — and only
 * once that succeeds does it try to delete whatever landed under the key (a partial PUT never
 * lands; a full one that was never confirmed does). This ordering matters: `confirmUpload` can
 * win a race between our read and our write, flipping the revision to `ready` first, in which
 * case `release` reports nothing claimed and the object is left untouched — a ready asset must
 * never lose its object. A storage failure after a successful claim is not an error for the
 * caller: the bytes are already released, and a stray object is acceptable (unlike a corrupt
 * ready asset). Idempotent: a second call reports `released: false`.
 *
 * While the presigned PUT ticket can still start a write (see `ticketWindowClosed`) the cancel is
 * deferred: the reservation stays, so bytes that land afterwards remain accounted for, and
 * `sweepExpiredReservations` releases it and deletes the object once the window closes. Releasing
 * and deleting earlier would let a still-valid ticket re-create the object with nothing counting it.
 * The release itself is guarded on the stored ticket expiry, so a resumed intent that extends the
 * ticket between our read and our release turns the release into a no-op (reported as deferred).
 */
export async function cancelUpload(params: {
  assets: ICloudAssetRepository;
  storage: IStorageService;
  userId: string;
  assetId: string;
  revisionId: string;
  now?: Date;
}): Promise<CancelUploadResult | null> {
  const now = params.now ?? new Date();
  const revision = await params.assets.findRevision(
    params.userId,
    params.assetId,
    params.revisionId,
  );
  if (!revision) return null;
  if (revision.status !== "reserved") return { released: false, reason: "not-reserved" };
  if (!ticketWindowClosed(revision.ticketExpiresAt, now)) {
    return {
      released: false,
      reason: "deferred",
      settlesAt: ticketWindowClosesAt(revision.ticketExpiresAt),
    };
  }
  const released = await params.assets.release(params.userId, params.revisionId, {
    ticketExpiredBy: ticketWindowCutoff(now),
  });
  if (!released) {
    // Lost a race: confirmed (no longer reserved) or resumed (ticket extended, window open again).
    const latest = await params.assets.findRevision(
      params.userId,
      params.assetId,
      params.revisionId,
    );
    if (latest?.status === "reserved") {
      return {
        released: false,
        reason: "deferred",
        settlesAt: ticketWindowClosesAt(latest.ticketExpiresAt),
      };
    }
    return { released: false, reason: "not-reserved" };
  }
  try {
    await params.storage.deleteObject(revision.storageKey);
    if (revision.thumbnailKey) await params.storage.deleteObject(revision.thumbnailKey);
  } catch {
    // The claim already succeeded; a stray object is not this caller's problem to fail on.
  }
  return { released: true };
}
