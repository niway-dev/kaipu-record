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
