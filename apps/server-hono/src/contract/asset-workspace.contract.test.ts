import { setAssetWorkspace } from "@kaipu/application";
import type { ICloudAssetRepository } from "@kaipu/domain/repositories";
import type { CloudAsset } from "@kaipu/domain/schemas";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { implement, ORPCError } from "@orpc/server";
import { describe, expect, it } from "vitest";
import { cloudContract } from "./index";

/**
 * `PUT /assets/{assetId}/workspace` at the HTTP boundary (ADR 0032). The real router opens a
 * database client at import time, so this mounts the REAL contract behind a handler that runs
 * the real use case on an in-memory repository, as the signed-in user given in the context.
 * Routing, input validation and the response shape are exactly what production runs.
 */
const rows = new Map<string, CloudAsset>();
const keyOf = (userId: string, assetId: string) => `${userId}:${assetId}`;
const assets = {
  async setWorkspace(userId: string, assetId: string, workspaceId: string | null) {
    const row = rows.get(keyOf(userId, assetId));
    if (!row) return null;
    const next = { ...row, workspaceId };
    rows.set(keyOf(userId, assetId), next);
    return next;
  },
  async findAsset(userId: string, assetId: string) {
    const asset = rows.get(keyOf(userId, assetId));
    return asset ? { asset, current: null } : null;
  },
} as unknown as ICloudAssetRepository;
const contract = { cloud: { setWorkspace: cloudContract.setWorkspace } };
const impl = implement(contract).$context<{ userId: string }>();
const router = impl.router({
  cloud: {
    setWorkspace: impl.cloud.setWorkspace.handler(async ({ input, context }) => {
      const data = await setAssetWorkspace({
        assets,
        userId: context.userId,
        assetId: input.assetId,
        workspaceId: input.workspaceId,
      });
      if (!data) throw new ORPCError("NOT_FOUND", { message: "Asset not found" });
      return { data, error: null };
    }),
  },
});
const handler = new OpenAPIHandler(router);

async function put(assetId: string, body: unknown, userId = "owner") {
  const request = new Request(`http://api.test/api/v1/assets/${assetId}/workspace`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const { response } = await handler.handle(request, { prefix: "/api/v1", context: { userId } });
  return { status: response?.status ?? 404, json: (await response?.json()) as unknown };
}

function seed(): string {
  const assetId = crypto.randomUUID();
  rows.set(keyOf("owner", assetId), {
    assetId,
    userId: "owner",
    kind: "recording",
    title: "Demo",
    currentRevisionId: null,
    durationSeconds: 1,
    derivedFromAssetId: null,
    autoUploadExcluded: false,
    workspaceId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
  });
  return assetId;
}

describe("PUT /assets/{assetId}/workspace", () => {
  it("assigns the asset and answers the summary with its workspaceId", async () => {
    const assetId = seed();
    const { status, json } = await put(assetId, { workspaceId: "0192f1c2-7a3b-7c4d-8e5f-0011" });
    expect(status).toBe(200);
    expect(json).toMatchObject({
      data: { assetId, workspaceId: "0192f1c2-7a3b-7c4d-8e5f-0011" },
      error: null,
    });
  });

  it("accepts null to unassign", async () => {
    const assetId = seed();
    await put(assetId, { workspaceId: "ws-a" });
    const { status, json } = await put(assetId, { workspaceId: null });
    expect(status).toBe(200);
    expect(json).toMatchObject({ data: { workspaceId: null } });
  });

  it("rejects a body without workspaceId, or with an id that is not a plain id, with 400", async () => {
    const assetId = seed();
    expect((await put(assetId, {})).status).toBe(400);
    expect((await put(assetId, { workspaceId: "../x" })).status).toBe(400);
    expect((await put(assetId, { workspaceId: 7 })).status).toBe(400);
    expect((await put(assetId, { workspaceId: "x".repeat(65) })).status).toBe(400);
  });

  it("rejects an asset id that is not a uuid with 400", async () => {
    expect((await put("not-a-uuid", { workspaceId: "ws-a" })).status).toBe(400);
  });

  it("answers 404 for an asset of another account, and changes nothing", async () => {
    const assetId = seed();
    await put(assetId, { workspaceId: "ws-a" });
    const refused = await put(assetId, { workspaceId: "ws-x" }, "stranger");
    expect(refused.status).toBe(404);
    // The desktop tells "no such asset" from "a server without this route" by this code.
    expect(refused.json).toMatchObject({ code: "NOT_FOUND" });
    expect(rows.get(keyOf("owner", assetId))?.workspaceId).toBe("ws-a");
  });
});
