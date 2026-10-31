import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ImportVideoResult } from "@shared/import-video";
import type { LocalRecording } from "@shared/types/library-storage";
import { showToast } from "@renderer/ui/toast-store";
import { usePrepareImport } from "./use-prepare-import";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("@renderer/ui/toast-store", () => ({ showToast: vi.fn() }));

const recording = (title: string, assetId: string): LocalRecording => ({
  id: `imported-${assetId}`,
  assetId,
  kind: "recording",
  title,
  filePath: `/vault/imported-${assetId}.mov`,
  createdAt: 1,
  sizeBytes: 10,
  durationSeconds: 3,
  derivedFromAssetId: null,
  contentSha256: null,
  capture: { mode: "import", width: 1080, height: 1920, ratio: null },
});

/** An `importVideos` that answers only when the test says so. */
function deferredImport(): (r: ImportVideoResult) => void {
  let finish: (r: ImportVideoResult) => void = () => {};
  window.electronAPI.importVideos = vi.fn(
    () => new Promise<ImportVideoResult>((resolve) => (finish = resolve)),
  );
  return (r) => finish(r);
}

describe("usePrepareImport", () => {
  beforeEach(() => {
    navigate.mockClear();
    vi.mocked(showToast).mockClear();
  });

  it("opens Export on the imported video while the screen is open", async () => {
    const finish = deferredImport();
    const refresh = vi.fn(async () => {});
    const { result } = renderHook(() => usePrepareImport({ destination: () => "chat", refresh }));

    let done: Promise<void> = Promise.resolve();
    // Async act: the import starts on the hook's queue, a microtask later.
    await act(async () => {
      done = result.current.pickAndImport();
    });
    await act(async () => {
      finish({ imported: [recording("a", "asset-1")], failed: [], canceled: false });
      await done;
    });

    expect(refresh).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/export/asset-1?to=chat");
  });

  it("does not pull the user back when the import ends after they left Export", async () => {
    const finish = deferredImport();
    const refresh = vi.fn(async () => {});
    const { result, unmount } = renderHook(() =>
      usePrepareImport({ destination: () => "chat", refresh }),
    );

    let done: Promise<void> = Promise.resolve();
    // Async act: the import starts on the hook's queue, a microtask later.
    await act(async () => {
      done = result.current.pickAndImport();
    });
    unmount();
    await act(async () => {
      finish({ imported: [recording("a", "asset-1")], failed: [], canceled: false });
      await done;
    });

    expect(navigate).not.toHaveBeenCalled();
    const [[spec]] = vi.mocked(showToast).mock.calls as [[Parameters<typeof showToast>[0]]];
    expect(spec.message).toBe("“a” is in your Library");
    spec.action?.onClick();
    expect(navigate).toHaveBeenCalledWith("/library/asset-1");
  });
});
