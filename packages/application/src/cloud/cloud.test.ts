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

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const NOW = new Date("2026-09-10T12:00:00Z");
const grant: Entitlements = {
  ...FREE_ENTITLEMENTS,
  features: { ...FREE_ENTITLEMENTS.features, cloudUploads: true, cloudStorageBytes: 1000 },
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
      }),
    ).toEqual({ released: false });
    expect(await assets.usage("u1")).toEqual({ usedBytes: 0, reservedBytes: 0, pendingUploads: 0 });
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
    expect(await deleteCloudCopy({ assets, storage, userId: "u1", assetId })).toEqual({
      deleted: true,
      physicallyRemoved: false,
    });
    expect(
      (await listCloudAssets({ assets, userId: "u1", cursor: null, limit: 10 })).items,
    ).toHaveLength(0);
    const rev = [...assets.revisions.values()][0]!;
    expect(rev.status).toBe("deleting");
    expect((await assets.usage("u1")).usedBytes).toBe(100); // still counted until physically gone
    storage.failDeletes = false;
    expect(await retryPendingDeletes({ assets, storage, limit: 10 })).toEqual({
      finished: 1,
      failed: 0,
    });
    expect((await assets.usage("u1")).usedBytes).toBe(0);
    expect((await assets.findAsset("u1", assetId))?.asset.autoUploadExcluded).toBe(true);
    // Repeating the delete is a no-op that changes nothing.
    expect(await deleteCloudCopy({ assets, storage, userId: "u1", assetId })).toEqual({
      deleted: false,
      physicallyRemoved: false,
    });
    expect((await assets.usage("u1")).usedBytes).toBe(0);
  });

  it("deleteCloudCopy removes the object at once when R2 is healthy", async () => {
    const assets = makeFakeAssets();
    const storage = makeFakeStorage();
    const assetId = await readyAsset(assets, storage, "u1");
    expect(await deleteCloudCopy({ assets, storage, userId: "u1", assetId })).toEqual({
      deleted: true,
      physicallyRemoved: true,
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
