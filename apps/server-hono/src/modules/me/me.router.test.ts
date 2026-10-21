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
}));

vi.mock("../../env", () => ({ env: { DATABASE_URL: "postgres://test" } }));
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
