import type { ICloudPurgeRepository } from "@kaipu/domain/repositories";
import { describe, expect, it, vi } from "vitest";
import { enqueuePurgeBeforeUserDelete } from "./account-deletion";

const purgeWith = (enqueue: ICloudPurgeRepository["enqueue"]): ICloudPurgeRepository => ({
  enqueue,
  nextPending: vi.fn(),
  markAttempt: vi.fn(),
  markDone: vi.fn(),
});

describe("enqueuePurgeBeforeUserDelete", () => {
  it("queues a purge job for the user being deleted", async () => {
    const enqueue = vi.fn(async () => {});
    await enqueuePurgeBeforeUserDelete(purgeWith(enqueue))({ id: "user-1" });
    expect(enqueue).toHaveBeenCalledWith("user-1");
  });

  it("propagates an enqueue failure so the deletion is aborted", async () => {
    const enqueue = vi.fn(async () => {
      throw new Error("db down");
    });
    await expect(
      enqueuePurgeBeforeUserDelete(purgeWith(enqueue))({ id: "user-1" }),
    ).rejects.toThrow("db down");
  });
});
