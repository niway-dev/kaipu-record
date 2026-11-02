import { afterEach, describe, expect, it, vi } from "vitest";
import { requestUploadIntent, type UploadIntentRequest } from "./upload-intent-client";

const request: UploadIntentRequest = {
  assetId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  intentKey: "9b2c1f3e-1111-4222-8333-444455556666",
  kind: "recording",
  title: "Demo",
  contentType: "video/mp4",
  sizeBytes: 10,
  contentSha256: "47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=",
  durationSeconds: 1,
  derivedFromAssetId: null,
  thumbnail: null,
  workspaceId: "0192f1c2-7a3b-7c4d-8e5f-001122334455",
};

describe("requestUploadIntent", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends the workspace the item lives in with every upload intent", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ data: { revisionId: "r" } }), { status: 201 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(await requestUploadIntent({ serverUrl: "http://api.test" }, "tok", request)).toEqual({
      revisionId: "r",
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("http://api.test/api/v1/assets/upload-intents");
    expect(JSON.parse(String(init.body))).toMatchObject({
      workspaceId: "0192f1c2-7a3b-7c4d-8e5f-001122334455",
    });
  });

  it("rejects 401 as unauthorized and any other failure with its status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 401 })),
    );
    await expect(requestUploadIntent({ serverUrl: "x" }, "t", request)).rejects.toEqual({
      kind: "unauthorized",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 409 })),
    );
    await expect(requestUploadIntent({ serverUrl: "x" }, "t", request)).rejects.toEqual({
      kind: "rejected",
      status: 409,
    });
  });
});
