import { describe, expect, it, vi } from "vitest";
import type { StorageUsage } from "@shared/types/cloud-storage";
import { StorageUsageService } from "./storage-usage-service";

const USAGE: StorageUsage = {
  capacityBytes: 1_000_000_000,
  usedBytes: 100,
  reservedBytes: 0,
  availableBytes: 999_999_900,
  pendingUploads: 0,
  uploadsEnabled: true,
  cloudUploads: true,
};

function service(opts: {
  account?: { userId: string; token: string } | null;
  fetchUsage: (token: string) => Promise<StorageUsage>;
}) {
  let account = opts.account === undefined ? { userId: "u1", token: "t1" } : opts.account;
  const svc = new StorageUsageService({
    account: () => account,
    fetchUsage: opts.fetchUsage,
    now: () => 42,
  });
  return { svc, setAccount: (a: typeof account) => (account = a) };
}

describe("StorageUsageService", () => {
  it("is signed-out without an account and never fetches", async () => {
    const fetchUsage = vi.fn();
    const { svc } = service({ account: null, fetchUsage });
    await expect(svc.get()).resolves.toEqual({ kind: "signed-out" });
    expect(fetchUsage).not.toHaveBeenCalled();
  });

  it("returns ok with the fetch time", async () => {
    const { svc } = service({ fetchUsage: async () => USAGE });
    await expect(svc.get()).resolves.toEqual({ kind: "ok", usage: USAGE, fetchedAt: 42 });
  });

  it("is an error, not zeros, when the first query fails", async () => {
    const { svc } = service({ fetchUsage: async () => Promise.reject(new Error("offline")) });
    await expect(svc.get()).resolves.toEqual({ kind: "error" });
  });

  it("falls back to the last good answer, marked stale", async () => {
    const fetchUsage = vi
      .fn()
      .mockResolvedValueOnce(USAGE)
      .mockRejectedValueOnce(new Error("offline"));
    const { svc } = service({ fetchUsage });
    await svc.get();
    await expect(svc.get()).resolves.toEqual({ kind: "stale", usage: USAGE, fetchedAt: 42 });
  });

  it("never shows one account's cached numbers to another", async () => {
    const fetchUsage = vi
      .fn()
      .mockResolvedValueOnce(USAGE)
      .mockRejectedValueOnce(new Error("offline"));
    const { svc, setAccount } = service({ fetchUsage });
    await svc.get();
    setAccount({ userId: "u2", token: "t2" });
    await expect(svc.get()).resolves.toEqual({ kind: "error" });
  });

  it("reports not-available when the server has no storage endpoint", async () => {
    const { svc } = service({ fetchUsage: () => Promise.reject({ kind: "not-available" }) });
    await expect(svc.get()).resolves.toEqual({ kind: "not-available" });
  });

  it("reports an expired session on 401 and forgets that account's cache", async () => {
    const fetchUsage = vi
      .fn()
      .mockResolvedValueOnce(USAGE)
      .mockRejectedValueOnce({ kind: "unauthorized" })
      .mockRejectedValueOnce(new Error("offline"));
    const { svc } = service({ fetchUsage });
    await svc.get();
    await expect(svc.get()).resolves.toEqual({ kind: "session-expired" });
    await expect(svc.get()).resolves.toEqual({ kind: "error" });
  });
});
