import { describe, expect, it } from "vitest";

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
});
