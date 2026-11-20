import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { EXPORT_SETTINGS_KEY } from "@renderer/features/screenshots/export/export-settings-store";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

// The image exporter (NIW2-852) lives in canvas mode, behind `image-canvas`.
let imageCanvas = false;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));
// The encoder needs a real canvas; what the page hands it is what these tests pin.
const exportImage = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export/image-exporter", () => ({ exportImage }));

const originalRect = Element.prototype.getBoundingClientRect;
const bytes = new Uint8Array([1, 2, 3]).buffer;
// A pasted image runs no auto action: the test drives every save by hand.
const PASTE: ImageSource = { kind: "blob", bytes, width: 400, height: 400, origin: "paste" };

const encoded = (extension: string, size = 2000) => ({
  bytes: new ArrayBuffer(size),
  width: 400,
  height: 400,
  plan: { extension },
});

beforeEach(async () => {
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  exportImage.mockReset();
  exportImage.mockResolvedValue(encoded("webp"));
  window.electronAPI.saveScreenshot = vi.fn(async (_png: ArrayBuffer, opts: { title: string }) => ({
    id: "s1",
    assetId: "a-s1",
    title: opts.title,
    kind: "screenshot",
  })) as never;
  window.electronAPI.exportScreenshotFile = vi.fn(async () => ({
    path: "/tmp/Shot.webp",
  })) as never;
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Object.defineProperty(HTMLImageElement.prototype, prop, {
      configurable: true,
      get: () => 400,
    });
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
});
afterEach(() => {
  imageCanvas = false;
  localStorage.clear();
  getToasts().forEach((x) => dismissToast(x.id));
  // @ts-expect-error — drop the stubs put on the prototypes
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — see above
  delete HTMLElement.prototype.clientHeight;
  // @ts-expect-error — see above
  delete HTMLImageElement.prototype.naturalWidth;
  // @ts-expect-error — see above
  delete HTMLImageElement.prototype.naturalHeight;
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture
  delete Element.prototype.setPointerCapture;
});

function mount(source: ImageSource) {
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: source }] },
  );
  return render(<RouterProvider router={router} />);
}
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
const openPopover = () => fireEvent.click(screen.getByRole("button", { name: "Export" }));
const radio = (name: string) => screen.getByRole("radio", { name });

describe("ScreenshotEditorPage — Save is unchanged", () => {
  it("flag off: no Export button, and one-click Save writes the PNG to the library", async () => {
    mount(PASTE);
    await loadImage();
    expect(screen.queryByRole("button", { name: "Export" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(1));
    expect(exportScene.mock.calls.map((c) => c[0])).toEqual(["png"]);
    expect(exportImage).not.toHaveBeenCalled();
    expect(window.electronAPI.exportScreenshotFile).not.toHaveBeenCalled();
  });

  it("reads the display width with the scene snapshot, not after the byte read", async () => {
    // A padding change landing while the bytes are read resizes the displayed image; the
    // export must still pair the snapshot with the width it was taken at (200 here).
    let resizeOnRead = false;
    const source: ImageSource = {
      kind: "blob",
      width: 400,
      height: 400,
      origin: "paste",
      get bytes() {
        if (resizeOnRead) {
          for (const prop of ["clientWidth", "clientHeight"]) {
            Object.defineProperty(HTMLElement.prototype, prop, {
              configurable: true,
              get: () => 300,
            });
          }
        }
        return bytes;
      },
    };
    mount(source);
    await loadImage();
    resizeOnRead = true;
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(exportScene).toHaveBeenCalledTimes(1));
    expect(exportScene.mock.calls[0][1]).toMatchObject({ displayedW: 200 });
  });

  it("flag on with the default settings: one-click Save still writes the PNG", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(1));
    expect(exportScene.mock.calls.map((c) => c[0])).toEqual(["png"]);
    expect(exportImage).not.toHaveBeenCalled();
  });

  it("flag on with WebP remembered: Save is still the PNG (the library holds PNGs)", async () => {
    imageCanvas = true;
    localStorage.setItem(
      EXPORT_SETTINGS_KEY,
      JSON.stringify({ format: "webp", quality: 0.8, scale: 1, maxSide: 1920 }),
    );
    mount(PASTE);
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(1));
    expect(exportScene.mock.calls.map((c) => c[0])).toEqual(["png"]);
    expect(exportImage).not.toHaveBeenCalled();
  });
});

describe("ScreenshotEditorPage — Export popover (image-canvas)", () => {
  it("opens on Original: PNG, 1×, with the pixel size and no quality to set", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    openPopover();
    expect(radio("Original").getAttribute("aria-checked")).toBe("true");
    expect(radio("PNG").getAttribute("aria-checked")).toBe("true");
    expect(radio("1×").getAttribute("aria-checked")).toBe("true");
    // The export box on the canvas says the same size; this is the popover's own line.
    const popover = within(screen.getByRole("dialog", { name: "Export image" }));
    expect(popover.getByText("400 × 400 px")).toBeTruthy();
    expect((popover.getByRole("slider") as HTMLInputElement).disabled).toBe(true);
  });

  it("measures the real file size once after a change", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(radio("Web"));
    expect(screen.getByText("Measuring size…")).toBeTruthy();
    expect(await screen.findByText("≈ 2.0 KB")).toBeTruthy();
    expect(exportImage).toHaveBeenCalledTimes(1);
    expect(exportImage.mock.calls[0][0]).toMatchObject({ format: "webp", maxSide: 1920 });
  });

  it("exports with the chosen settings, names the file by format and remembers them", async () => {
    imageCanvas = true;
    const out = encoded("webp");
    exportImage.mockResolvedValue(out);
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(radio("Web"));
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(window.electronAPI.exportScreenshotFile).toHaveBeenCalledTimes(1));
    const [sent, meta] = vi.mocked(window.electronAPI.exportScreenshotFile).mock.calls[0];
    // The bytes written are the encoder's output, untouched, and the name follows its format.
    expect(sent).toBe(out.bytes);
    expect(meta.extension).toBe("webp");
    // The popover closes and the library is untouched: an export is a file for someone else.
    expect(screen.queryByRole("dialog", { name: "Export image" })).toBeNull();
    expect(window.electronAPI.saveScreenshot).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem(EXPORT_SETTINGS_KEY)!)).toMatchObject({
      format: "webp",
      quality: 0.8,
    });
  });

  it("changing a field leaves the preset", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(radio("Web"));
    fireEvent.click(radio("JPEG"));
    expect(radio("Custom").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Web", checked: true })).toBeNull();
  });

  it("clicking the already-selected option keeps the preset and its size cap", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(radio("Web"));
    fireEvent.click(radio("WebP"));
    fireEvent.click(radio("1×"));
    expect(radio("Web").getAttribute("aria-checked")).toBe("true");
    expect(screen.queryByRole("radio", { name: "Custom" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(exportImage).toHaveBeenCalled());
    expect(exportImage.mock.calls.at(-1)![0]).toMatchObject({ format: "webp", maxSide: 1920 });
  });

  it("says the size could not be measured when the estimate encode fails", async () => {
    imageCanvas = true;
    exportImage.mockRejectedValue(new Error("encode failed"));
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(radio("Web"));
    expect(await screen.findByText("Couldn't measure the size")).toBeTruthy();
    expect(screen.queryByText("Measuring size…")).toBeNull();
  });

  it("Esc closes the popover and returns focus to the Export button", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    openPopover();
    expect(screen.getByRole("dialog", { name: "Export image" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Export image" })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Export" }));
  });

  it("says a JPEG paints transparent areas white, only for JPEG on no background", async () => {
    imageCanvas = true;
    mount(PASTE);
    await loadImage();
    openPopover();
    expect(screen.queryByText("Transparent areas become white in JPEG.")).toBeNull();
    fireEvent.click(radio("JPEG"));
    expect(screen.getByText("Transparent areas become white in JPEG.")).toBeTruthy();
    fireEvent.click(radio("WebP"));
    expect(screen.queryByText("Transparent areas become white in JPEG.")).toBeNull();
  });

  it("a cancelled save dialog is not an error", async () => {
    imageCanvas = true;
    window.electronAPI.exportScreenshotFile = vi.fn(async () => null) as never;
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(window.electronAPI.exportScreenshotFile).toHaveBeenCalled());
    // The cancelled result is handled one microtask later; let the queue drain before asserting.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(getToasts()).toHaveLength(0);
    expect(screen.queryByText("Exported")).toBeNull();
  });

  it("reports a failed encode with a retry", async () => {
    imageCanvas = true;
    exportImage.mockRejectedValue(new Error("encode failed"));
    mount(PASTE);
    await loadImage();
    openPopover();
    fireEvent.click(screen.getByRole("button", { name: "Export…" }));
    await waitFor(() => expect(getToasts().length).toBeGreaterThan(0));
    expect(window.electronAPI.exportScreenshotFile).not.toHaveBeenCalled();
    expect(exportImage).toHaveBeenCalledTimes(1);

    // Retry runs the export again with the same settings; this time it encodes and writes.
    exportImage.mockResolvedValue(encoded("png"));
    const retry = getToasts()[0].action;
    expect(retry).toBeDefined();
    await act(async () => {
      retry!.onClick();
    });
    await waitFor(() => expect(window.electronAPI.exportScreenshotFile).toHaveBeenCalledTimes(1));
    expect(exportImage).toHaveBeenCalledTimes(2);
    expect(exportImage.mock.calls[1][0]).toEqual(exportImage.mock.calls[0][0]);
  });
});
