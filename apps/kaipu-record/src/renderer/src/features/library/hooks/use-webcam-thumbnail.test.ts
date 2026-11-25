import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types";
import type { WebcamTrackMeta } from "@shared/webcam-track";
import type { LibraryVideo } from "@renderer/features/library/types";
import { composeWebcamThumbnail } from "@renderer/features/library/media/compose-webcam-thumbnail";
import { resetWebcamThumbnailQueue, useWebcamThumbnail } from "./use-webcam-thumbnail";

vi.mock("@renderer/features/library/media/compose-webcam-thumbnail", () => ({
  composeWebcamThumbnail: vi.fn(),
}));
const composeMock = vi.mocked(composeWebcamThumbnail);

const WEBCAM: WebcamTrackMeta = {
  startOffsetMs: 0,
  offsetQuality: "exact",
  width: 1280,
  height: 720,
  fps: 30,
};

function video(
  over: Partial<Omit<LibraryVideo, "id">> & { id: string },
): LibraryVideo & { id: string } {
  return {
    assetId: `asset-${over.id}`,
    kind: "recording",
    title: over.id,
    createdAt: 0,
    durationSeconds: 30,
    fileSizeBytes: 100,
    cloudSizeBytes: null,
    thumbnailUrl: `kaipu-media://thumb/${over.id}`,
    availability: "local",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
    editSavedAt: null,
    editExportedSavedAt: null,
    transcribedAt: null,
    webcam: WEBCAM,
    thumbnailNeedsWebcam: true,
    ...over,
  };
}

function written(id: string): LocalRecording {
  return {
    id,
    assetId: `asset-${id}`,
    kind: "recording",
    title: id,
    filePath: `/vault/${id}.mp4`,
    createdAt: 0,
    sizeBytes: 100,
    durationSeconds: 30,
    thumbnailUrl: `kaipu-media://thumb/${id}?v=2`,
    thumbnailNeedsWebcam: false,
    derivedFromAssetId: null,
    sourceVideoAssetId: null,
    sourceTimeSeconds: null,
    contentSha256: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetWebcamThumbnailQueue();
  composeMock.mockResolvedValue(new ArrayBuffer(3));
  window.electronAPI.writeWebcamThumbnail = vi.fn(async (id: string) => written(id));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useWebcamThumbnail", () => {
  it("processes only webcam recordings whose thumbnail has no bubble yet", async () => {
    const onUpdated = vi.fn();
    renderHook(() =>
      useWebcamThumbnail(
        [
          video({ id: "needs" }),
          video({ id: "done", thumbnailNeedsWebcam: false }),
          video({ id: "plain", webcam: null, thumbnailNeedsWebcam: false }),
          video({ id: "shot", kind: "screenshot", thumbnailNeedsWebcam: true }),
          video({ id: "bad", metadataIssue: "corrupt" }),
        ],
        onUpdated,
      ),
    );

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(composeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "needs", webcam: WEBCAM }),
    );
    expect(window.electronAPI.writeWebcamThumbnail).toHaveBeenCalledWith(
      "needs",
      "asset-needs",
      expect.any(ArrayBuffer),
    );
    expect(onUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "needs",
        thumbnailUrl: "kaipu-media://thumb/needs?v=2",
        thumbnailNeedsWebcam: false,
      }),
    );
  });

  it("leaves an orphan to its heal, and composes it once the healed poster lands", async () => {
    // The heal writes a plain poster: a bubble composed before it would be replaced.
    const onUpdated = vi.fn();
    const orphan = video({ id: "orphan", thumbnailUrl: null, durationSeconds: 0 });
    const { rerender } = renderHook(({ list }) => useWebcamThumbnail(list, onUpdated), {
      initialProps: { list: [orphan] },
    });
    await Promise.resolve();
    expect(composeMock).not.toHaveBeenCalled();

    rerender({
      list: [{ ...orphan, thumbnailUrl: "kaipu-media://thumb/orphan?v=1", durationSeconds: 30 }],
    });

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(composeMock).toHaveBeenCalledWith(
      expect.objectContaining({ id: "orphan", screenUrl: "kaipu-media://thumb/orphan?v=1" }),
    );
  });

  it("never composes an offloaded recording: its poster must not be written over, and the media is not decoded", async () => {
    // evicted "media": the file is not here (the media route answers 409). evicted "thumbnail":
    // the file is, but writing a new poster would replace the offloaded one in the synced folder.
    const onUpdated = vi.fn();
    renderHook(() =>
      useWebcamThumbnail(
        [
          video({ id: "off-media", evicted: "media", thumbnailUrl: null }),
          video({ id: "off-thumb", evicted: "thumbnail", thumbnailUrl: null }),
          video({ id: "plain" }),
        ],
        onUpdated,
      ),
    );

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(composeMock).toHaveBeenCalledWith(expect.objectContaining({ id: "plain" }));
  });

  it("composes a recording once across every page that lists it, and tells each of them", async () => {
    const library = vi.fn();
    const detail = vi.fn();
    const items = [video({ id: "needs" })];
    const first = renderHook(() => useWebcamThumbnail(items, library));
    renderHook(() => useWebcamThumbnail(items, detail));
    first.unmount();

    await waitFor(() => expect(detail).toHaveBeenCalledOnce());
    expect(composeMock).toHaveBeenCalledTimes(1);
    expect(library).not.toHaveBeenCalled();
    expect(detail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "needs", thumbnailNeedsWebcam: false }),
    );
  });

  it("keys what it attempted by asset id, so another recording under the same file id is composed", async () => {
    const onUpdated = vi.fn();
    const first = [video({ id: "same", assetId: "asset-a" })];
    const { rerender } = renderHook(({ list }) => useWebcamThumbnail(list, onUpdated), {
      initialProps: { list: first },
    });
    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());

    // A workspace switch lists a different recording with the same file id.
    rerender({ list: [video({ id: "same", assetId: "asset-b" })] });

    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(2));
    expect(composeMock).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.writeWebcamThumbnail).toHaveBeenLastCalledWith(
      "same",
      "asset-b",
      expect.anything(),
    );
  });

  it("composes one recording at a time, never in parallel", async () => {
    const releases: Array<() => void> = [];
    let inFlight = 0;
    let peak = 0;
    composeMock.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise<void>((resolve) => releases.push(resolve));
      inFlight--;
      return new ArrayBuffer(3);
    });
    const onUpdated = vi.fn();
    renderHook(() =>
      useWebcamThumbnail([video({ id: "a" }), video({ id: "b" }), video({ id: "c" })], onUpdated),
    );

    await waitFor(() => expect(releases).toHaveLength(1));
    await Promise.resolve();
    expect(composeMock).toHaveBeenCalledTimes(1); // b and c wait for a
    releases[0]!();
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[1]!();
    await waitFor(() => expect(releases).toHaveLength(3));
    releases[2]!();
    await waitFor(() => expect(onUpdated).toHaveBeenCalledTimes(3));
    expect(peak).toBe(1);
  });

  it("skips a failure, logs it once, and does not retry it while the app stays open", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    composeMock.mockRejectedValueOnce(new Error("no frame"));
    const onUpdated = vi.fn();
    const items = [video({ id: "bad" }), video({ id: "good" })];
    const { rerender } = renderHook(({ list }) => useWebcamThumbnail(list, onUpdated), {
      initialProps: { list: items },
    });

    await waitFor(() => expect(onUpdated).toHaveBeenCalledOnce());
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ id: "good" }));
    rerender({ list: [...items] }); // a later scan lists the same items again
    await Promise.resolve();

    expect(composeMock).toHaveBeenCalledTimes(2); // bad once, good once
    expect(window.electronAPI.writeWebcamThumbnail).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });
});
