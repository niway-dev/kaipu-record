import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

const bytes = new Uint8Array([1, 2, 3]).buffer;
// A pasted image runs no auto action: the test drives every save by hand.
const PASTE: ImageSource = { kind: "blob", bytes, width: 4, height: 4, origin: "paste" };
// A capture whose vault write failed in main: the editor auto-saves it on open.
const CAPTURE: ImageSource = { kind: "blob", bytes, width: 4, height: 4, title: "Shot" };
const saved = (id: string, title = "Shot") => ({
  id,
  assetId: `a-${id}`,
  title,
  kind: "screenshot",
});

type Settings = Awaited<ReturnType<typeof window.electronAPI.getSettings>>;
let base: Settings;
beforeEach(async () => {
  base = await window.electronAPI.getSettings();
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  // Echo the requested title, like the real vault.
  window.electronAPI.saveScreenshot = vi.fn(async (_png: ArrayBuffer, opts: { title: string }) =>
    saved("s1", opts.title),
  ) as never;
  window.electronAPI.copyImageToClipboard = vi.fn(async () => {});
});
afterEach(() => getToasts().forEach((x) => dismissToast(x.id)));

function mount(source: ImageSource, getSettings?: () => Promise<Settings>) {
  window.electronAPI.getSettings =
    getSettings ?? vi.fn(async () => ({ ...base, screenshotCopy: "manual" as const }));
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/library", element: <div>library</div> },
      { path: "/screenshots", element: <div>screenshots</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: source }] },
  );
  return { router, view: render(<RouterProvider router={router} />) };
}
// jsdom never fires <img> load; firing it flips `imageReady`.
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
// The Padding slider changes scene.beautify.state, which fires the dirty effect.
const editPadding = () => {
  const range = screen
    .getByText("Padding")
    .parentElement!.parentElement!.querySelector("input[type=range]")!;
  fireEvent.keyDown(range);
  fireEvent.change(range, { target: { value: "40" } });
  fireEvent.keyUp(range);
};
const saveCalls = () => vi.mocked(window.electronAPI.saveScreenshot).mock.calls;

describe("ScreenshotEditorPage — save races", () => {
  it("saves an edit that lands during a save instead of marking it clean (SHOT-B1)", async () => {
    const { router } = mount(PASTE);
    await loadImage();
    const d = deferred<ArrayBuffer>();
    exportScene.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(exportScene).toHaveBeenCalledTimes(1)); // the save is running
    editPadding();
    d.resolve(new ArrayBuffer(1));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    await act(async () => {});
    act(() => void router.navigate("/library"));
    // The leave-time autosave writes the edit over the first save, then navigates.
    expect(await screen.findByText("library")).toBeInTheDocument();
    expect(saveCalls()).toHaveLength(2);
    expect(saveCalls()[1][1]).toMatchObject({ overwriteId: "s1" });
  });

  it("navigates freely after a save with no edit in between (control)", async () => {
    const { router } = mount(PASTE);
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    await act(async () => {});
    act(() => void router.navigate("/library"));
    expect(await screen.findByText("library")).toBeInTheDocument();
    expect(saveCalls()).toHaveLength(1);
  });

  it("does not overwrite a title typed during the save", async () => {
    mount(PASTE);
    await loadImage();
    const d = deferred<ArrayBuffer>();
    exportScene.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(exportScene).toHaveBeenCalledTimes(1)); // the save is running
    const title = screen.getByRole("textbox", { name: /title/i });
    fireEvent.change(title, { target: { value: "Mine" } });
    d.resolve(new ArrayBuffer(1));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    await act(async () => {});
    expect((title as HTMLInputElement).value).toBe("Mine");
  });

  it("runs a Copy clicked during a save after it, instead of dropping it (SHOT-B9)", async () => {
    mount(PASTE);
    await loadImage();
    const d = deferred<ArrayBuffer>();
    exportScene.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(window.electronAPI.copyImageToClipboard).not.toHaveBeenCalled();
    d.resolve(new ArrayBuffer(1));
    await waitFor(() => expect(window.electronAPI.copyImageToClipboard).toHaveBeenCalledTimes(1));
  });

  it("ignores a toast Retry after unmount (SHOT-B9)", async () => {
    window.electronAPI.saveScreenshot = vi.fn().mockRejectedValueOnce(new Error("disk")) as never;
    const { view } = mount(PASTE);
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    view.unmount();
    getToasts()[0].action!.onClick();
    await act(async () => {});
    expect(saveCalls()).toHaveLength(1);
  });

  it("auto-saves when settings resolve after the image loaded (SHOT-B8)", async () => {
    const s = deferred<Settings>();
    mount(CAPTURE, () => s.promise);
    await loadImage();
    expect(saveCalls()).toHaveLength(0);
    await act(async () => s.resolve({ ...base, screenshotCopy: "manual" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
  });

  it("hides Discard after a manual Save copy (SHOT-B4)", async () => {
    window.electronAPI.saveScreenshot = vi
      .fn()
      .mockResolvedValueOnce(saved("auto1"))
      .mockResolvedValueOnce(saved("copy1", "Shot (copy)")) as never;
    mount(CAPTURE);
    await loadImage();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument(),
    );
    // The auto-save left the button in its "Saved" state.
    fireEvent.click(screen.getByRole("button", { name: /^saved?$/i }));
    fireEvent.click(await screen.findByRole("button", { name: /save (a )?copy/i }));
    await waitFor(() => expect(saveCalls()).toHaveLength(2));
    await waitFor(() => expect(screen.queryByRole("button", { name: /discard/i })).toBeNull());
  });

  it("turns a double Save on a fresh shot into an overwrite of the first save", async () => {
    mount(PASTE);
    await loadImage();
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(saveCalls()).toHaveLength(2));
    expect(saveCalls()[1][1]).toMatchObject({ overwriteId: "s1" });
  });
});

describe("ScreenshotEditorPage — rename moves the file (NIW2-560)", () => {
  const renameResult = (id: string, title: string, file = "renamed", reason?: string) => ({
    file,
    reason,
    recording: { ...saved(id, title), filePath: `/vault/${id}.png` },
  });

  /** Save a pasted shot (bound to "s1"), then commit a new title in the field. */
  async function saveThenRename(title: string): Promise<void> {
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveCalls()).toHaveLength(1));
    await act(async () => {});
    const field = screen.getByRole("textbox", { name: /title/i });
    fireEvent.change(field, { target: { value: title } });
    fireEvent.blur(field);
  }

  it("a save that follows a rename in flight overwrites the new id, not the vanished one", async () => {
    const d = deferred<ReturnType<typeof renameResult>>();
    window.electronAPI.renameLocalRecording = vi.fn(() => d.promise) as never;
    const { router } = mount(PASTE);
    await saveThenRename("Sprint demo");
    await waitFor(() =>
      expect(window.electronAPI.renameLocalRecording).toHaveBeenCalledWith("s1", "Sprint demo"),
    );
    // An edit and a leave while the file is still moving: the autosave must wait for it.
    editPadding();
    act(() => void router.navigate("/library"));
    await act(async () => {});
    expect(saveCalls()).toHaveLength(1);

    d.resolve(renameResult("Sprint demo", "Sprint demo"));
    expect(await screen.findByText("library")).toBeInTheDocument();
    expect(saveCalls()).toHaveLength(2);
    // The identity rides along, so main can follow a rename it has not seen yet.
    expect(saveCalls()[1][1]).toMatchObject({
      overwriteId: "Sprint demo",
      overwriteAssetId: "a-Sprint demo",
    });
  });

  it("shows a Retry toast when the file kept its old name, and retries on the same id", async () => {
    const rename = vi.fn(async (id: string, title: string) =>
      renameResult(id, title, "kept-old-name", "locked"),
    );
    window.electronAPI.renameLocalRecording = rename as never;
    mount(PASTE);
    await saveThenRename("Locked");
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    const [toast] = getToasts();
    expect(toast!.message).toMatch(/another app is using it/i);

    await act(async () => toast!.action!.onClick());
    await waitFor(() => expect(rename).toHaveBeenCalledTimes(2));
    expect(rename).toHaveBeenLastCalledWith("s1", "Locked");
  });
});
