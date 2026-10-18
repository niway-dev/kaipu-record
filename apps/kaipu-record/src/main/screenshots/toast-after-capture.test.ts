import { describe, expect, it, vi } from "vitest";
import type { CaptureToastPayload } from "@shared/types/screenshot-capture";
import { deferToastUntilAfterCapture } from "./toast-after-capture";

const PAYLOAD: CaptureToastPayload = {
  thumbnail: "data:image/png;base64,AAAA",
  width: 800,
  height: 600,
  mode: "frame",
  saved: { id: "screenshot-1" },
  copied: true,
};

function setup() {
  const calls: string[] = [];
  const windows = {
    beforeCapture: vi.fn(() => calls.push("before")),
    afterCapture: vi.fn((_editor: boolean) => calls.push("after")),
    reveal: vi.fn(() => calls.push("reveal")),
  };
  const showToast = vi.fn(() => calls.push("toast"));
  const seam = deferToastUntilAfterCapture(windows, showToast, () => 7);
  return { calls, windows, showToast, seam };
}

describe("deferToastUntilAfterCapture", () => {
  it("shows the toast only once afterCapture has restored the windows", () => {
    const { calls, showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onPick({
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 3,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    });
    seam.onQuietCapture(PAYLOAD);
    expect(showToast).not.toHaveBeenCalled();

    seam.windows.afterCapture(false);

    expect(calls).toEqual(["before", "after", "toast"]);
    expect(showToast).toHaveBeenCalledWith({ ...PAYLOAD, displayId: 3 });
  });

  it("uses the fallback display when no overlay answered (single-display Screen)", () => {
    const { showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD);
    seam.windows.afterCapture(false);
    expect(showToast).toHaveBeenCalledWith({ ...PAYLOAD, displayId: 7 });
  });

  it("shows nothing for a capture that was not quiet, and never a previous capture's toast", () => {
    const { showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD);
    seam.windows.beforeCapture(); // a new capture starts before the old one finished
    seam.windows.afterCapture(true);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("forgets the picked display between captures", () => {
    const { showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onPick({ kind: "display", mode: "screen", action: "copy", displayId: 3 });
    seam.windows.afterCapture(false);
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD);
    seam.windows.afterCapture(false);
    expect(showToast).toHaveBeenCalledWith({ ...PAYLOAD, displayId: 7 });
  });

  it("still shows the toast when restoring the windows throws, and a broken toast never throws", () => {
    const { windows, showToast, seam } = setup();
    windows.afterCapture.mockImplementationOnce(() => {
      throw new Error("window gone");
    });
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD);
    expect(() => seam.windows.afterCapture(false)).toThrow("window gone");
    expect(showToast).toHaveBeenCalledTimes(1);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    showToast.mockImplementationOnce(() => {
      throw new Error("toast gone");
    });
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD);
    expect(() => seam.windows.afterCapture(false)).not.toThrow();
    error.mockRestore();
  });

  it("passes reveal through", () => {
    const { windows, seam } = setup();
    seam.windows.reveal();
    expect(windows.reveal).toHaveBeenCalledTimes(1);
  });
});
