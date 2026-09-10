import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCloudCatalog } from "./catalog-client";

const SHA = "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=";
const config = { serverUrl: "http://localhost:3000" };

function page(items: unknown[], nextCursor: string | null): Response {
  return new Response(JSON.stringify({ data: { items, nextCursor }, error: null }), {
    status: 200,
  });
}

const ready = (assetId: string, overrides: Record<string, unknown> = {}) => ({
  assetId,
  kind: "recording",
  title: "T",
  currentRevisionId: "r1",
  contentType: "video/mp4",
  sizeBytes: 10,
  contentSha256: SHA,
  durationSeconds: 3,
  hasThumbnail: false,
  derivedFromAssetId: null,
  autoUploadExcluded: false,
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
  ...overrides,
});

describe("fetchCloudCatalog", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("follows cursors, sends the bearer token, and maps ISO dates to epoch ms", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([ready("a")], "c1"))
      .mockResolvedValueOnce(page([ready("b")], null));
    vi.stubGlobal("fetch", fetchMock);

    const entries = await fetchCloudCatalog(config, "tok", 999);
    expect(entries.map((e) => e.assetId)).toEqual(["a", "b"]);
    expect(entries[0]).toMatchObject({
      revisionId: "r1",
      createdAt: Date.parse("2026-09-10T00:00:00.000Z"),
      lastVerifiedAt: 999,
      lastSeenLocalId: null,
    });
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toBe("http://localhost:3000/api/v1/assets?limit=100&cursor=c1");
    expect(new Headers((init as RequestInit).headers).get("authorization")).toBe("Bearer tok");
  });

  it("skips assets whose only revision is not ready yet", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          page(
            [ready("a", { currentRevisionId: null, sizeBytes: null, contentSha256: null })],
            null,
          ),
        ),
    );
    expect(await fetchCloudCatalog(config, "tok")).toEqual([]);
  });

  it("rejects on 401 with a typed error, and on any other failure — never resolves to []", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(fetchCloudCatalog(config, "tok")).rejects.toEqual({ kind: "unauthorized" });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(fetchCloudCatalog(config, "tok")).rejects.toBeInstanceOf(TypeError);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 500 })));
    await expect(fetchCloudCatalog(config, "tok")).rejects.toThrow(/500/);
  });
});
