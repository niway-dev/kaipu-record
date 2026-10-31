import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { ImportVideoResult } from "@shared/import-video";
import type { LocalRecording } from "@shared/types/library-storage";
import { showToast } from "@renderer/ui/toast-store";
import { reportError } from "@renderer/features/analytics";
import { useImportVideos } from "./use-import-videos";

const navigate = vi.fn();
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("@renderer/ui/toast-store", () => ({ showToast: vi.fn() }));
vi.mock("@renderer/features/analytics", () => ({ reportError: vi.fn() }));

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

const result = (over: Partial<ImportVideoResult>): ImportVideoResult => ({
  imported: [],
  failed: [],
  canceled: false,
  ...over,
});

const file = (name: string): File => new File(["x"], name);

/** The messages of every toast shown so far. */
const toasts = (): string[] => vi.mocked(showToast).mock.calls.map(([spec]) => spec.message);

describe("useImportVideos", () => {
  beforeEach(() => {
    vi.mocked(showToast).mockClear();
    vi.mocked(reportError).mockClear();
    navigate.mockClear();
  });

  it("offers to open the item when exactly one video came in", async () => {
    window.electronAPI.importVideos = vi.fn(async () =>
      result({ imported: [recording("IMG_1234", "asset-1")] }),
    );
    const { result: hook } = renderHook(() => useImportVideos());

    await act(() => hook.current.pickAndImport());

    const [[spec]] = vi.mocked(showToast).mock.calls as [[Parameters<typeof showToast>[0]]];
    expect(spec.message).toBe("“IMG_1234” is in your Library");
    expect(spec.action?.label).toBe("Open");
    spec.action?.onClick();
    expect(navigate).toHaveBeenCalledWith("/library/asset-1");
  });

  it("counts several imports, without an Open action", async () => {
    window.electronAPI.importVideos = vi.fn(async () =>
      result({ imported: [recording("a", "1"), recording("b", "2")] }),
    );
    const { result: hook } = renderHook(() => useImportVideos());
    await act(() => hook.current.pickAndImport());
    expect(vi.mocked(showToast).mock.calls[0]?.[0]).toEqual({ message: "2 videos imported" });
  });

  it("names the file and the reason when one fails, and every file when several do", async () => {
    window.electronAPI.importVideos = vi
      .fn()
      .mockResolvedValueOnce(
        result({ failed: [{ fileName: "voice.m4v", reason: "no-video-track" }] }),
      )
      .mockResolvedValueOnce(
        result({
          failed: [
            { fileName: "a.mov", reason: "unreadable" },
            { fileName: "b.mp4", reason: "copy-failed" },
          ],
        }),
      );
    const { result: hook } = renderHook(() => useImportVideos());

    await act(() => hook.current.pickAndImport());
    await act(() => hook.current.pickAndImport());

    expect(toasts()).toEqual([
      "Couldn’t import voice.m4v: it has no video in it",
      "Couldn’t import 2 files: a.mov, b.mp4",
    ]);
  });

  it("hands what came in to onImported instead of the toast; failures are still reported (NIW2-587)", async () => {
    window.electronAPI.importVideos = vi.fn(async () =>
      result({
        imported: [recording("a", "1"), recording("b", "2")],
        failed: [{ fileName: "c.mov", reason: "unreadable" }],
      }),
    );
    const onImported = vi.fn();
    const { result: hook } = renderHook(() => useImportVideos({ onImported }));

    await act(() => hook.current.pickAndImport());

    expect(onImported).toHaveBeenCalledWith([recording("a", "1"), recording("b", "2")]);
    expect(toasts()).toEqual(["Couldn’t import c.mov: Kaipu can’t read this video"]);
  });

  it("does not call onImported when nothing came in", async () => {
    window.electronAPI.importVideos = vi.fn(async () =>
      result({ failed: [{ fileName: "c.mov", reason: "unreadable" }] }),
    );
    const onImported = vi.fn();
    const { result: hook } = renderHook(() => useImportVideos({ onImported }));
    await act(() => hook.current.pickAndImport());
    expect(onImported).not.toHaveBeenCalled();
  });

  it("says nothing when the dialog is closed", async () => {
    window.electronAPI.importVideos = vi.fn(async () => result({ canceled: true }));
    const { result: hook } = renderHook(() => useImportVideos());
    await act(() => hook.current.pickAndImport());
    expect(showToast).not.toHaveBeenCalled();
  });

  it("reports an IPC failure instead of swallowing it, and is ready again after", async () => {
    window.electronAPI.importVideos = vi.fn(async () => {
      throw new Error("ipc down");
    });
    const { result: hook } = renderHook(() => useImportVideos());
    await act(() => hook.current.pickAndImport());
    expect(reportError).toHaveBeenCalledOnce();
    expect(hook.current.importing).toBe(false);
  });

  it("sends only dropped videos to main, by path, and skips the rest with a toast", async () => {
    window.electronAPI.pathForFile = vi.fn((f: File) =>
      f.name === "web.mp4" ? "" : `/in/${f.name}`,
    );
    window.electronAPI.importVideoFiles = vi.fn(async () => result({}));
    const { result: hook } = renderHook(() => useImportVideos());

    await act(() =>
      hook.current.importDropped([
        file("IMG_1234.MOV"),
        file("notes.pdf"),
        file("zoom.mp4"),
        file("web.mp4"),
      ]),
    );

    expect(window.electronAPI.importVideoFiles).toHaveBeenCalledWith([
      "/in/IMG_1234.MOV",
      "/in/zoom.mp4",
    ]);
    expect(toasts()).toEqual([
      "Only videos can be imported (MP4, MOV, M4V or WebM). Skipped: notes.pdf",
      "Couldn’t import web.mp4: not a file on your computer. Save it first, then drop it again.",
    ]);
  });

  it("queues a drop that lands while an import runs, instead of discarding it", async () => {
    window.electronAPI.pathForFile = vi.fn((f: File) => `/in/${f.name}`);
    let finishFirst: (r: ImportVideoResult) => void = () => {};
    window.electronAPI.importVideoFiles = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<ImportVideoResult>((resolve) => (finishFirst = resolve)),
      )
      .mockResolvedValueOnce(result({ imported: [recording("b", "2")] }));
    const { result: hook } = renderHook(() => useImportVideos());

    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    await act(async () => {
      first = hook.current.importDropped([file("a.mp4")]);
      second = hook.current.importDropped([file("b.mp4")]);
    });
    expect(window.electronAPI.importVideoFiles).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.importVideoFiles).toHaveBeenCalledWith(["/in/a.mp4"]);
    expect(hook.current.importing).toBe(true);

    await act(async () => {
      finishFirst(result({ imported: [recording("a", "1")] }));
      await first;
      await second;
    });

    expect(window.electronAPI.importVideoFiles).toHaveBeenLastCalledWith(["/in/b.mp4"]);
    expect(toasts()).toEqual(["“a” is in your Library", "“b” is in your Library"]);
    expect(hook.current.importing).toBe(false);
  });

  it("does not call main when nothing dropped is a video", async () => {
    window.electronAPI.importVideoFiles = vi.fn(async () => result({}));
    const { result: hook } = renderHook(() => useImportVideos());
    await act(() => hook.current.importDropped([file("notes.txt")]));
    expect(window.electronAPI.importVideoFiles).not.toHaveBeenCalled();
  });
});
