import type { ICloudAssetRepository, ICloudPurgeRepository } from "@kaipu/domain/repositories";
import type { IStorageService } from "@kaipu/domain/services";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PURGE_BATCH, runScheduledJobs, SWEEP_BATCH } from "./run-scheduled-jobs";

function makeDeps(overrides: { assets?: Partial<ICloudAssetRepository> } = {}) {
  const assets = {
    listReservedExpiredBefore: vi.fn(async () => []),
    listDeleting: vi.fn(async () => []),
    ...overrides.assets,
  } as unknown as ICloudAssetRepository;
  const purge = {
    nextPending: vi.fn(async () => []),
  } as unknown as ICloudPurgeRepository;
  return { assets, purge, storage: {} as IStorageService, now: new Date("2026-10-12T00:00:00Z") };
}

const events = (spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] =>
  spy.mock.calls.map((c) => JSON.parse(String(c[0])) as Record<string, unknown>);

afterEach(() => vi.restoreAllMocks());

describe("runScheduledJobs", () => {
  it("runs the three jobs with bounded batches and logs one summary", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeDeps();
    await runScheduledJobs(deps);
    expect(deps.assets.listReservedExpiredBefore).toHaveBeenCalledWith(
      expect.any(Date),
      SWEEP_BATCH,
    );
    expect(deps.assets.listDeleting).toHaveBeenCalled();
    expect(deps.purge.nextPending).toHaveBeenCalledWith(PURGE_BATCH);
    const sweep = events(log).filter((e) => e.name === "cloud.sweep");
    expect(sweep).toHaveLength(1);
    expect(sweep[0]).toMatchObject({ released: 0, finishedDeletes: 0, purged: 0 });
  });

  it("isolates a failing job: the others still run and the failure is named", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = makeDeps({
      assets: {
        listReservedExpiredBefore: vi.fn(async () => {
          throw new Error("neon down");
        }),
      },
    });
    await runScheduledJobs(deps);
    expect(deps.assets.listDeleting).toHaveBeenCalled();
    expect(deps.purge.nextPending).toHaveBeenCalled();
    const failed = events(log).filter((e) => e.name === "cloud.sweep.failed");
    expect(failed).toEqual([
      expect.objectContaining({ job: "sweep-expired-reservations", error: "Error" }),
    ]);
  });

  it("reports every job as failed, and touches nothing, when storage is not configured", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const deps = { ...makeDeps(), storage: null };
    await runScheduledJobs(deps);
    expect(deps.assets.listReservedExpiredBefore).not.toHaveBeenCalled();
    expect(events(log).filter((e) => e.name === "cloud.sweep.failed")).toHaveLength(3);
  });
});
