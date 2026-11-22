import { call } from "@orpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * GET /me/entitlements and /me/storage for a verified Free account — the numbers the
 * desktop and web show. The router's real wiring runs (authMiddleware → getEntitlements →
 * deriveEntitlements → the @kaipu/domain plan table); only I/O is faked.
 */
const state = vi.hoisted(() => ({
  verified: true,
  usage: { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 },
  env: { DATABASE_URL: "postgres://test" } as { DATABASE_URL: string; ADMIN_USER_IDS?: string },
}));

vi.mock("../../env", () => ({ env: state.env }));
vi.mock("@kaipu/infra-db/client", () => ({ createDatabaseClient: () => ({}) }));
vi.mock("../../lib/auth", () => ({
  auth: {
    api: {
      getSession: async () => ({
        user: { id: "u1", email: "a@b.c", emailVerified: state.verified },
        session: { id: "s1" },
      }),
    },
  },
}));
vi.mock("@kaipu/infra-db/repositories", () => ({
  SubscriptionRepository: class {
    findByUserId = async () => null;
  },
  CloudAccessRepository: class {
    hasAccess = async () => state.verified;
    getControl = async () => ({ uploadsEnabled: true });
  },
  CloudAssetRepository: class {
    usage = async () => state.usage;
  },
}));

const { meRouter } = await import("./me.router");
const context = { headers: new Headers() };

describe("me router — Free plan", () => {
  beforeEach(() => {
    state.verified = true;
    state.usage = { usedBytes: 0, reservedBytes: 0, pendingUploads: 0 };
  });

  it("reports 250 MB of cloud for a verified Free user", async () => {
    const res = await call(meRouter.entitlements, undefined, { context });
    expect(res.data?.plan).toBe("free");
    expect(res.data?.features.cloudUploads).toBe(true);
    expect(res.data?.features.cloudStorageBytes).toBe(250_000_000);
  });

  it("gives an unverified account no cloud uploads", async () => {
    state.verified = false;
    const res = await call(meRouter.entitlements, undefined, { context });
    expect(res.data?.features.cloudUploads).toBe(false);
  });

  it("reports 250 MB capacity on /me/storage", async () => {
    state.usage = { usedBytes: 100_000_000, reservedBytes: 0, pendingUploads: 0 };
    const res = await call(meRouter.storage, undefined, { context });
    expect(res.data).toMatchObject({ capacityBytes: 250_000_000, availableBytes: 150_000_000 });
  });

  it("an account already above 250 MB sees 0 available — usage is reported, never trimmed", async () => {
    state.usage = { usedBytes: 600_000_000, reservedBytes: 0, pendingUploads: 0 };
    const res = await call(meRouter.storage, undefined, { context });
    expect(res.data).toMatchObject({
      capacityBytes: 250_000_000,
      usedBytes: 600_000_000,
      availableBytes: 0,
    });
  });
});

describe("me router — admin permission (ADR 0067)", () => {
  beforeEach(() => {
    state.verified = true;
    state.env.ADMIN_USER_IDS = undefined;
  });

  const entitlements = () => call(meRouter.entitlements, undefined, { context });

  it("returns the session user id", async () => {
    expect((await entitlements()).data?.userId).toBe("u1");
  });

  it("is admin when the user id is listed", async () => {
    state.env.ADMIN_USER_IDS = "u9,u1";
    expect((await entitlements()).data?.admin).toBe(true);
  });

  it("is not admin when the user id is not listed", async () => {
    state.env.ADMIN_USER_IDS = "u2,u3";
    expect((await entitlements()).data?.admin).toBe(false);
  });

  it("handles whitespace and stray commas around ids", async () => {
    state.env.ADMIN_USER_IDS = " u2 , , u1 ,";
    expect((await entitlements()).data?.admin).toBe(true);
  });

  it("makes nobody admin when the list is an empty string", async () => {
    state.env.ADMIN_USER_IDS = "";
    expect((await entitlements()).data?.admin).toBe(false);
  });

  it("makes nobody admin and still answers when the variable is missing", async () => {
    const res = await entitlements();
    expect(res.error).toBeNull();
    expect(res.data).toMatchObject({ plan: "free", userId: "u1", admin: false });
  });
});
