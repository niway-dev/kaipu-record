import { describe, expect, it } from "vitest";
import { ClickHook, type ClickHookDeps, type HookLike, toCursorButton } from "./click-hook";

function fakeHook() {
  let listener: ((e: { button: unknown }) => void) | null = null;
  const state = { starts: 0, stops: 0 };
  const hook: HookLike = {
    on: (_event, l) => {
      listener = l;
    },
    start: () => {
      state.starts++;
    },
    stop: () => {
      state.stops++;
    },
  };
  return { hook, state, fire: (button: unknown) => listener?.({ button }) };
}

function deps(partial: Partial<ClickHookDeps>, hook: HookLike | null): ClickHookDeps {
  return { platform: "darwin", isAccessibilityTrusted: () => true, load: () => hook, ...partial };
}

describe("toCursorButton", () => {
  it("maps libuiohook buttons to DOM buttons", () => {
    expect([1, 2, 3, 4, "x"].map(toCursorButton)).toEqual([0, 2, 1, null, null]);
  });
});

describe("ClickHook", () => {
  it("never loads or starts on macOS without Accessibility (no prompt)", () => {
    let loads = 0;
    const f = fakeHook();
    const hook = new ClickHook(
      deps({ isAccessibilityTrusted: () => false, load: () => (loads++, f.hook) }, f.hook),
      () => {},
    );
    expect(hook.ensureRunning()).toBe(false);
    expect(loads).toBe(0);
    expect(f.state.starts).toBe(0);
  });

  it("starts once, forwards mouse-downs, and stops", () => {
    const f = fakeHook();
    const clicks: number[] = [];
    const hook = new ClickHook(deps({}, f.hook), (b) => clicks.push(b));
    expect(hook.ensureRunning()).toBe(true);
    expect(hook.ensureRunning()).toBe(true);
    expect(f.state.starts).toBe(1);
    f.fire(1);
    f.fire(3);
    f.fire(9);
    expect(clicks).toEqual([0, 1]);
    hook.stop();
    hook.stop();
    expect(f.state.stops).toBe(1);
    expect(hook.isRunning).toBe(false);
  });

  it("runs on Windows without any permission check", () => {
    const f = fakeHook();
    const hook = new ClickHook(
      deps({ platform: "win32", isAccessibilityTrusted: () => false }, f.hook),
      () => {},
    );
    expect(hook.ensureRunning()).toBe(true);
  });

  it("is off on Linux", () => {
    const f = fakeHook();
    expect(new ClickHook(deps({ platform: "linux" }, f.hook), () => {}).ensureRunning()).toBe(
      false,
    );
  });

  it("degrades to no clicks when the native module fails, and stops retrying", () => {
    let loads = 0;
    const hook = new ClickHook(deps({ load: () => (loads++, null) }, null), () => {});
    expect(hook.ensureRunning()).toBe(false);
    expect(hook.ensureRunning()).toBe(false);
    expect(loads).toBe(1);
  });

  it("degrades when start throws", () => {
    const f = fakeHook();
    f.hook.start = () => {
      throw new Error("AX disabled");
    };
    expect(new ClickHook(deps({}, f.hook), () => {}).ensureRunning()).toBe(false);
  });
});
