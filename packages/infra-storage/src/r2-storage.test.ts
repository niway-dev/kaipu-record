import { afterEach, describe, expect, it, vi } from "vitest";

import { createR2Storage } from "./r2-storage";

const storage = createR2Storage({
  accountId: "acct123",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secretEXAMPLE",
  bucket: "kaipu-recordings",
});

describe("createR2Storage presigning", () => {
  it("presigns a PUT to the account endpoint, bucket and key", async () => {
    const url = await storage.createUploadUrl("recordings/u1/r1.webm");
    const parsed = new URL(url);

    expect(parsed.host).toBe("acct123.r2.cloudflarestorage.com");
    expect(parsed.pathname).toBe("/kaipu-recordings/recordings/u1/r1.webm");
    // SigV4 query auth markers.
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(parsed.searchParams.get("X-Amz-Credential")).toContain("/auto/s3/aws4_request");
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
  });

  it("honors a custom expiry", async () => {
    const url = await storage.createDownloadUrl("recordings/u1/r1.webm", {
      expiresInSeconds: 60,
    });
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("60");
  });

  it("produces different signatures for PUT vs GET on the same key", async () => {
    const put = await storage.createUploadUrl("recordings/u1/r1.webm");
    const get = await storage.createDownloadUrl("recordings/u1/r1.webm");
    expect(new URL(put).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(get).searchParams.get("X-Amz-Signature"),
    );
  });

  it("binds the PUT to the given content type", async () => {
    const url = await storage.createUploadUrl("recordings/u1/r1.webm", {
      contentType: "video/webm",
    });
    const parsed = new URL(url);

    // "content-type" is only a signable header when explicitly bound.
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
  });

  it("does not sign content-type when none is given", async () => {
    const url = await storage.createUploadUrl("recordings/u1/r1.webm");
    const parsed = new URL(url);

    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).not.toContain("content-type");
  });
});

describe("createR2Storage.objectExists", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns true on a 200/HEAD-ok response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(storage.objectExists("recordings/u1/r1.webm")).resolves.toBe(true);
  });

  it("returns false on a 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(storage.objectExists("recordings/u1/r1.webm")).resolves.toBe(false);
  });

  it("throws on an unexpected error status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 500, statusText: "Boom" })),
    );
    // aws4fetch's AwsClient retries 5xx responses with `Math.random() * backoff`
    // sleeps before giving up — pin the random factor to 0 so those sleeps
    // resolve immediately instead of the test waiting through them for real.
    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      await expect(storage.objectExists("recordings/u1/r1.webm")).rejects.toThrow(/500/);
    } finally {
      randomSpy.mockRestore();
    }
  });
});

describe("createR2Storage.createUploadTicket", () => {
  it("signs content-length, content-type, if-none-match and the sha256 checksum", async () => {
    const ticket = await storage.createUploadTicket("videos/u1/a1/r1.mp4", {
      contentType: "video/mp4",
      contentLength: 1234,
      checksumSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
      expiresInSeconds: 900,
    });
    const parsed = new URL(ticket.url);
    const signed = parsed.searchParams.get("X-Amz-SignedHeaders") ?? "";
    for (const h of ["content-length", "content-type", "if-none-match", "x-amz-checksum-sha256"]) {
      expect(signed).toContain(h);
    }
    expect(ticket.headers).toEqual({
      "content-type": "video/mp4",
      "content-length": "1234",
      "if-none-match": "*",
      "x-amz-checksum-sha256": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(ticket.expiresAt.getTime()).toBeGreaterThan(Date.now() + 800_000);
  });
});

describe("createR2Storage.headObject", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses size, type, etag and checksum from a HEAD response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(null, {
          status: 200,
          headers: {
            "content-length": "1234",
            "content-type": "video/mp4",
            etag: '"abc"',
            "x-amz-checksum-sha256": "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
          },
        }),
      ),
    );
    await expect(storage.headObject("videos/u1/a1/r1.mp4")).resolves.toEqual({
      sizeBytes: 1234,
      contentType: "video/mp4",
      etag: '"abc"',
      checksumSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
    });
    // The checksum is only returned when the request asks for it.
    // `AwsClient.fetch` signs the request into a single `Request` object before
    // calling global `fetch(request)` — there is no separate `init` argument.
    const request = vi.mocked(fetch).mock.calls[0]?.[0] as Request;
    expect(request.headers.get("x-amz-checksum-mode")).toBe("ENABLED");
  });

  it("returns null on 404", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 404 })));
    await expect(storage.headObject("k")).resolves.toBeNull();
  });
});

describe("createR2Storage.listObjectKeys", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses ListObjectsV2 keys and the continuation token", async () => {
    const xml = `<?xml version="1.0"?><ListBucketResult><IsTruncated>true</IsTruncated>
      <NextContinuationToken>tok&amp;1</NextContinuationToken>
      <Contents><Key>videos/u1/a1/r1.mp4</Key></Contents><Contents><Key>videos/u1/a1/r1.thumb.jpg</Key></Contents>
      </ListBucketResult>`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml, { status: 200 })));
    await expect(storage.listObjectKeys("videos/u1/")).resolves.toEqual({
      keys: ["videos/u1/a1/r1.mp4", "videos/u1/a1/r1.thumb.jpg"],
      nextCursor: "tok&1",
    });
    // Same signed-`Request` shape as above: read the URL off the request, not a
    // separate first-argument string.
    const request = vi.mocked(fetch).mock.calls[0]?.[0] as Request;
    const url = new URL(request.url);
    expect(url.searchParams.get("list-type")).toBe("2");
    expect(url.searchParams.get("prefix")).toBe("videos/u1/");
  });
});
