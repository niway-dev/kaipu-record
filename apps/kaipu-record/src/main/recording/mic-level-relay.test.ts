import { describe, expect, it, vi } from "vitest";
import { createMicLevelRelay, type MicLevelTarget } from "./mic-level-relay";

function target(id: number) {
  return { id, send: vi.fn<MicLevelTarget["send"]>(), isDestroyed: () => false };
}

describe("createMicLevelRelay", () => {
  it("tells the recorder nobody listens until the first subscription", () => {
    const recorder = target(1);
    const relay = createMicLevelRelay(() => recorder);
    expect(relay.listening()).toBe(false);
    relay.subscribe(target(2));
    expect(relay.listening()).toBe(true);
    expect(recorder.send).toHaveBeenCalledWith("mic-levels:listening", true);
  });

  it("relays levels to subscribed windows only", () => {
    const relay = createMicLevelRelay(() => null);
    const a = target(2);
    const b = target(3);
    relay.subscribe(a);
    relay.publish([0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(a.send).toHaveBeenCalledWith("mic-levels:data", [0.1, 0.2, 0.3, 0.4, 0.5]);
    expect(b.send).not.toHaveBeenCalled();
  });

  it("keeps listening until every subscription of a window is gone", () => {
    const recorder = target(1);
    const relay = createMicLevelRelay(() => recorder);
    const a = target(2);
    relay.subscribe(a);
    relay.subscribe(a);
    relay.unsubscribe(2);
    expect(relay.listening()).toBe(true);
    relay.unsubscribe(2);
    expect(relay.listening()).toBe(false);
    expect(recorder.send).toHaveBeenLastCalledWith("mic-levels:listening", false);
  });

  it("drops a destroyed window and stops sending to it", () => {
    const recorder = target(1);
    const relay = createMicLevelRelay(() => recorder);
    let destroyed = false;
    const a = { ...target(2), isDestroyed: () => destroyed };
    relay.subscribe(a);
    destroyed = true;
    relay.publish([0, 0, 0, 0, 0]);
    expect(a.send).not.toHaveBeenCalled();
    expect(relay.listening()).toBe(false);
  });

  it("removes a window explicitly (its webContents was destroyed)", () => {
    const relay = createMicLevelRelay(() => null);
    relay.subscribe(target(2));
    relay.remove(2);
    expect(relay.listening()).toBe(false);
  });

  it("does not announce a change that is not one", () => {
    const recorder = target(1);
    const relay = createMicLevelRelay(() => recorder);
    relay.subscribe(target(2));
    relay.subscribe(target(3));
    expect(recorder.send).toHaveBeenCalledTimes(1);
  });
});
