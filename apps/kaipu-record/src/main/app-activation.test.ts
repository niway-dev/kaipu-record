import { describe, expect, it, vi } from "vitest";
import { registerAppActivation } from "./app-activation";
import { createCaptureWindowHooks } from "./screenshots/capture-window-hooks";

function setup(platform: NodeJS.Platform = "darwin") {
  const listeners = new Map<string, () => void>();
  let visible = true;
  let recording = false;
  const showMainWindow = vi.fn(() => {
    visible = true;
  });
  const hooks = createCaptureWindowHooks({
    mainWindow: () => ({
      isDestroyed: () => false,
      isVisible: () => visible,
      hide: () => {
        visible = false;
      },
      showInactive: vi.fn(),
      minimize: vi.fn(),
    }),
    hideCapturePanel: vi.fn(),
    dismissToast: vi.fn(),
    hideCameraBubble: vi.fn(),
    restoreCameraBubble: vi.fn(),
    showMainWindow,
    bringAppToFront: showMainWindow,
  });
  registerAppActivation({
    app: { on: (event, listener) => listeners.set(event, listener) },
    platform,
    captureInProgress: hooks.isCapturing,
    recordingInProgress: () => recording,
    showMainWindow,
  });
  return {
    hooks,
    listeners,
    showMainWindow,
    isVisible: () => visible,
    record: () => {
      recording = true;
    },
    activate: () => listeners.get("did-become-active")?.(),
  };
}

describe("main window app activation", () => {
  it("Cmd+Tab reveals the window left hidden after a quiet capture (Copy or Save)", () => {
    const s = setup();
    s.hooks.beforeCapture();
    s.activate(); // Overlay focus must not put the main window in the shot.
    expect(s.isVisible()).toBe(false);
    s.hooks.afterCapture("quiet");
    expect(s.isVisible()).toBe(false); // Completion itself must stay quiet.
    s.activate(); // macOS App Switcher, without a Dock 'activate' event.
    expect(s.isVisible()).toBe(true);
    expect(s.showMainWindow).toHaveBeenCalledOnce();
  });

  it("does not interrupt a recording or countdown on activation", () => {
    const s = setup();
    s.hooks.beforeCapture();
    s.hooks.afterCapture("recording");
    s.record();
    s.activate();
    expect(s.isVisible()).toBe(false);
  });

  it("keeps Dock/relaunch restoration on other platforms without the macOS event", () => {
    const s = setup("win32");
    expect(s.listeners.has("did-become-active")).toBe(false);
    s.listeners.get("activate")?.();
    expect(s.showMainWindow).toHaveBeenCalledOnce();
  });
});
