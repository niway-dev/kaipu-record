import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types";
import type { LibraryVideo } from "@renderer/features/library/types";
import { healOrphanMetadata } from "@renderer/features/library/media/heal-orphan-metadata";
import { useOrphanHeal } from "./use-orphan-heal";

vi.mock("@renderer/features/library/media/heal-orphan-metadata", () => ({
  healOrphanMetadata: vi.fn(),
}));
const healMock = vi.mocked(healOrphanMetadata);

function video(over: Partial<LibraryVideo> & Pick<LibraryVideo, "id">): LibraryVideo {
  return {
    kind: "recording",
    title: over.id,
    createdAt: 0,
    durationSeconds: 0,
    fileSizeBytes: 100,
    thumbnailUrl: null,
    storage: "local",
    ...over,
  };
}

function healedRecording(id: string): LocalRecording {
  return {
    id,
    kind: "recording",
    title: id,
    filePath: `/vault/${id}.mp4`,
    createdAt: 0,
    sizeBytes: 100,
    durationSeconds: 54,
    thumbnailUrl: `kaipu-media://thumb/${id}`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  healMock.mockResolvedValue({ durationSeconds: 54, thumbnail: new ArrayBuffer(2) });
  window.electronAPI.backfillLocalRecordingMeta = vi.fn(async (id: string) => healedRecording(id));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useOrphanHeal", () => {
  it("heals a recording orphan and reports the mapped, backfilled result", async () => {
    const onHealed = vi.fn();
    renderHook(() => useOrphanHeal([video({ id: "o1" })], onHealed));

    await waitFor(() => expect(onHealed).toHaveBeenCalledOnce());
    expect(healMock).toHaveBeenCalledWith("o1");
    expect(window.electronAPI.backfillLocalRecordingMeta).toHaveBeenCalledWith("o1", {
      durationSeconds: 54,
      thumbnail: expect.any(ArrayBuffer),
    });
    expect(onHealed).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "o1",
        durationSeconds: 54,
        thumbnailUrl: "kaipu-media://thumb/o1",
        storage: "local",
      }),
    );
  });

  it("heals a recording missing only its thumbnail", async () => {
    const onHealed = vi.fn();
    renderHook(() =>
      useOrphanHeal([video({ id: "o2", durationSeconds: 12, thumbnailUrl: null })], onHealed),
    );
    await waitFor(() => expect(healMock).toHaveBeenCalledWith("o2"));
  });

  it("never touches screenshots, even at zero duration", async () => {
    renderHook(() =>
      useOrphanHeal(
        [video({ id: "shot", kind: "screenshot", thumbnailUrl: "kaipu-media://screenshot/shot" })],
        vi.fn(),
      ),
    );
    await Promise.resolve();
    expect(healMock).not.toHaveBeenCalled();
  });

  it("leaves healthy recordings alone", async () => {
    renderHook(() =>
      useOrphanHeal(
        [video({ id: "ok", durationSeconds: 30, thumbnailUrl: "kaipu-media://thumb/ok" })],
        vi.fn(),
      ),
    );
    await Promise.resolve();
    expect(healMock).not.toHaveBeenCalled();
  });

  it("still persists an in-flight heal when the list re-renders mid-probe", async () => {
    // A Sync/refresh re-renders the list while a heal is still decoding. The probe
    // has already run; the backfill MUST NOT be dropped, or the orphan is marked
    // attempted yet never persisted — permanently un-healed.
    let resolveProbe!: (m: { durationSeconds: number; thumbnail: ArrayBuffer }) => void;
    healMock.mockImplementation(() => new Promise((resolve) => (resolveProbe = resolve)));

    const orphan = video({ id: "slow" });
    const { rerender } = renderHook(({ v }) => useOrphanHeal(v, vi.fn()), {
      initialProps: { v: [orphan] },
    });
    await waitFor(() => expect(healMock).toHaveBeenCalledWith("slow"));

    rerender({ v: [{ ...orphan }] }); // list re-renders while the probe is pending
    resolveProbe({ durationSeconds: 3, thumbnail: new ArrayBuffer(2) });

    await waitFor(() =>
      expect(window.electronAPI.backfillLocalRecordingMeta).toHaveBeenCalledWith(
        "slow",
        expect.objectContaining({ durationSeconds: 3 }),
      ),
    );
  });

  it("attempts each orphan only once across re-renders", async () => {
    const orphans = [video({ id: "once" })];
    const { rerender } = renderHook(({ v }) => useOrphanHeal(v, vi.fn()), {
      initialProps: { v: orphans },
    });
    await waitFor(() => expect(healMock).toHaveBeenCalledOnce());
    rerender({ v: [...orphans] }); // new array identity, same still-orphan item
    await Promise.resolve();
    expect(healMock).toHaveBeenCalledOnce();
  });
});
