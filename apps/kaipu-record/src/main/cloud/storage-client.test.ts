import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchStorageUsage } from "./storage-client";

const config = { serverUrl: "http://localhost:3000" };
const USAGE = {
  capacityBytes: 1_000_000_000,
  usedBytes: 610_000_000,
  reservedBytes: 130_000_000,
  availableBytes: 260_000_000,
  pendingUploads: 1,
  uploadsEnabled: true,
  cloudUploads: true,
};

function reply(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchStorageUsage", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the bearer token and returns the usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(reply({ data: USAGE, error: null }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchStorageUsage(config, "tok")).resolves.toEqual(USAGE);
    expect(fetchMock.mock.calls[0]![0]).toBe("http://localhost:3000/api/v1/me/storage");
    expect(fetchMock.mock.calls[0]![1].headers).toEqual({ Authorization: "Bearer tok" });
  });

  it("rejects with unauthorized on 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({}, 401)));
    await expect(fetchStorageUsage(config, "tok")).rejects.toEqual({ kind: "unauthorized" });
  });

  it("rejects with not-available on 404 (server without cloud storage)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({}, 404)));
    await expect(fetchStorageUsage(config, "tok")).rejects.toEqual({ kind: "not-available" });
  });

  it("rejects on a server error instead of returning zeros", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({}, 500)));
    await expect(fetchStorageUsage(config, "tok")).rejects.toThrow("500");
  });

  it("rejects a body with missing or negative fields", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(reply({ data: { ...USAGE, usedBytes: -1 }, error: null })),
    );
    await expect(fetchStorageUsage(config, "tok")).rejects.toThrow("invalid body");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ data: null, error: null })));
    await expect(fetchStorageUsage(config, "tok")).rejects.toThrow("invalid body");
  });
});
