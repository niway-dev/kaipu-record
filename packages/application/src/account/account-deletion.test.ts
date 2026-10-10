import type { AccountDeletion, IAccountDeletionRepository } from "@kaipu/domain/repositories";
import { describe, expect, it, vi } from "vitest";
import {
  finalizeDueAccountDeletions,
  getAccountDeletionStatus,
  requestAccountDeletion,
  restoreAccount,
  type AccountDeletionNotifier,
} from "./account-deletion";

const NOW = new Date("2026-10-10T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const USER = { id: "u1", email: "u1@example.com" };

function fakeDeletions(emails: Record<string, string> = { u1: USER.email }) {
  const rows = new Map<string, AccountDeletion>();
  const users = new Set(Object.keys(emails));
  const calls: string[] = [];
  const repo: IAccountDeletionRepository = {
    async find(userId) {
      return rows.get(userId) ?? null;
    },
    async schedule(data) {
      calls.push("schedule");
      const existing = rows.get(data.userId);
      if (existing) return existing;
      rows.set(data.userId, data);
      return data;
    },
    async cancel(userId) {
      return rows.delete(userId);
    },
    async revokeSessions() {
      calls.push("revokeSessions");
      return 2;
    },
    async listDue(now, limit) {
      return [...rows.values()]
        .filter((r) => r.scheduledAt <= now && users.has(r.userId))
        .slice(0, limit)
        .map((r) => ({ ...r, email: emails[r.userId] ?? "" }));
    },
    async finalize(userId, now) {
      calls.push(`finalize:${userId}`);
      const row = rows.get(userId);
      if (!row || row.scheduledAt > now || !users.has(userId)) return false;
      users.delete(userId);
      rows.delete(userId);
      return true;
    },
  };
  return { repo, rows, users, calls };
}

function fakeNotifier(): AccountDeletionNotifier & {
  scheduled: Array<[string, string, Date]>;
  deleted: string[];
} {
  const scheduled: Array<[string, string, Date]> = [];
  const deleted: string[] = [];
  return {
    scheduled,
    deleted,
    async deletionScheduled(to, at) {
      scheduled.push([to.email, to.locale, at]);
    },
    async accountDeleted(to) {
      deleted.push(to.email);
    },
  };
}

describe("requestAccountDeletion", () => {
  it("schedules deletion 7 days out, revokes every session, then emails the date", async () => {
    const d = fakeDeletions();
    const n = fakeNotifier();
    const result = await requestAccountDeletion({
      deletions: d.repo,
      notifier: n,
      user: USER,
      locale: "es",
      now: NOW,
    });
    const scheduledAt = new Date(NOW.getTime() + 7 * DAY);
    expect(result).toEqual({
      status: "scheduled",
      requestedAt: NOW.toISOString(),
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(d.calls).toEqual(["schedule", "revokeSessions"]);
    expect(n.scheduled).toEqual([[USER.email, "es", scheduledAt]]);
  });

  it("is idempotent: a second request keeps the first date", async () => {
    const d = fakeDeletions();
    const n = fakeNotifier();
    const args = { deletions: d.repo, notifier: n, user: USER, locale: "en" };
    const first = await requestAccountDeletion({ ...args, now: NOW });
    const second = await requestAccountDeletion({ ...args, now: new Date(NOW.getTime() + DAY) });
    expect(second.scheduledAt).toBe(first.scheduledAt);
  });

  it("still schedules when the email fails", async () => {
    const d = fakeDeletions();
    const n = fakeNotifier();
    n.deletionScheduled = vi.fn(async () => {
      throw new Error("resend down");
    });
    const result = await requestAccountDeletion({
      deletions: d.repo,
      notifier: n,
      user: USER,
      locale: "en",
      now: NOW,
    });
    expect(result.status).toBe("scheduled");
    expect(d.rows.has("u1")).toBe(true);
  });
});

describe("status and restore", () => {
  it("reports active, then scheduled, then active again after restore", async () => {
    const d = fakeDeletions();
    expect(await getAccountDeletionStatus({ deletions: d.repo, userId: "u1" })).toEqual({
      status: "active",
    });
    await requestAccountDeletion({
      deletions: d.repo,
      notifier: fakeNotifier(),
      user: USER,
      locale: "en",
      now: NOW,
    });
    const status = await getAccountDeletionStatus({ deletions: d.repo, userId: "u1" });
    expect(status).toMatchObject({ status: "scheduled" });
    expect(await restoreAccount({ deletions: d.repo, userId: "u1" })).toEqual({ restored: true });
    expect(await restoreAccount({ deletions: d.repo, userId: "u1" })).toEqual({ restored: false });
    expect(await getAccountDeletionStatus({ deletions: d.repo, userId: "u1" })).toEqual({
      status: "active",
    });
  });
});

describe("finalizeDueAccountDeletions", () => {
  async function scheduled(emails: Record<string, string>) {
    const d = fakeDeletions(emails);
    for (const [id, email] of Object.entries(emails)) {
      await requestAccountDeletion({
        deletions: d.repo,
        notifier: fakeNotifier(),
        user: { id, email },
        locale: "en",
        now: NOW,
      });
    }
    return d;
  }

  it("does nothing during the grace period", async () => {
    const d = await scheduled({ u1: USER.email });
    const n = fakeNotifier();
    const result = await finalizeDueAccountDeletions({
      deletions: d.repo,
      notifier: n,
      now: new Date(NOW.getTime() + 7 * DAY - 1),
      limit: 10,
    });
    expect(result).toEqual({ deleted: 0, failed: 0 });
    expect(d.users.has("u1")).toBe(true);
    expect(n.deleted).toEqual([]);
  });

  it("hard-deletes due accounts, bounded by limit, and sends the final email", async () => {
    const d = await scheduled({ u1: "a@x.dev", u2: "b@x.dev", u3: "c@x.dev" });
    const n = fakeNotifier();
    const after = new Date(NOW.getTime() + 7 * DAY);
    expect(
      await finalizeDueAccountDeletions({ deletions: d.repo, notifier: n, now: after, limit: 2 }),
    ).toEqual({ deleted: 2, failed: 0 });
    expect(n.deleted).toEqual(["a@x.dev", "b@x.dev"]);
    expect(
      await finalizeDueAccountDeletions({ deletions: d.repo, notifier: n, now: after, limit: 2 }),
    ).toEqual({ deleted: 1, failed: 0 });
    expect(d.users.size).toBe(0);
  });

  it("skips an account restored between listing and finalizing, and counts failures", async () => {
    const d = await scheduled({ u1: "a@x.dev", u2: "b@x.dev" });
    const n = fakeNotifier();
    const realFinalize = d.repo.finalize.bind(d.repo);
    d.repo.finalize = async (userId, now) => {
      if (userId === "u1") {
        d.rows.delete("u1"); // restored concurrently
        return realFinalize(userId, now);
      }
      throw new Error("db down");
    };
    const result = await finalizeDueAccountDeletions({
      deletions: d.repo,
      notifier: n,
      now: new Date(NOW.getTime() + 8 * DAY),
      limit: 10,
    });
    expect(result).toEqual({ deleted: 0, failed: 1 });
    expect(n.deleted).toEqual([]);
    expect(d.users.has("u1")).toBe(true);
  });
});
