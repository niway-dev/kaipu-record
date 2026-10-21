import { describe, expect, it, vi } from "vitest";
import {
  MOCK_ACCOUNT_PASSWORD,
  createHttpAccountDeletionClient,
  createMockAccountDeletionClient,
} from "./account-deletion";

const DAY = 24 * 60 * 60 * 1000;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("mockAccountDeletionClient", () => {
  const now = () => Date.parse("2026-10-11T00:00:00Z");

  it("starts active and reports what deletion would remove", async () => {
    const client = createMockAccountDeletionClient({ now });
    expect(await client.getDeletionStatus()).toEqual({
      status: "active",
      impact: { cloudFiles: 12, pendingUploads: 3 },
    });
  });

  it("rejects a wrong password without scheduling anything", async () => {
    const client = createMockAccountDeletionClient({ now });
    expect(await client.requestDeletion({ password: "nope" })).toEqual({
      ok: false,
      reason: "wrong-password",
    });
    expect((await client.getDeletionStatus()).status).toBe("active");
  });

  it("schedules the deletion seven days out and keeps the first date on a repeat", async () => {
    let t = now();
    const client = createMockAccountDeletionClient({ now: () => t });
    const first = await client.requestDeletion({ password: MOCK_ACCOUNT_PASSWORD });
    expect(first).toMatchObject({
      ok: true,
      status: { status: "scheduled", scheduledAt: new Date(now() + 7 * DAY).toISOString() },
    });
    t += DAY;
    const again = await client.requestDeletion({ password: MOCK_ACCOUNT_PASSWORD });
    expect(again).toEqual(first);
  });

  it("restores an account that was scheduled", async () => {
    const client = createMockAccountDeletionClient({ now });
    await client.requestDeletion({});
    expect(await client.cancelDeletion()).toMatchObject({ status: "active" });
    expect((await client.getDeletionStatus()).status).toBe("active");
  });
});

describe("httpAccountDeletionClient", () => {
  const scheduled = {
    status: "scheduled",
    requestedAt: "2026-10-11T00:00:00.000Z",
    scheduledAt: "2026-10-18T00:00:00.000Z",
  };

  it("posts to the documented route and reads the scheduled date", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(json(scheduled));
    const client = createHttpAccountDeletionClient({ fetch });
    expect(await client.requestDeletion({})).toEqual({ ok: true, status: scheduled });
    expect(fetch).toHaveBeenCalledWith(
      "/api/v1/me/account-deletion",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
  });

  it("falls back to the status route when the POST answer carries no date", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ ok: true }))
      .mockResolvedValueOnce(json({ data: scheduled, error: null }));
    const client = createHttpAccountDeletionClient({ fetch });
    expect(await client.requestDeletion({})).toEqual({ ok: true, status: scheduled });
    expect(fetch.mock.calls[1]?.[0]).toBe("/api/v1/me/account-deletion");
    expect(fetch.mock.calls[1]?.[1]).toMatchObject({ method: "GET" });
  });

  it("proves the password first and never calls the route when it is wrong", async () => {
    const fetch = vi.fn();
    const client = createHttpAccountDeletionClient({
      fetch,
      verifyPassword: async () => false,
    });
    expect(await client.requestDeletion({ password: "x" })).toEqual({
      ok: false,
      reason: "wrong-password",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("maps a stale session to its own failure, other errors to a generic one", async () => {
    const stale = createHttpAccountDeletionClient({
      fetch: vi
        .fn()
        .mockResolvedValue(json({ code: "FORBIDDEN", data: { kind: "session-not-fresh" } }, 403)),
    });
    expect(await stale.requestDeletion({})).toEqual({ ok: false, reason: "session-not-fresh" });

    const broken = createHttpAccountDeletionClient({
      fetch: vi.fn().mockResolvedValue(json({}, 500)),
    });
    expect(await broken.requestDeletion({})).toEqual({ ok: false, reason: "failed" });

    const offline = createHttpAccountDeletionClient({
      fetch: vi.fn().mockRejectedValue(new TypeError("offline")),
    });
    expect(await offline.requestDeletion({})).toEqual({ ok: false, reason: "failed" });
  });

  it("restores through the restore route and rejects when it fails", async () => {
    const ok = createHttpAccountDeletionClient({
      fetch: vi.fn().mockResolvedValue(json({ status: "active" })),
    });
    expect(await ok.cancelDeletion()).toEqual({ status: "active" });
    const bad = createHttpAccountDeletionClient({
      fetch: vi.fn().mockResolvedValue(json({}, 403)),
    });
    await expect(bad.cancelDeletion()).rejects.toThrow();
  });
});
