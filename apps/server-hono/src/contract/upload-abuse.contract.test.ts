import { encodeAssetCursor } from "@kaipu/domain/schemas";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { implement } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { cloudContract, recordingContract } from "./index";

/**
 * NIW2-323 (F-2, F-9) at the HTTP boundary. The real routers open a database client at import
 * time, so this mounts the REAL contracts behind stub handlers: routing and input validation are
 * exactly what production runs, only the handler bodies are fake.
 */
const contract = { recording: recordingContract, cloud: { list: cloudContract.list } };
const impl = implement(contract);
let listCalls = 0;
const router = impl.router({
  recording: {
    list: impl.recording.list.handler(() => ({ data: [], error: null })),
    downloadUrl: impl.recording.downloadUrl.handler(() => {
      throw new Error("not used");
    }),
    delete: impl.recording.delete.handler(() => ({ data: { success: true }, error: null })),
  },
  cloud: {
    list: impl.cloud.list.handler(() => {
      listCalls += 1;
      return { data: { items: [], nextCursor: null }, error: null };
    }),
  },
});
const handler = new OpenAPIHandler(router);

async function call(method: string, path: string, body?: unknown) {
  const request = new Request(`http://api.test/api/v1${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const { matched, response } = await handler.handle(request, { prefix: "/api/v1", context: {} });
  // Mirrors index.ts: an unmatched route falls through to Hono's 404.
  return matched && response ? response.status : 404;
}

describe("F-2: the legacy recordings upload routes are gone", () => {
  it("POST /recordings and POST /recordings/{id}/confirm do not match any route", async () => {
    expect(await call("POST", "/recordings", { filename: "a.mp4", contentType: "video/mp4" })).toBe(
      404,
    );
    expect(await call("POST", `/recordings/${crypto.randomUUID()}/confirm`)).toBe(404);
    expect(Object.keys(recordingContract).sort()).toEqual(["delete", "downloadUrl", "list"]);
  });

  it("the read and delete routes the web dashboard uses still answer", async () => {
    expect(await call("GET", "/recordings")).toBe(200);
    expect(await call("DELETE", `/recordings/${crypto.randomUUID()}`)).toBe(200);
  });
});

describe("F-9: the asset-list cursor is validated before any handler runs", () => {
  it("rejects a cursor the repository could not have issued with 400", async () => {
    listCalls = 0;
    for (const cursor of [
      "garbage!",
      btoa("1760000000000:not-a-uuid"),
      btoa(`99999999999999999999:${crypto.randomUUID()}`).replace(/=+$/, ""),
      "A".repeat(300),
    ]) {
      expect(await call("GET", `/assets?cursor=${encodeURIComponent(cursor)}`), cursor).toBe(400);
    }
    expect(listCalls).toBe(0);
  });

  it("accepts a cursor produced by the shared encoder, and no cursor at all", async () => {
    const cursor = encodeAssetCursor(new Date("2026-10-12T08:00:00Z"), crypto.randomUUID());
    expect(await call("GET", `/assets?cursor=${cursor}`)).toBe(200);
    expect(await call("GET", "/assets")).toBe(200);
  });
});
