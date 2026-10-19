import { describe, expect, it, vi } from "vitest";
import {
  closeAction,
  handleMainWindowClose,
  isQuitShortcut,
  secondInstanceAction,
  shouldQuitOnAllWindowsClosed,
  shouldShowTrayHint,
} from "./window-close-policy";

describe("closeAction", () => {
  it("hides the window on Windows when the app is not quitting", () => {
    expect(closeAction({ platform: "win32", isQuitting: false, guardTookOver: false })).toBe(
      "hide",
    );
  });

  it("lets a real quit close the window on Windows", () => {
    expect(closeAction({ platform: "win32", isQuitting: true, guardTookOver: false })).toBe(
      "close",
    );
  });

  it("leaves a close a guard already took over alone on Windows", () => {
    expect(closeAction({ platform: "win32", isQuitting: false, guardTookOver: true })).toBe(
      "close",
    );
  });

  it("keeps macOS behaviour: closing the window closes it", () => {
    expect(closeAction({ platform: "darwin", isQuitting: false, guardTookOver: false })).toBe(
      "close",
    );
  });

  it("closes the window on Linux", () => {
    expect(closeAction({ platform: "linux", isQuitting: false, guardTookOver: false })).toBe(
      "close",
    );
  });
});

describe("shouldQuitOnAllWindowsClosed", () => {
  it("quits only on Linux", () => {
    expect(shouldQuitOnAllWindowsClosed("linux")).toBe(true);
    expect(shouldQuitOnAllWindowsClosed("win32")).toBe(false);
    expect(shouldQuitOnAllWindowsClosed("darwin")).toBe(false);
  });
});

describe("handleMainWindowClose", () => {
  const run = (platform: NodeJS.Platform, isQuitting = false, guardTookOver = false) => {
    const event = { preventDefault: vi.fn() };
    const hide = vi.fn();
    const hidden = handleMainWindowClose(event, { platform, isQuitting, guardTookOver }, hide);
    return { event, hide, hidden };
  };

  it("prevents the close and hides the window on Windows", () => {
    const { event, hide, hidden } = run("win32");
    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(hide).toHaveBeenCalledOnce();
    expect(hidden).toBe(true);
  });

  it("does not touch the close on macOS", () => {
    const { event, hide, hidden } = run("darwin");
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
    expect(hidden).toBe(false);
  });

  it("does not swallow a quit on Windows", () => {
    const { event, hide } = run("win32", true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("does not hide over a guard that took the close over", () => {
    const { event, hide } = run("win32", false, true);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it("hides again once a quit was aborted at a guard and isQuitting was reset", () => {
    // Quitting: the window-level guard prompts and the user cancels — the quit is
    // aborted, index.ts resets isQuitting. The next X must hide, not close.
    const aborted = run("win32", true, true);
    expect(aborted.hide).not.toHaveBeenCalled();
    const next = run("win32", false, false);
    expect(next.event.preventDefault).toHaveBeenCalledOnce();
    expect(next.hide).toHaveBeenCalledOnce();
  });
});

describe("isQuitShortcut", () => {
  const key = (overrides: Partial<Parameters<typeof isQuitShortcut>[0]> = {}) => ({
    type: "keyDown",
    key: "q",
    control: true,
    alt: false,
    shift: false,
    meta: false,
    isAutoRepeat: false,
    ...overrides,
  });

  it("matches Ctrl+Q on Windows", () => {
    expect(isQuitShortcut(key(), "win32")).toBe(true);
    expect(isQuitShortcut(key({ key: "Q" }), "win32")).toBe(true);
  });

  it("ignores Ctrl+Q on macOS, which quits with Cmd+Q from the app menu", () => {
    expect(isQuitShortcut(key(), "darwin")).toBe(false);
  });

  it("ignores Ctrl+Shift+Q, Ctrl+Alt+Q and plain Q", () => {
    expect(isQuitShortcut(key({ shift: true }), "win32")).toBe(false);
    expect(isQuitShortcut(key({ alt: true }), "win32")).toBe(false);
    expect(isQuitShortcut(key({ meta: true }), "win32")).toBe(false);
    expect(isQuitShortcut(key({ control: false }), "win32")).toBe(false);
  });

  it("acts on key down only", () => {
    expect(isQuitShortcut(key({ type: "keyUp" }), "win32")).toBe(false);
  });

  it("ignores the auto-repeat of a held Ctrl+Q", () => {
    expect(isQuitShortcut(key({ isAutoRepeat: true }), "win32")).toBe(false);
  });
});

describe("shouldShowTrayHint", () => {
  const ctx = (overrides: Partial<Parameters<typeof shouldShowTrayHint>[0]> = {}) => ({
    platform: "win32" as NodeJS.Platform,
    trayHintShown: false,
    notificationSupported: true,
    ...overrides,
  });

  it("shows the hint the first time the window hides on Windows", () => {
    expect(shouldShowTrayHint(ctx())).toBe(true);
  });

  it("shows it once: not after it was shown", () => {
    expect(shouldShowTrayHint(ctx({ trayHintShown: true }))).toBe(false);
  });

  it("does not spend the hint when notifications are unsupported", () => {
    expect(shouldShowTrayHint(ctx({ notificationSupported: false }))).toBe(false);
  });

  it("never shows on macOS or Linux, which do not hide to the tray", () => {
    expect(shouldShowTrayHint(ctx({ platform: "darwin" }))).toBe(false);
    expect(shouldShowTrayHint(ctx({ platform: "linux" }))).toBe(false);
  });
});

describe("secondInstanceAction", () => {
  it("ignores a second launch before the app is ready", () => {
    expect(secondInstanceAction({ ready: false, recording: false })).toBe("ignore");
    expect(secondInstanceAction({ ready: false, recording: true })).toBe("ignore");
  });

  it("keeps the hidden window hidden during a recording and notifies instead", () => {
    expect(secondInstanceAction({ ready: true, recording: true })).toBe("notify");
  });

  it("brings the main window back when idle", () => {
    expect(secondInstanceAction({ ready: true, recording: false })).toBe("show");
  });
});
