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
    afterCapture: vi.fn((_ending: string) => calls.push("after")),
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
    seam.onQuietCapture(PAYLOAD, 3);
    expect(showToast).not.toHaveBeenCalled();

    seam.windows.afterCapture("quiet");

    expect(calls).toEqual(["before", "after", "toast"]);
    expect(showToast).toHaveBeenCalledWith({ ...PAYLOAD, displayId: 3 });
  });

  it("uses the fallback display when no overlay answered (the instant capture)", () => {
    const { showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD, null);
    seam.windows.afterCapture("quiet");
    expect(showToast).toHaveBeenCalledWith({ ...PAYLOAD, displayId: 7 });
  });

  it("shows nothing for a capture that was not quiet, and never a previous capture's toast", () => {
    const { showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD, null);
    seam.windows.beforeCapture(); // a new capture starts before the old one finished
    seam.windows.afterCapture("editor");
    expect(showToast).not.toHaveBeenCalled();
  });

  it("keeps each capture's display with its own toast", () => {
    const { showToast, seam } = setup();
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD, 3);
    seam.windows.afterCapture("handedOver");
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD, null);
    seam.windows.afterCapture("quiet");
    expect(showToast).toHaveBeenNthCalledWith(1, { ...PAYLOAD, displayId: 3 });
    expect(showToast).toHaveBeenNthCalledWith(2, { ...PAYLOAD, displayId: 7 });
  });

  it("still shows the toast when restoring the windows throws, and a broken toast never throws", () => {
    const { windows, showToast, seam } = setup();
    windows.afterCapture.mockImplementationOnce(() => {
      throw new Error("window gone");
    });
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD, null);
    expect(() => seam.windows.afterCapture("quiet")).toThrow("window gone");
    expect(showToast).toHaveBeenCalledTimes(1);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    showToast.mockImplementationOnce(() => {
      throw new Error("toast gone");
    });
    seam.windows.beforeCapture();
    seam.onQuietCapture(PAYLOAD, null);
    expect(() => seam.windows.afterCapture("quiet")).not.toThrow();
    error.mockRestore();
  });

  it("passes reveal through", () => {
    const { windows, seam } = setup();
    seam.windows.reveal();
    expect(windows.reveal).toHaveBeenCalledTimes(1);
  });
});
