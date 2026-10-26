import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { useCameraPreview } from "./use-camera-preview";

// A fake MediaStream whose tracks record when they are stopped, so we can assert
// the camera light is released on disable/unmount.
function fakeStream(): { stream: MediaStream; stop: ReturnType<typeof vi.fn> } {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  return { stream, stop };
}

let getUserMedia: ReturnType<typeof vi.fn>;

beforeEach(() => {
  getUserMedia = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia },
    configurable: true,
  });
});

afterEach(() => vi.restoreAllMocks());

describe("useCameraPreview", () => {
  it("does not open the camera while disabled", () => {
    const { result } = renderHook(() => useCameraPreview(false));
    expect(result.current.hasStream).toBe(false);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("opens a capped 640×480 user-facing stream when enabled", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { result } = renderHook(() => useCameraPreview(true));

    await waitFor(() => expect(result.current.hasStream).toBe(true));
    expect(getUserMedia).toHaveBeenCalledWith({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  });

  it("opens the chosen camera, and falls back to the default when it is gone", async () => {
    const { stream } = fakeStream();
    getUserMedia.mockRejectedValueOnce(new Error("OverconstrainedError"));
    getUserMedia.mockResolvedValueOnce(stream);

    const { result } = renderHook(() => useCameraPreview(true, "cam-2"));

    await waitFor(() => expect(result.current.hasStream).toBe(true));
    expect(getUserMedia).toHaveBeenNthCalledWith(1, {
      video: { deviceId: { exact: "cam-2" }, width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
    expect(getUserMedia).toHaveBeenNthCalledWith(2, {
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false,
    });
  });

  it("stops the tracks and clears hasStream when toggled off", async () => {
    const { stream, stop } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { result, rerender } = renderHook(({ on }) => useCameraPreview(on), {
      initialProps: { on: true },
    });
    await waitFor(() => expect(result.current.hasStream).toBe(true));

    rerender({ on: false });
    await waitFor(() => expect(result.current.hasStream).toBe(false));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("stops the tracks on unmount", async () => {
    const { stream, stop } = fakeStream();
    getUserMedia.mockResolvedValue(stream);

    const { result, unmount } = renderHook(() => useCameraPreview(true));
    await waitFor(() => expect(result.current.hasStream).toBe(true));

    unmount();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("discards a stream that resolves after being disabled mid-request", async () => {
    const { stream, stop } = fakeStream();
    let resolve: (s: MediaStream) => void = () => {};
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((r) => {
        resolve = r;
      }),
    );

    const { result, rerender } = renderHook(({ on }) => useCameraPreview(on), {
      initialProps: { on: true },
    });

    // Disable before the stream resolves, then let it resolve.
    rerender({ on: false });
    await waitFor(() => resolve(stream));

    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(result.current.hasStream).toBe(false);
  });

  it("leaves hasStream false when the camera cannot be opened", async () => {
    getUserMedia.mockRejectedValue(new Error("NotAllowedError"));

    const { result } = renderHook(() => useCameraPreview(true));
    // Give the rejected promise a tick to settle.
    await waitFor(() => expect(getUserMedia).toHaveBeenCalled());
    expect(result.current.hasStream).toBe(false);
  });
});
