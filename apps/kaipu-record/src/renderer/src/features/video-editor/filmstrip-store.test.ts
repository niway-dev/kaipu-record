import { describe, expect, it } from "vitest";
import { FilmstripStore, type FilmstripTimers } from "./filmstrip-store";

/** A clock and timers the test drives by hand. */
function fakeTimers() {
  let now = 1000;
  let nextId = 1;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: FilmstripTimers = {
    now: () => now,
    set: (fn, ms) => {
      const id = nextId++;
      pending.set(id, { at: now + ms, fn });
      return id;
    },
    clear: (handle) => {
      pending.delete(handle as number);
    },
  };
  return {
    timers,
    advance(ms: number) {
      const target = now + ms;
      for (;;) {
        const due = [...pending]
          .filter(([, t]) => t.at <= target)
          .sort((a, b) => a[1].at - b[1].at);
        if (due.length === 0) break;
        const [id, t] = due[0];
        pending.delete(id);
        now = Math.max(now, t.at);
        t.fn();
      }
      now = target;
    },
  };
}

function setup(budgetBytes?: number) {
  const clock = fakeTimers();
  const created: string[] = [];
  const revoked: string[] = [];
  let n = 0;
  const store = new FilmstripStore({
    createUrl: () => {
      const url = `blob:frame-${n++}`;
      created.push(url);
      return url;
    },
    revokeUrl: (url) => revoked.push(url),
    timers: clock.timers,
    budgetBytes,
  });
  const frame = (timestamp: number, bytes = 10) => ({ timestamp, bytes, blob: new Blob() });
  return { store, clock, created, revoked, frame };
}

describe("FilmstripStore", () => {
  it("publishes the first frame at once, then batches later arrivals every 150 ms", () => {
    const { store, clock, frame } = setup();
    let calls = 0;
    store.subscribe("a", () => calls++);

    store.add("a", frame(1));
    expect(calls).toBe(1);
    expect(store.frames("a").map((f) => f.timestamp)).toEqual([1]);

    store.add("a", frame(2));
    store.add("a", frame(3));
    expect(calls).toBe(1); // held back inside the interval
    expect(store.frames("a")).toHaveLength(1);
    expect(store.liveFrames("a")).toHaveLength(3); // the planner already sees them

    clock.advance(149);
    expect(calls).toBe(1);
    clock.advance(1);
    expect(calls).toBe(2);
    expect(store.frames("a").map((f) => f.timestamp)).toEqual([1, 2, 3]);
  });

  it("AC1: flush publishes what is waiting at once, and the batch timer then has nothing left to do", () => {
    const { store, clock, frame } = setup();
    let calls = 0;
    store.subscribe("a", () => calls++);
    store.add("a", frame(1)); // leading edge: published
    store.add("a", frame(2)); // waits for the batch
    store.add("a", frame(3));
    expect(calls).toBe(1);
    expect(store.frames("a")).toHaveLength(1);

    store.flush();
    expect(calls).toBe(2);
    expect(store.frames("a")).toHaveLength(3);
    clock.advance(1000);
    expect(calls).toBe(2);
  });

  it("flush with nothing waiting tells nobody", () => {
    const { store, frame } = setup();
    let calls = 0;
    store.subscribe("a", () => calls++);
    store.add("a", frame(1));
    store.flush();
    store.flush();
    expect(calls).toBe(1);
  });

  it("tells only the subscribers of the file that changed", () => {
    const { store, frame } = setup();
    let a = 0;
    let b = 0;
    store.subscribe("a", () => a++);
    store.subscribe("b", () => b++);
    store.add("a", frame(1));
    expect(a).toBe(1);
    expect(b).toBe(0);
  });

  it("stops telling a subscriber that unsubscribed", () => {
    const { store, frame } = setup();
    let calls = 0;
    const off = store.subscribe("a", () => calls++);
    off();
    store.add("a", frame(1));
    expect(calls).toBe(0);
  });

  it("keeps a published snapshot stable until the next publish", () => {
    const { store, clock, frame } = setup();
    store.add("a", frame(1));
    const first = store.frames("a");
    store.add("a", frame(2));
    expect(store.frames("a")).toBe(first);
    clock.advance(150);
    expect(store.frames("a")).not.toBe(first);
  });

  it("revokes the URL of a frame it evicts, after the grace, never before the snapshot drops it", () => {
    const { store, clock, created, revoked, frame } = setup(25);
    store.add("a", frame(1, 10));
    store.add("b", frame(2, 10));
    clock.advance(150);
    store.add("c", frame(3, 10)); // 30 bytes over a 25 budget: file "a" is the oldest and goes
    expect(store.liveFrames("a")).toHaveLength(0);
    expect(revoked).toEqual([]);
    clock.advance(150); // the snapshot without "a" is published
    expect(store.frames("a")).toHaveLength(0);
    expect(revoked).toEqual([]); // still inside the grace
    clock.advance(2000);
    expect(revoked).toEqual([created[0]]);
    expect(store.bytes).toBe(20);
  });

  it("gives each publish its own grace: a frame evicted late is not revoked with the earlier batch", () => {
    const { store, clock, created, revoked, frame } = setup(25);
    store.add("a", frame(1, 10)); // created[0]
    store.add("b", frame(2, 10)); // created[1]
    clock.advance(150);
    store.add("c", frame(3, 10)); // evicts "a"
    clock.advance(150); // publishes the snapshot without "a": its 2 s grace starts here
    clock.advance(1990);
    store.add("d", frame(4, 10)); // evicts "b" 10 ms before "a"'s grace ends
    expect(store.liveFrames("b")).toHaveLength(0);
    clock.advance(10);
    expect(revoked).toEqual([created[0]]); // "b" is not revoked with "a"'s batch
    clock.advance(1989);
    expect(revoked).toEqual([created[0]]);
    clock.advance(1);
    expect(revoked).toEqual([created[0], created[1]]);
  });

  it("revokes the URL of a frame replaced at the same timestamp", () => {
    const { store, clock, created, revoked, frame } = setup();
    store.add("a", frame(1));
    store.add("a", frame(1));
    clock.advance(150 + 2000);
    expect(revoked).toEqual([created[0]]);
    expect(store.liveFrames("a")).toHaveLength(1);
  });

  it("AC10: clear empties the store, tells the subscribers and revokes every URL now", () => {
    const { store, created, revoked, frame } = setup();
    let calls = 0;
    store.add("a", frame(1));
    store.add("b", frame(2));
    store.subscribe("a", () => calls++);
    store.clear();
    expect(store.frames("a")).toHaveLength(0);
    expect(store.frames("b")).toHaveLength(0);
    expect(store.liveFrames("a")).toHaveLength(0);
    expect(store.bytes).toBe(0);
    expect(calls).toBe(1);
    expect(revoked.sort()).toEqual([...created].sort());
  });

  it("keeps working after a clear", () => {
    const { store, frame } = setup();
    store.add("a", frame(1));
    store.clear();
    store.add("a", frame(5));
    expect(store.frames("a").map((f) => f.timestamp)).toEqual([5]);
  });
});
