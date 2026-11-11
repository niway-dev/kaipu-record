import { describe, expect, it, vi } from "vitest";
import { createCaptureWindowHooks } from "./capture-window-hooks";

function setup(options: { visible?: boolean; window?: boolean; platform?: NodeJS.Platform } = {}) {
  const calls: string[] = [];
  let visible = options.visible ?? true;
  const window = {
    isDestroyed: () => false,
    isVisible: () => visible,
    hide: vi.fn(() => {
      visible = false;
      calls.push("hide-main");
    }),
    showInactive: vi.fn(() => {
      visible = true;
      calls.push("show-inactive");
    }),
    minimize: vi.fn(() => calls.push("minimize")),
    focus: vi.fn(() => calls.push("focus")),
  };
  const deps = {
    platform: options.platform ?? "darwin",
    mainWindow: () => (options.window === false ? null : window),
    hideCapturePanel: vi.fn(() => calls.push("hide-panel")),
    dismissToast: vi.fn(() => calls.push("dismiss-toast")),
    hideCameraBubble: vi.fn(() => calls.push("hide-bubble")),
    restoreCameraBubble: vi.fn(() => calls.push("restore-bubble")),
    showMainWindow: vi.fn(() => calls.push("show-and-focus")),
    bringAppToFront: vi.fn(() => calls.push("front")),
    suspendTakeEscape: vi.fn(() => calls.push("suspend-esc")),
    resumeTakeEscape: vi.fn(() => calls.push("resume-esc")),
  };
  return { hooks: createCaptureWindowHooks(deps), deps, window, calls };
}

describe("createCaptureWindowHooks", () => {
  it("takes every window of ours out of the shot, the previous capture's toast included", () => {
    const { hooks, deps, window } = setup();
    hooks.beforeCapture();
    expect(deps.hideCapturePanel).toHaveBeenCalledOnce();
    expect(window.hide).toHaveBeenCalledOnce();
    expect(deps.hideCameraBubble).toHaveBeenCalledOnce();
    // The toast from the last quiet capture would otherwise sit inside the next shot.
    expect(deps.dismissToast).toHaveBeenCalledOnce();
  });

  it("lets Esc through to the overlay while it is open, and hands it back after", () => {
    const { hooks, calls } = setup();
    hooks.beforeCapture();
    hooks.afterCapture("quiet");
    expect(calls.indexOf("suspend-esc")).toBeGreaterThanOrEqual(0);
    expect(calls.indexOf("resume-esc")).toBeGreaterThan(calls.indexOf("suspend-esc"));
  });

  it("still dismisses the toast when there is no main window", () => {
    const { hooks, deps } = setup({ window: false });
    hooks.beforeCapture();
    expect(deps.dismissToast).toHaveBeenCalledOnce();
  });

  it("brings a previously visible window back and focuses it after a cancel", () => {
    const { hooks, deps, window } = setup();
    hooks.beforeCapture();
    hooks.afterCapture("cancelled");
    expect(deps.showMainWindow).toHaveBeenCalledOnce();
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(deps.restoreCameraBubble).toHaveBeenCalledOnce();
  });

  it("a quiet capture keeps even a previously visible main window hidden", () => {
    const { hooks, deps, window } = setup();
    hooks.beforeCapture();
    hooks.afterCapture("quiet");
    // The app the user was in keeps the foreground, so ⌘V pastes there.
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(window.isVisible()).toBe(false);
    expect(window.focus).not.toHaveBeenCalled();
    expect(deps.showMainWindow).not.toHaveBeenCalled();
    expect(deps.bringAppToFront).not.toHaveBeenCalled();
    expect(deps.restoreCameraBubble).toHaveBeenCalledOnce();
  });

  it("brings a previously visible Windows window back minimized after a quiet capture", () => {
    const { hooks, window, deps, calls } = setup({ platform: "win32" });
    hooks.beforeCapture();
    hooks.afterCapture("quiet");
    expect(calls.slice(-2)).toEqual(["minimize", "restore-bubble"]);
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(window.focus).not.toHaveBeenCalled();
    expect(deps.showMainWindow).not.toHaveBeenCalled();
    expect(deps.bringAppToFront).not.toHaveBeenCalled();
  });

  it("does not restore a Windows window that was already hidden", () => {
    const { hooks, window } = setup({ platform: "win32", visible: false });
    hooks.beforeCapture();
    hooks.afterCapture("quiet");
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(window.minimize).not.toHaveBeenCalled();
  });

  it("failure 7: a window that was hidden stays hidden after a quiet capture or a cancel", () => {
    for (const ending of ["quiet", "cancelled"] as const) {
      const { hooks, deps, window } = setup({ visible: false });
      hooks.beforeCapture();
      hooks.afterCapture(ending);
      expect(window.showInactive).not.toHaveBeenCalled();
      expect(deps.showMainWindow).not.toHaveBeenCalled();
    }
  });

  it("leaves the window to the editor when it takes over", () => {
    const { hooks, deps, window } = setup();
    hooks.beforeCapture();
    hooks.afterCapture("editor");
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(deps.showMainWindow).not.toHaveBeenCalled();
    expect(deps.restoreCameraBubble).toHaveBeenCalledOnce();
  });

  it("keeps a visible window hidden when the overlay started a recording", () => {
    const { hooks, deps, window } = setup();
    hooks.beforeCapture();
    hooks.afterCapture("recording");
    expect(deps.showMainWindow).not.toHaveBeenCalled();
    expect(window.showInactive).not.toHaveBeenCalled();
    expect(deps.restoreCameraBubble).toHaveBeenCalledOnce();
  });

  it("reveal brings the app to the front", () => {
    const { hooks, deps } = setup();
    hooks.reveal();
    expect(deps.bringAppToFront).toHaveBeenCalledOnce();
  });
});
