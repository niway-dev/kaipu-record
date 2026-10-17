import { describe, expect, it, vi } from "vitest";
import {
  closeAction,
  handleMainWindowClose,
  shouldQuitOnAllWindowsClosed,
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
});
