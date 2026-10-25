import { describe, expect, it, vi } from "vitest";
import { routeCaptureRequest } from "./capture-request";

describe("routeCaptureRequest", () => {
  it("notifies and does not forward while a recording is active", () => {
    const notifyBusy = vi.fn();
    const forwardToRenderer = vi.fn();
    routeCaptureRequest({ isRecordingActive: () => true, notifyBusy, forwardToRenderer });
    expect(notifyBusy).toHaveBeenCalledTimes(1);
    expect(forwardToRenderer).not.toHaveBeenCalled();
  });

  it("forwards to the renderer when no recording is active", () => {
    const notifyBusy = vi.fn();
    const forwardToRenderer = vi.fn();
    routeCaptureRequest({ isRecordingActive: () => false, notifyBusy, forwardToRenderer });
    expect(forwardToRenderer).toHaveBeenCalledTimes(1);
    expect(notifyBusy).not.toHaveBeenCalled();
  });
});
