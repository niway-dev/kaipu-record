import { beforeEach, describe, expect, it } from "vitest";
import {
  AssetConflictError,
  FREE_ENTITLEMENTS,
  UploadIntentExpiredError,
  type Entitlements,
} from "@kaipu/domain/schemas";
import {
  MAX_PENDING_UPLOADS_PER_ACCOUNT,
  RESERVATION_GRACE_SECONDS,
  UPLOAD_TICKET_TTL_SECONDS,
} from "@kaipu/domain/constants";
import { cancelUpload } from "./cancel-upload";
import { confirmUpload } from "./confirm-upload";
import { createUploadIntent } from "./create-upload-intent";
import { deleteCloudCopy } from "./delete-cloud-copy";
import { makeFakeAccess, makeFakeAssets, makeFakePurge, makeFakeStorage } from "./fakes";
import { getAssetDownloadUrl } from "./get-asset-download-url";
import { getStorageUsage } from "./get-storage-usage";
import { listCloudAssets } from "./list-cloud-assets";
import { purgeAccountObjects } from "./purge-account-objects";
import { retryPendingDeletes } from "./retry-pending-deletes";
import { sweepExpiredReservations } from "./sweep-expired-reservations";
import { sweepOrphanObjects } from "./sweep-orphan-objects";
import { ticketWindowClosed, ticketWindowClosesAt, ticketWindowCutoff } from "./ticket-window";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const NOW = new Date("2026-09-10T12:00:00Z");
/**
 * One second after the ticket window of a revision reserved at NOW has closed. Tests that expect
 * an immediate release or delete pass it explicitly instead of relying on the wall clock being
 * hours past the fixture date.
 */
const AFTER_WINDOW = new Date(
  NOW.getTime() + (UPLOAD_TICKET_TTL_SECONDS + RESERVATION_GRACE_SECONDS) * 1000 + 1000,
);
const grant: Entitlements = {
  ...FREE_ENTITLEMENTS,
  features: { ...FREE_ENTITLEMENTS.features, cloudUploads: true, cloudStorageBytes: 1000 },
};
/** Same grant with room for several 600-byte uploads at once. */
const roomy: Entitlements = {
  ...grant,
  features: { ...grant.features, cloudStorageBytes: 10_000 },
};

function intent(overrides: Record<string, unknown> = {}) {
  return {
    assetId: crypto.randomUUID(),
    intentKey: crypto.randomUUID(),
    kind: "recording" as const,
    title: "Demo",
    contentType: "video/mp4",
    sizeBytes: 600,
    contentSha256: SHA,
    durationSeconds: 10,
    derivedFromAssetId: null,
    thumbnail: null,
    ...overrides,
  };
}

describe("createUploadIntent", () => {
  let assets: ReturnType<typeof makeFakeAssets>;
  let storage: ReturnType<typeof makeFakeStorage>;
  let access: ReturnType<typeof makeFakeAccess>;
  beforeEach(() => {
    assets = makeFakeAssets();
    storage = makeFakeStorage();
    access = makeFakeAccess();
  });

  it("reserves quota and returns a restricted ticket", async () => {
    const result = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent(),
      now: NOW,
    });
    expect(result.status).toBe("reserved");
    expect(result.ticket?.headers["content-length"]).toBe("600");
    expect(result.ticket?.headers["if-none-match"]).toBe("*");
    expect(result.ticket?.thumbnail).toBeNull();
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 0,
      reservedBytes: 600,
      pendingUploads: 1,
    });
    // The asset summary never carries a storage key (the ticket URL necessarily does — that's
    // how the client knows where to PUT).
    expect(JSON.stringify(result.asset)).not.toContain("videos/u1");
  });

  it("counts the thumbnail in the reservation and issues a ticket for it", async () => {
    const result = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent({ thumbnail: { sizeBytes: 100, contentSha256: SHA } }),
      now: NOW,
    });
    expect(result.ticket?.thumbnail?.headers["content-length"]).toBe("100");
    expect((await assets.usage("u1")).reservedBytes).toBe(700);
  });

  it("is idempotent on intentKey: same revision, no second reservation", async () => {
    const input = intent();
    const a = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    const b = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    expect(b.revisionId).toBe(a.revisionId);
    expect((await assets.usage("u1")).reservedBytes).toBe(600);
    expect(b.ticket).not.toBeNull(); // re-issued for the same key
  });

  // Fix round 1 / Minor: resuming a still-reserved intent actually extends the ticket window
  // rather than silently re-signing the original (now possibly stale) expiry.
  it("resuming an intent actually extends the stored ticket window (not a silent re-sign of the stale one)", async () => {
    const input = intent();
    const a = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    const originalTicketExpiresAt = assets.revisions.get(a.revisionId)!.ticketExpiresAt.getTime();
    const later = new Date(NOW.getTime() + 60_000);
    const b = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: later,
    });
    expect(b.revisionId).toBe(a.revisionId);
    expect(b.ticket).not.toBeNull();
    const extended = assets.revisions.get(a.revisionId)!.ticketExpiresAt.getTime();
    expect(extended).toBeGreaterThan(originalTicketExpiresAt);
    expect(extended).toBe(later.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000);
  });

  it("repeating a cancelled or expired intent key fails as intent-expired, not as a quota error", async () => {
    const input = intent();
    const a = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    await cancelUpload({
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: a.revisionId,
    });
    await expect(
      createUploadIntent({
        assets,
        access,
        storage,
        userId: "u1",
        entitlements: grant,
        input,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(UploadIntentExpiredError);
    expect((await assets.usage("u1")).reservedBytes).toBe(0);
  });

  it("after confirm, repeating the intent reports ready with no ticket", async () => {
    const input = intent();
    const a = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    storage.land(assets.revisions.get(a.revisionId)!.storageKey, {
      sizeBytes: 600,
      contentType: "video/mp4",
      checksumSha256: SHA,
    });
    await confirmUpload({
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: a.revisionId,
      now: NOW,
    });
    const b = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    expect(b.status).toBe("ready");
    expect(b.ticket).toBeNull();
  });

  it("rejects when committed occupation would exceed capacity, reporting the missing bytes", async () => {
    await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent(),
      now: NOW,
    });
    await expect(
      createUploadIntent({
        assets,
        access,
        storage,
        userId: "u1",
        entitlements: grant,
        input: intent({ sizeBytes: 550 }),
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: "QuotaExceededError", missingBytes: 150 });
    expect(storage.tickets).toHaveLength(1);
  });

  it("rejects per-file limit, unsupported type, missing access, disabled uploads and the pending cap", async () => {
    const base = { assets, access, storage, userId: "u1", entitlements: grant, now: NOW };
    await expect(
      createUploadIntent({ ...base, input: intent({ sizeBytes: 1_000_000_001 }) }),
    ).rejects.toMatchObject({ name: "FileTooLargeError" });
    await expect(
      createUploadIntent({ ...base, input: intent({ contentType: "application/zip" }) }),
    ).rejects.toMatchObject({ name: "UnsupportedContentTypeError" });
    await expect(
      createUploadIntent({ ...base, entitlements: FREE_ENTITLEMENTS, input: intent() }),
    ).rejects.toMatchObject({ name: "CloudAccessDeniedError" });
    access.uploadsEnabled = false;
    await expect(createUploadIntent({ ...base, input: intent() })).rejects.toMatchObject({
      name: "UploadsDisabledError",
    });
    access.uploadsEnabled = true;
    for (let i = 0; i < MAX_PENDING_UPLOADS_PER_ACCOUNT; i += 1) {
      await createUploadIntent({ ...base, input: intent({ sizeBytes: 10 }) });
    }
    await expect(
      createUploadIntent({ ...base, input: intent({ sizeBytes: 10 }) }),
    ).rejects.toMatchObject({ name: "TooManyPendingUploadsError" });
    expect(assets.revisions.size).toBe(MAX_PENDING_UPLOADS_PER_ACCOUNT);
  });

  it("does not let user B reuse user A's intent key or asset id", async () => {
    const input = intent();
    await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    const other = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u2",
      entitlements: grant,
      input,
      now: NOW,
    });
    expect(other.status).toBe("reserved");
    expect(assets.revisions.size).toBe(2);
    expect((await assets.usage("u2")).reservedBytes).toBe(600);
  });

  // R1: tombstoned assets and repository-level intent-key races (Task 8 behavior, mirrored by the fake).
  it("refuses to reserve a new revision on a tombstoned asset, leaving usage unchanged", async () => {
    const input = intent();
    const a = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    storage.land(assets.revisions.get(a.revisionId)!.storageKey, {
      sizeBytes: 600,
      contentType: "video/mp4",
      checksumSha256: SHA,
    });
    await confirmUpload({
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: a.revisionId,
      now: NOW,
    });
    await deleteCloudCopy({ assets, storage, userId: "u1", assetId: input.assetId });
    const tombstoned = assets.assets.get(`u1/${input.assetId}`)!;
    assets.assets.set(`u1/${input.assetId}`, { ...tombstoned, deletedAt: NOW });
    const before = await assets.usage("u1");

    await expect(
      createUploadIntent({
        assets,
        access,
        storage,
        userId: "u1",
        entitlements: grant,
        input: intent({ assetId: input.assetId }),
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AssetConflictError);
    expect(await assets.usage("u1")).toEqual(before);
  });

  it("resolves to the winner's revision when reserve rejects a duplicate intent key at the repository level", async () => {
    const input = intent();
    const winnerRevisionId = crypto.randomUUID();
    const winner = await assets.reserve({
      userId: "u1",
      assetId: input.assetId,
      intentKey: input.intentKey,
      revisionId: winnerRevisionId,
      kind: input.kind,
      title: input.title,
      durationSeconds: input.durationSeconds,
      derivedFromAssetId: input.derivedFromAssetId,
      storageKey: `videos/u1/${input.assetId}/${winnerRevisionId}.mp4`,
      thumbnailKey: null,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      thumbnailBytes: 0,
      contentSha256: input.contentSha256,
      reservedBytes: input.sizeBytes,
      ticketExpiresAt: new Date(NOW.getTime() + 300_000),
      capacityBytes: grant.features.cloudStorageBytes,
      maxPending: MAX_PENDING_UPLOADS_PER_ACCOUNT,
    });
    if (winner.kind !== "reserved") throw new Error(winner.kind);

    // The application layer never sees a raw duplicate-key error: it resolves to the existing
    // revision instead of reserving a second one.
    const result = await createUploadIntent({
      assets,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    expect(result.revisionId).toBe(winnerRevisionId);
    expect(assets.revisions.size).toBe(1);
    expect((await assets.usage("u1")).reservedBytes).toBe(input.sizeBytes);
  });

  // Fix round 1 / I1: the test above never reaches the catch branch in create-upload-intent.ts —
  // its own findByIntentKey fast path already finds the winner and returns before `reserve` ever
  // runs. These two tests force the actual race window: the fast-path lookup misses (as it would
  // if the winner committed a moment later), `reserve` then hits the repository-level conflict,
  // and the catch branch is what resolves — or fails to resolve — the request.
  function withDeferredFirstLookup(fake: ReturnType<typeof makeFakeAssets>) {
    let calls = 0;
    const originalFindByIntentKey = fake.findByIntentKey;
    return {
      ...fake,
      async findByIntentKey(userId: string, intentKey: string) {
        calls += 1;
        if (calls === 1) return null; // pretend the winner hasn't committed yet
        return originalFindByIntentKey(userId, intentKey);
      },
    };
  }

  it("[race] resolves to the winner's revision when the fast-path lookup misses and reserve() then hits the duplicate", async () => {
    const input = intent();
    const winnerRevisionId = crypto.randomUUID();
    const winner = await assets.reserve({
      userId: "u1",
      assetId: input.assetId,
      intentKey: input.intentKey,
      revisionId: winnerRevisionId,
      kind: input.kind,
      title: input.title,
      durationSeconds: input.durationSeconds,
      derivedFromAssetId: input.derivedFromAssetId,
      storageKey: `videos/u1/${input.assetId}/${winnerRevisionId}.mp4`,
      thumbnailKey: null,
      contentType: input.contentType,
      sizeBytes: input.sizeBytes,
      thumbnailBytes: 0,
      contentSha256: input.contentSha256,
      reservedBytes: input.sizeBytes,
      ticketExpiresAt: new Date(NOW.getTime() + 300_000),
      capacityBytes: grant.features.cloudStorageBytes,
      maxPending: MAX_PENDING_UPLOADS_PER_ACCOUNT,
    });
    if (winner.kind !== "reserved") throw new Error(winner.kind);

    const raced = withDeferredFirstLookup(assets);
    const result = await createUploadIntent({
      assets: raced,
      access,
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    expect(result.revisionId).toBe(winnerRevisionId);
    expect(result.status).toBe("reserved");
    expect(assets.revisions.size).toBe(1); // no second reservation was created
    expect((await assets.usage("u1")).reservedBytes).toBe(input.sizeBytes); // counted once
  });

  it("[race] rethrows AssetConflictError when the repository-level conflict has no revision to resolve to", async () => {
    const input = intent();
    const conflicted: ReturnType<typeof makeFakeAssets> = {
      ...assets,
      async findByIntentKey() {
        return null; // no committed winner ever shows up (e.g. a tombstoned-asset conflict)
      },
      async reserve() {
        throw new AssetConflictError("simulated conflict with nothing to resume");
      },
    };
    await expect(
      createUploadIntent({
        assets: conflicted,
        access,
        storage,
        userId: "u1",
        entitlements: grant,
        input,
        now: NOW,
      }),
    ).rejects.toBeInstanceOf(AssetConflictError);
  });
});

describe("confirmUpload", () => {
  it("promotes only a matching object; mismatches leave the revision reserved", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    const key = assets.revisions.get(r.revisionId)!.storageKey;
    const args = {
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: r.revisionId,
      now: NOW,
    };

    await expect(confirmUpload(args)).rejects.toMatchObject({
      name: "UploadVerificationError",
      reason: "missing",
    });
    storage.land(key, { sizeBytes: 601, contentType: "video/mp4", checksumSha256: SHA });
    await expect(confirmUpload(args)).rejects.toMatchObject({ reason: "size" });
    storage.land(key, { sizeBytes: 600, contentType: "video/webm", checksumSha256: SHA });
    await expect(confirmUpload(args)).rejects.toMatchObject({ reason: "content-type" });
    storage.land(key, {
      sizeBytes: 600,
      contentType: "video/mp4",
      checksumSha256: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    });
    await expect(confirmUpload(args)).rejects.toMatchObject({ reason: "checksum" });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("reserved");

    storage.land(key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    const summary = await confirmUpload(args);
    expect(summary?.currentRevisionId).toBe(r.revisionId);
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 600,
      reservedBytes: 0,
      pendingUploads: 0,
    });
    // Idempotent: a second confirm does not double count.
    await confirmUpload(args);
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 600,
      reservedBytes: 0,
      pendingUploads: 0,
    });
  });

  it("returns null for a stranger", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    expect(
      await confirmUpload({
        assets,
        storage,
        userId: "u2",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: NOW,
      }),
    ).toBeNull();
  });

  // Fix round 1 / I3: our tickets always sign x-amz-checksum-sha256 and R2 returns it on HEAD, so
  // a null checksum means the object did not come through our ticket at all — reject it, don't
  // silently accept it as a match.
  it("rejects an object with no checksum (did not come through our ticket); the revision stays reserved", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    const key = assets.revisions.get(r.revisionId)!.storageKey;
    storage.land(key, { sizeBytes: 600, contentType: "video/mp4" }); // no checksumSha256
    await expect(
      confirmUpload({
        assets,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: NOW,
      }),
    ).rejects.toMatchObject({ name: "UploadVerificationError", reason: "checksum" });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("reserved");
  });
});

describe("cancelUpload", () => {
  it("releases the reservation, deletes a landed-but-unconfirmed object, and is idempotent", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    storage.land(assets.revisions.get(r.revisionId)!.storageKey, { sizeBytes: 600 });
    expect(
      await cancelUpload({
        assets,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: AFTER_WINDOW,
      }),
    ).toEqual({ released: true });
    expect(storage.objects.size).toBe(0);
    expect(
      await cancelUpload({
        assets,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: AFTER_WINDOW,
      }),
    ).toEqual({ released: false, reason: "not-reserved" });
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
  });

  // Fix round 1 / I2: confirmUpload winning the race must never lose its object to cancelUpload.
  it("never deletes the object once confirmUpload has won the race (the revision is already ready)", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input,
      now: NOW,
    });
    const key = assets.revisions.get(r.revisionId)!.storageKey;
    storage.land(key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    await confirmUpload({
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: r.revisionId,
      now: NOW,
    });
    expect(
      await cancelUpload({
        assets,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: AFTER_WINDOW,
      }),
    ).toEqual({ released: false, reason: "not-reserved" });
    expect(storage.objects.has(key)).toBe(true); // the ready asset's object survives
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 600,
      reservedBytes: 0,
      pendingUploads: 0,
    });
  });
});

describe("ticket window (re-PUT with a still-valid ticket)", () => {
  const WINDOW_MS = (UPLOAD_TICKET_TTL_SECONDS + RESERVATION_GRACE_SECONDS) * 1000;
  /** The instant the window of a revision reserved at NOW closes. */
  const CLOSES = new Date(NOW.getTime() + WINDOW_MS);
  const INSIDE = new Date(NOW.getTime() + 60_000);
  const AFTER = new Date(CLOSES.getTime() + 1000);

  async function reserve(
    at: Date = NOW,
    shared?: {
      assets: ReturnType<typeof makeFakeAssets>;
      storage: ReturnType<typeof makeFakeStorage>;
    },
  ) {
    const assets = shared?.assets ?? makeFakeAssets();
    const storage = shared?.storage ?? makeFakeStorage();
    const input = intent();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: roomy,
      input,
      now: at,
    });
    return { assets, storage, input, r, key: assets.revisions.get(r.revisionId)!.storageKey };
  }

  async function confirm(ctx: Awaited<ReturnType<typeof reserve>>, at: Date = NOW) {
    ctx.storage.land(ctx.key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    await confirmUpload({
      assets: ctx.assets,
      storage: ctx.storage,
      userId: "u1",
      assetId: ctx.input.assetId,
      revisionId: ctx.r.revisionId,
      now: at,
    });
  }

  function resumeAt(ctx: Awaited<ReturnType<typeof reserve>>, at: Date) {
    return createUploadIntent({
      assets: ctx.assets,
      access: makeFakeAccess(),
      storage: ctx.storage,
      userId: "u1",
      entitlements: roomy,
      input: ctx.input,
      now: at,
    });
  }

  it("is open one millisecond before expiry + grace and closed exactly at it", () => {
    const expires = new Date(NOW.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000);
    expect(ticketWindowClosed(expires, new Date(CLOSES.getTime() - 1))).toBe(false);
    expect(ticketWindowClosed(expires, CLOSES)).toBe(true);
    expect(ticketWindowClosesAt(expires)).toEqual(CLOSES);
    expect(ticketWindowCutoff(CLOSES)).toEqual(expires);
  });

  // Documented, not changed: the sweep lists `ticketExpiresAt < cutoff` (strict) while the
  // predicate is inclusive, so at the exact closing instant the sweep waits one more tick.
  // Neither side releases before the window closes, which is the property that matters.
  it("the sweep never releases before the window closes and lists the revision one tick after", async () => {
    const { assets, storage } = await reserve();
    const sweepAt = (ms: number) =>
      sweepExpiredReservations({
        assets,
        storage,
        now: new Date(CLOSES.getTime() + ms),
        limit: 10,
      });
    expect((await sweepAt(-1)).released).toBe(0);
    expect((await sweepAt(0)).released).toBe(0);
    expect((await sweepAt(1)).released).toBe(1);
  });

  it("cancelUpload inside the window keeps the reservation and the object; the sweep settles it later", async () => {
    const { assets, storage, input, r, key } = await reserve();
    storage.land(key, { sizeBytes: 600 });
    expect(
      await cancelUpload({
        assets,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: INSIDE,
      }),
    ).toEqual({ released: false, reason: "deferred", settlesAt: CLOSES });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("reserved");
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 0,
      reservedBytes: 600,
      pendingUploads: 1,
    });
    expect(storage.objects.has(key)).toBe(true);

    expect(await sweepExpiredReservations({ assets, storage, now: AFTER, limit: 10 })).toEqual({
      released: 1,
      deletedObjects: 1,
    });
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect(storage.objects.has(key)).toBe(false);
  });

  it("a sweep that runs before the window closes leaves a deferred cancel untouched", async () => {
    const { assets, storage, input, r, key } = await reserve();
    storage.land(key, { sizeBytes: 600 });
    await cancelUpload({
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: r.revisionId,
      now: INSIDE,
    });
    expect(
      await sweepExpiredReservations({
        assets,
        storage,
        now: new Date(CLOSES.getTime() - 1),
        limit: 10,
      }),
    ).toEqual({ released: 0, deletedObjects: 0 });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("reserved");
    expect(storage.objects.has(key)).toBe(true);
    expect((await assets.usage("u1")).reservedBytes).toBe(600);
  });

  it("a deferred cancel does not block resuming and confirming; the sweep never touches the ready revision", async () => {
    const ctx = await reserve();
    const { assets, storage, input, r, key } = ctx;
    await cancelUpload({
      assets,
      storage,
      userId: "u1",
      assetId: input.assetId,
      revisionId: r.revisionId,
      now: INSIDE,
    });
    expect(await resumeAt(ctx, INSIDE)).toMatchObject({
      revisionId: r.revisionId,
      status: "reserved",
    });
    await confirm(ctx, INSIDE);
    expect(assets.revisions.get(r.revisionId)?.status).toBe("ready");

    const farLater = new Date(AFTER.getTime() + WINDOW_MS);
    expect(await sweepExpiredReservations({ assets, storage, now: farLater, limit: 10 })).toEqual({
      released: 0,
      deletedObjects: 0,
    });
    expect(storage.objects.has(key)).toBe(true);
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 600,
      reservedBytes: 0,
      pendingUploads: 0,
    });
  });

  it("cancelUpload after the window closes releases and deletes", async () => {
    const { assets, storage, input, r, key } = await reserve();
    storage.land(key, { sizeBytes: 600 });
    expect(
      await cancelUpload({
        assets,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: AFTER,
      }),
    ).toEqual({ released: true });
    expect(storage.objects.has(key)).toBe(false);
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
  });

  // The window check reads the revision, then releases it in a second step. A resumed intent can
  // extend the ticket in between; the release must then fail, or a freshly signed ticket would
  // point at a key with nothing reserved behind it (F-1 again, through a race).
  it("[race] a resume that extends the ticket after cancel read the revision turns the release into a deferral", async () => {
    const ctx = await reserve();
    const { assets, storage, input, r, key } = ctx;
    storage.land(key, { sizeBytes: 600 });
    let resumed = false;
    const racing: typeof assets = {
      ...assets,
      async findRevision(userId, assetId, revisionId) {
        const stale = await assets.findRevision(userId, assetId, revisionId);
        if (!resumed) {
          resumed = true;
          await resumeAt(ctx, AFTER);
        }
        return stale;
      },
    };
    const extendedTo = new Date(AFTER.getTime() + UPLOAD_TICKET_TTL_SECONDS * 1000);
    expect(
      await cancelUpload({
        assets: racing,
        storage,
        userId: "u1",
        assetId: input.assetId,
        revisionId: r.revisionId,
        now: AFTER,
      }),
    ).toEqual({
      released: false,
      reason: "deferred",
      settlesAt: ticketWindowClosesAt(extendedTo),
    });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("reserved");
    expect(storage.objects.has(key)).toBe(true);
    expect((await assets.usage("u1")).reservedBytes).toBe(600);
  });

  it("[race] a resume that extends the ticket after the sweep listed the revision makes the claim a no-op", async () => {
    const ctx = await reserve();
    const { assets, storage, key } = ctx;
    storage.land(key, { sizeBytes: 600 });
    const racing: typeof assets = {
      ...assets,
      async listReservedExpiredBefore(before, limit) {
        const listed = await assets.listReservedExpiredBefore(before, limit);
        await resumeAt(ctx, AFTER);
        return listed;
      },
    };
    expect(
      await sweepExpiredReservations({ assets: racing, storage, now: AFTER, limit: 10 }),
    ).toEqual({ released: 0, deletedObjects: 0 });
    expect(storage.objects.has(key)).toBe(true);
    expect((await assets.usage("u1")).reservedBytes).toBe(600);
  });

  it("deleteCloudCopy inside the window hides the asset but defers the object delete and keeps quota", async () => {
    const ctx = await reserve();
    const { assets, storage, input, r, key } = ctx;
    await confirm(ctx);
    expect(
      await deleteCloudCopy({ assets, storage, userId: "u1", assetId: input.assetId, now: INSIDE }),
    ).toEqual({ deleted: true, physicallyRemoved: false, deferredUntil: CLOSES });
    expect(storage.objects.has(key)).toBe(true);
    expect(assets.revisions.get(r.revisionId)?.status).toBe("deleting");
    expect((await assets.usage("u1")).usedBytes).toBe(600);
    expect(
      (await listCloudAssets({ assets, userId: "u1", cursor: null, limit: 10 })).items,
    ).toHaveLength(0);

    // Too early for the retry job as well; it settles once the window has closed.
    expect(await retryPendingDeletes({ assets, storage, limit: 10, now: INSIDE })).toEqual({
      finished: 0,
      failed: 0,
    });
    expect(storage.objects.has(key)).toBe(true);
    expect(await retryPendingDeletes({ assets, storage, limit: 10, now: AFTER })).toEqual({
      finished: 1,
      failed: 0,
    });
    expect(storage.objects.has(key)).toBe(false);
    expect((await assets.usage("u1")).usedBytes).toBe(0);
  });

  it("deleteCloudCopy after the window closes removes the object at once", async () => {
    const ctx = await reserve();
    await confirm(ctx);
    expect(
      await deleteCloudCopy({
        assets: ctx.assets,
        storage: ctx.storage,
        userId: "u1",
        assetId: ctx.input.assetId,
        now: AFTER,
      }),
    ).toEqual({ deleted: true, physicallyRemoved: true, deferredUntil: null });
    expect(ctx.storage.objects.has(ctx.key)).toBe(false);
  });

  it("retryPendingDeletes is not starved by deferred deletes whose window is still open", async () => {
    // First: confirmed at NOW, deleted inside its window -> deferred, first in listing order.
    const first = await reserve();
    await confirm(first);
    await deleteCloudCopy({
      assets: first.assets,
      storage: first.storage,
      userId: "u1",
      assetId: first.input.assetId,
      now: INSIDE,
    });
    // Second: reserved long before, so its window is closed; its R2 delete failed.
    const longAgo = new Date(NOW.getTime() - WINDOW_MS - 60_000);
    const second = await reserve(longAgo, { assets: first.assets, storage: first.storage });
    await confirm(second, longAgo);
    first.storage.failDeletes = true;
    await deleteCloudCopy({
      assets: first.assets,
      storage: first.storage,
      userId: "u1",
      assetId: second.input.assetId,
      now: INSIDE,
    });
    first.storage.failDeletes = false;

    // limit 1: if the open-window revision filled the page, the settleable one would never run.
    expect(
      await retryPendingDeletes({
        assets: first.assets,
        storage: first.storage,
        limit: 1,
        now: INSIDE,
      }),
    ).toEqual({ finished: 1, failed: 0 });
    expect(first.storage.objects.has(second.key)).toBe(false);
    expect(first.storage.objects.has(first.key)).toBe(true);
    expect(first.assets.revisions.get(first.r.revisionId)?.status).toBe("deleting");
  });
});

describe("sweepOrphanObjects", () => {
  const AFTER = new Date(AFTER_WINDOW.getTime() + 60_000);
  const SINCE = new Date(0);

  async function reserved(
    assets: ReturnType<typeof makeFakeAssets>,
    storage: ReturnType<typeof makeFakeStorage>,
  ) {
    const input = intent({ thumbnail: { sizeBytes: 10, contentSha256: SHA } });
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: roomy,
      input,
      now: NOW,
    });
    const revision = assets.revisions.get(r.revisionId)!;
    return { input, r, key: revision.storageKey, thumb: revision.thumbnailKey! };
  }

  it("deletes a key that no revision names and keeps reserved, ready and deleting revisions' keys", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const pending = await reserved(assets, storage);
    storage.land(pending.key, { sizeBytes: 600 });
    storage.land(pending.thumb, { sizeBytes: 10 });

    const ready = await reserved(assets, storage);
    storage.land(ready.key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    storage.land(ready.thumb, { sizeBytes: 10 });
    await confirmUpload({
      assets,
      storage,
      userId: "u1",
      assetId: ready.input.assetId,
      revisionId: ready.r.revisionId,
      now: NOW,
    });

    const deleting = await reserved(assets, storage);
    storage.land(deleting.key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    storage.land(deleting.thumb, { sizeBytes: 10 });
    await confirmUpload({
      assets,
      storage,
      userId: "u1",
      assetId: deleting.input.assetId,
      revisionId: deleting.r.revisionId,
      now: NOW,
    });
    storage.failDeletes = true; // the physical delete fails, so the revision stays `deleting`
    await deleteCloudCopy({
      assets,
      storage,
      userId: "u1",
      assetId: deleting.input.assetId,
      now: AFTER,
    });
    storage.failDeletes = false;
    expect(assets.revisions.get(deleting.r.revisionId)?.status).toBe("deleting");

    const orphan = `videos/u1/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
    storage.land(orphan, { sizeBytes: 600 });

    expect(
      await sweepOrphanObjects({ assets, storage, now: AFTER, since: SINCE, accountLimit: 10 }),
    ).toEqual({ accounts: 1, deleted: 1, skipped: 0 });
    expect(storage.objects.has(orphan)).toBe(false);
    for (const key of [
      pending.key,
      pending.thumb,
      ready.key,
      ready.thumb,
      deleting.key,
      deleting.thumb,
    ]) {
      expect(storage.objects.has(key)).toBe(true);
    }
  });

  it("keeps an expired revision's object while its window is open and deletes it after", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const { r, key } = await reserved(assets, storage);
    // Signing failed and the reservation was handed back: `expired`, ticket expiry in the future.
    await assets.release("u1", r.revisionId);
    storage.land(key, { sizeBytes: 600 }); // should be impossible, but this sweep is the backstop

    const inside = new Date(NOW.getTime() + 60_000);
    expect(
      await sweepOrphanObjects({ assets, storage, now: inside, since: SINCE, accountLimit: 10 }),
    ).toEqual({ accounts: 1, deleted: 0, skipped: 1 });
    expect(storage.objects.has(key)).toBe(true);

    expect(
      await sweepOrphanObjects({ assets, storage, now: AFTER, since: SINCE, accountLimit: 10 }),
    ).toEqual({ accounts: 1, deleted: 1, skipped: 0 });
    expect(storage.objects.has(key)).toBe(false);
  });

  it("skips legacy recording keys (one segment after the account prefix)", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    await reserved(assets, storage); // creates the accounting row so the account is a candidate
    const legacy = `videos/u1/${crypto.randomUUID()}.mp4`;
    storage.land(legacy, { sizeBytes: 600 });
    expect(
      await sweepOrphanObjects({ assets, storage, now: AFTER, since: SINCE, accountLimit: 10 }),
    ).toEqual({ accounts: 1, deleted: 0, skipped: 1 });
    expect(storage.objects.has(legacy)).toBe(true);
  });

  it("never deletes an object that lands after the listing (lists storage before revisions)", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    // Build a reservation, then take its row out so the hook can put it back at the worst moment.
    const late = await reserved(assets, storage);
    const row = assets.revisions.get(late.r.revisionId)!;
    assets.revisions.delete(late.r.revisionId);
    // While the sweep is between its storage listing and its revision lookup, the reservation's
    // row is inserted and its object lands. A sweep that looked revisions up first and listed
    // storage second would see the object without a row and delete a live upload.
    storage.afterList = () => {
      if (assets.revisions.has(row.revisionId)) return;
      assets.revisions.set(row.revisionId, row);
      storage.land(late.key, { sizeBytes: 600 });
    };
    const result = await sweepOrphanObjects({
      assets,
      storage,
      now: AFTER,
      since: SINCE,
      accountLimit: 10,
    });
    storage.afterList = null;
    expect(result.deleted).toBe(0);
    expect(storage.objects.has(late.key)).toBe(true);
  });

  it("is idempotent and bounded by accountLimit", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    await reserved(assets, storage);
    storage.land(`img/u1/${crypto.randomUUID()}/${crypto.randomUUID()}.png`, { sizeBytes: 1 });
    expect(
      await sweepOrphanObjects({ assets, storage, now: AFTER, since: SINCE, accountLimit: 10 }),
    ).toMatchObject({ deleted: 1 });
    expect(
      await sweepOrphanObjects({ assets, storage, now: AFTER, since: SINCE, accountLimit: 10 }),
    ).toMatchObject({ deleted: 0 });
    expect(
      await sweepOrphanObjects({ assets, storage, now: AFTER, since: SINCE, accountLimit: 0 }),
    ).toEqual({ accounts: 0, deleted: 0, skipped: 0 });
  });
});

describe("list / download / delete / usage", () => {
  async function readyAsset(
    assets: ReturnType<typeof makeFakeAssets>,
    storage: ReturnType<typeof makeFakeStorage>,
    userId: string,
    size = 100,
  ) {
    const input = intent({ sizeBytes: size });
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId,
      entitlements: grant,
      input,
      now: NOW,
    });
    storage.land(assets.revisions.get(r.revisionId)!.storageKey, {
      sizeBytes: size,
      contentType: "video/mp4",
      checksumSha256: SHA,
    });
    await confirmUpload({
      assets,
      storage,
      userId,
      assetId: input.assetId,
      revisionId: r.revisionId,
      now: NOW,
    });
    return input.assetId;
  }

  it("lists only ready assets of the caller, paginated", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    await readyAsset(assets, storage, "u1");
    await readyAsset(assets, storage, "u1");
    await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent({ sizeBytes: 10 }),
      now: NOW,
    });
    await readyAsset(assets, storage, "u2");
    const page = await listCloudAssets({ assets, userId: "u1", cursor: null, limit: 1 });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const rest = await listCloudAssets({
      assets,
      userId: "u1",
      cursor: page.nextCursor,
      limit: 10,
    });
    expect(rest.items).toHaveLength(1);
    expect(rest.nextCursor).toBeNull();
  });

  it("signs a download for the owner's ready revision only", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const assetId = await readyAsset(assets, storage, "u1");
    expect(await getAssetDownloadUrl({ assets, storage, userId: "u2", assetId })).toBeNull();
    const dl = await getAssetDownloadUrl({ assets, storage, userId: "u1", assetId });
    expect(dl?.downloadUrl).toContain("sig=down");
    expect(dl?.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it("deleteCloudCopy: hides first; an R2 failure is not an error and leaves it deleting for the cron", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const assetId = await readyAsset(assets, storage, "u1");
    storage.failDeletes = true;
    expect(
      await deleteCloudCopy({ assets, storage, userId: "u1", assetId, now: AFTER_WINDOW }),
    ).toEqual({
      deleted: true,
      physicallyRemoved: false,
      deferredUntil: null,
    });
    expect(
      (await listCloudAssets({ assets, userId: "u1", cursor: null, limit: 10 })).items,
    ).toHaveLength(0);
    const rev = [...assets.revisions.values()][0]!;
    expect(rev.status).toBe("deleting");
    expect((await assets.usage("u1")).usedBytes).toBe(100); // still counted until physically gone
    storage.failDeletes = false;
    expect(await retryPendingDeletes({ assets, storage, limit: 10, now: AFTER_WINDOW })).toEqual({
      finished: 1,
      failed: 0,
    });
    expect((await assets.usage("u1")).usedBytes).toBe(0);
    expect((await assets.findAsset("u1", assetId))?.asset.autoUploadExcluded).toBe(true);
    // Repeating the delete is a no-op that changes nothing.
    expect(
      await deleteCloudCopy({ assets, storage, userId: "u1", assetId, now: AFTER_WINDOW }),
    ).toEqual({
      deleted: false,
      physicallyRemoved: false,
      deferredUntil: null,
    });
    expect((await assets.usage("u1")).usedBytes).toBe(0);
  });

  it("deleteCloudCopy removes the object at once when R2 is healthy", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const assetId = await readyAsset(assets, storage, "u1");
    expect(
      await deleteCloudCopy({ assets, storage, userId: "u1", assetId, now: AFTER_WINDOW }),
    ).toEqual({
      deleted: true,
      physicallyRemoved: true,
      deferredUntil: null,
    });
    expect((await assets.usage("u1")).usedBytes).toBe(0);
  });

  it("usage reports capacity, committed space and switches", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const access = makeFakeAccess({ uploadsEnabled: false });
    await readyAsset(assets, storage, "u1", 300);
    await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent({ sizeBytes: 200 }),
      now: NOW,
    });
    expect(await getStorageUsage({ assets, access, userId: "u1", entitlements: grant })).toEqual({
      capacityBytes: 1000,
      usedBytes: 300,
      reservedBytes: 200,
      availableBytes: 500,
      pendingUploads: 1,
      uploadsEnabled: false,
      cloudUploads: true,
    });
  });
});

describe("sweeps", () => {
  it("releases reservations whose ticket expired past the grace period and removes stray objects", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent(),
      now: NOW,
    });
    storage.land(assets.revisions.get(r.revisionId)!.storageKey, { sizeBytes: 600 });
    const tooEarly = await sweepExpiredReservations({
      assets,
      storage,
      now: new Date(NOW.getTime() + 20 * 60_000),
      limit: 10,
    });
    expect(tooEarly.released).toBe(0);
    // Eligible only once the ticket has been expired for longer than the grace period, i.e.
    // past (ticket TTL + grace) after the reservation was made.
    const late = await sweepExpiredReservations({
      assets,
      storage,
      now: new Date(
        NOW.getTime() + (UPLOAD_TICKET_TTL_SECONDS + RESERVATION_GRACE_SECONDS + 60) * 1000,
      ),
      limit: 10,
    });
    expect(late).toEqual({ released: 1, deletedObjects: 1 });
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
    expect(assets.revisions.get(r.revisionId)?.status).toBe("expired");
  });

  // Fix round 1 / I2: same guarantee as cancelUpload — a revision confirmUpload already promoted
  // to `ready` is invisible to the sweep (it is no longer `reserved`), so its object is untouched
  // even though its ticket is long past the grace period.
  it("never touches a revision or its object once confirmUpload has won the race, even past the grace period", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const r = await createUploadIntent({
      assets,
      access: makeFakeAccess(),
      storage,
      userId: "u1",
      entitlements: grant,
      input: intent(),
      now: NOW,
    });
    const key = assets.revisions.get(r.revisionId)!.storageKey;
    storage.land(key, { sizeBytes: 600, contentType: "video/mp4", checksumSha256: SHA });
    await confirmUpload({
      assets,
      storage,
      userId: "u1",
      assetId: r.asset.assetId,
      revisionId: r.revisionId,
      now: NOW,
    });

    const result = await sweepExpiredReservations({
      assets,
      storage,
      now: new Date(
        NOW.getTime() + (UPLOAD_TICKET_TTL_SECONDS + RESERVATION_GRACE_SECONDS + 60) * 1000,
      ),
      limit: 10,
    });
    expect(result).toEqual({ released: 0, deletedObjects: 0 });
    expect(storage.objects.has(key)).toBe(true);
    expect(assets.revisions.get(r.revisionId)?.status).toBe("ready");
    expect(await assets.usage("u1")).toEqual({
      usedBytes: 600,
      reservedBytes: 0,
      pendingUploads: 0,
    });
  });

  it("purges every object under a deleted account's prefixes and retries bounded times", async () => {
    const storage = makeFakeStorage();
    const purge = makeFakePurge();
    storage.land("videos/gone/a/r.mp4", { sizeBytes: 1 });
    storage.land("img/gone/b/r.png", { sizeBytes: 1 });
    storage.land("videos/other/a/r.mp4", { sizeBytes: 1 });
    await purge.enqueue("gone");
    storage.failDeletes = true;
    expect(await purgeAccountObjects({ purge, storage, limit: 5, maxAttempts: 3 })).toEqual({
      done: 0,
      failed: 1,
    });
    storage.failDeletes = false;
    expect(await purgeAccountObjects({ purge, storage, limit: 5, maxAttempts: 3 })).toEqual({
      done: 1,
      failed: 0,
    });
    expect([...storage.objects.keys()]).toEqual(["videos/other/a/r.mp4"]);
  });
});
