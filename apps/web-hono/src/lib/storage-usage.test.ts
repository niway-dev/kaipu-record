import { describe, expect, it } from "vitest";
import { toCapacityView } from "@kaipu/domain/capacity";
import { orpcError, STORAGE } from "@/test/fixtures/account";
import { classifyStorageError, toStorageResult } from "./storage-usage";

const idle = { data: undefined, error: null, isError: false, dataUpdatedAt: 0 };

describe("classifyStorageError", () => {
  it("separates an expired session, a missing endpoint and a fault", () => {
    expect(classifyStorageError(orpcError(401))).toBe("session-expired");
    expect(classifyStorageError(orpcError(404))).toBe("not-available");
    expect(classifyStorageError(orpcError(500))).toBe("error");
    expect(classifyStorageError(orpcError(503))).toBe("error");
  });

  it("treats a network failure or a malformed answer (no status) as a fault", () => {
    expect(classifyStorageError(new TypeError("Failed to fetch"))).toBe("error");
    expect(classifyStorageError(null)).toBe("error");
  });
});

describe("toStorageResult", () => {
  it("is not answered until the first response arrives", () => {
    expect(toStorageResult(idle)).toBeNull();
  });

  it("reports a successful answer with its fetch time", () => {
    expect(toStorageResult({ ...idle, data: STORAGE.usage, dataUpdatedAt: 7 })).toEqual({
      kind: "ok",
      usage: STORAGE.usage,
      fetchedAt: 7,
    });
  });

  it("never carries numbers for a failure with no earlier answer", () => {
    for (const status of [401, 404, 500]) {
      const result = toStorageResult({ ...idle, isError: true, error: orpcError(status) });
      expect(result).not.toBeNull();
      expect(result).not.toHaveProperty("usage");
    }
    expect(toStorageResult({ ...idle, isError: true, error: new Error("boom") })).toEqual({
      kind: "error",
    });
  });

  it("keeps the last numbers, marked stale, when a refetch fails", () => {
    const result = toStorageResult({
      data: STORAGE.usage,
      isError: true,
      error: orpcError(500),
      dataUpdatedAt: 9,
    });
    expect(result).toEqual({ kind: "stale", usage: STORAGE.usage, fetchedAt: 9 });
    expect(toCapacityView(result)).toMatchObject({ kind: "usage", staleSince: 9 });
  });

  it("drops the old numbers once the session has expired", () => {
    expect(
      toStorageResult({
        data: STORAGE.usage,
        isError: true,
        error: orpcError(401),
        dataUpdatedAt: 9,
      }),
    ).toEqual({ kind: "session-expired" });
  });
});
