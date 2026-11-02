import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AssignOutcome } from "./assign-client";
import { AssignQueue, retryDelayMs } from "./assign-queue";

describe("AssignQueue (best-effort cloud assignment after a move, with retries)", () => {
  let dir: string;
  let now: number;
  let outcomes: AssignOutcome[];
  type Assign = (
    token: string,
    assetId: string,
    workspaceId: string | null,
  ) => Promise<AssignOutcome>;
  let assign: ReturnType<typeof vi.fn<Assign>>;
  let confirmed: Array<[string, string | null]>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "kaipu-assign-q-"));
    now = 1_000;
    outcomes = [];
    confirmed = [];
    assign = vi.fn<Assign>(async () => outcomes.shift() ?? "ok");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const queue = (token: string | null = "tok", userId = "u1") =>
    new AssignQueue({
      file: join(dir, "assign-queue.json"),
      account: () => (token ? { userId, token } : null),
      assign: (tok, assetId, workspaceId) => assign(tok, assetId, workspaceId),
      onConfirmed: async (assetId, workspaceId) => {
        confirmed.push([assetId, workspaceId]);
      },
      now: () => now,
      schedule: () => {},
    });

  it("sends a queued assignment, confirms it, and forgets it", async () => {
    const q = queue();
    await q.enqueue("a1", "ws-b", "u1");
    expect(assign).toHaveBeenCalledWith("tok", "a1", "ws-b");
    expect(confirmed).toEqual([["a1", "ws-b"]]);
    expect(q.pending("u1").size).toBe(0);
  });

  it("a failure keeps it pending (the Library already shows it in its new workspace) and retries later", async () => {
    outcomes = ["retry"];
    const q = queue();
    await q.enqueue("a1", "ws-b", "u1");
    expect(q.pending("u1")).toEqual(new Map([["a1", "ws-b"]]));
    await q.process();
    expect(assign).toHaveBeenCalledTimes(1); // not due yet
    now += retryDelayMs(1);
    await q.process();
    expect(assign).toHaveBeenCalledTimes(2);
    expect(q.pending("u1").size).toBe(0);
  });

  it("a server without the endpoint is tolerated: nothing throws and it waits", async () => {
    outcomes = ["unsupported", "unsupported"];
    const q = queue();
    await expect(q.enqueue("a1", "ws-b", "u1")).resolves.toBeUndefined();
    expect(q.pending("u1").get("a1")).toBe("ws-b");
  });

  it("an asset the server does not have is dropped (nothing to assign)", async () => {
    outcomes = ["not-found"];
    const q = queue();
    await q.enqueue("a1", "ws-b", "u1");
    expect(q.pending("u1").size).toBe(0);
    expect(confirmed).toEqual([]);
  });

  it("the latest assignment of an asset wins (moved twice offline)", async () => {
    outcomes = ["retry", "retry"];
    const q = queue();
    await q.enqueue("a1", "ws-b", "u1");
    await q.enqueue("a1", "ws-c", "u1");
    expect(q.pending("u1")).toEqual(new Map([["a1", "ws-c"]]));
  });

  it("signed out, nothing is sent and the entry waits", async () => {
    const q = queue(null);
    await q.enqueue("a1", "ws-b", null);
    expect(assign).not.toHaveBeenCalled();
    expect(q.pending("u1").get("a1")).toBe("ws-b");
  });

  it("survives a restart: the file holds what is pending", async () => {
    outcomes = ["retry"];
    await queue().enqueue("a1", "ws-b", "u1");
    const reopened = queue();
    await reopened.load();
    expect(reopened.pending("u1")).toEqual(new Map([["a1", "ws-b"]]));
    expect(JSON.parse(await readFile(join(dir, "assign-queue.json"), "utf-8"))).toMatchObject({
      version: 1,
    });
  });

  it("an unreadable file starts empty and never throws", async () => {
    await writeFile(join(dir, "assign-queue.json"), "{nope");
    const q = queue();
    await q.load();
    expect(q.pending("u1").size).toBe(0);
  });

  it("backs off, capped at an hour", () => {
    expect(retryDelayMs(1)).toBeLessThan(retryDelayMs(2));
    expect(retryDelayMs(30)).toBe(60 * 60 * 1000);
  });

  it("defer() keeps an assignment that was just tried, without trying it again now", async () => {
    const q = queue();
    await q.defer("a1", "ws-b", "u1");
    expect(assign).not.toHaveBeenCalled();
    expect(q.pending("u1").get("a1")).toBe("ws-b");
    now += retryDelayMs(1);
    await q.process();
    expect(assign).toHaveBeenCalledTimes(1);
    expect(q.pending("u1").size).toBe(0);
  });

  it("an entry of one account is never sent with another's token, nor overlays its catalog", async () => {
    outcomes = ["retry"];
    await queue("tok-a", "user-a").enqueue("a1", "ws-b", "user-a");
    const asB = queue("tok-b", "user-b");
    await asB.load();
    now += retryDelayMs(1);
    await asB.process();
    expect(assign).toHaveBeenCalledTimes(1); // only A's first try
    expect(asB.pending("user-b").size).toBe(0);
    expect(asB.pending("user-a").get("a1")).toBe("ws-b");
    // Back as A, it goes, and A's cache learns it.
    const asA = queue("tok-a", "user-a");
    await asA.load();
    await asA.process();
    expect(assign).toHaveBeenLastCalledWith("tok-a", "a1", "ws-b");
    expect(confirmed).toEqual([["a1", "ws-b"]]);
  });
});
