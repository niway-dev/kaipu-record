import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

// NIW2-759: entering and leaving the crop tool. The crop tool shows the whole image with the
// frame; leaving it (Done, Enter, Esc, a click on the stage, another tool) keeps the crop and
// shows only the cropped part, with a "Cropped" chip that brings the user back. Classic crop and
// the canvas export frame alike.

let imageCanvas = false;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

const originalRect = Element.prototype.getBoundingClientRect;
const bytes = new Uint8Array([1, 2, 3]).buffer;
const PASTE: ImageSource = { kind: "blob", bytes, width: 4, height: 4, origin: "paste" };

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

function mount(): void {
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/screenshots", element: <div>screenshots</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: PASTE }] },
  );
  render(<RouterProvider router={router} />);
}
const stage = (): HTMLElement =>
  document.querySelector('[data-ui-area="editorImage.canvas"] > div')!;
const overlay = (): HTMLElement | null => document.querySelector('[class*="overlay"]');
const chip = (): HTMLElement | null => screen.queryByRole("button", { name: "Cropped" });

/** Open the editor, pick the crop tool (by its name in each mode) and draw a frame. */
async function cropTool(canvas: boolean): Promise<void> {
  imageCanvas = canvas;
  mount();
  fireEvent.load(await screen.findByRole("img"));
  fireEvent.click(screen.getByRole("button", { name: canvas ? "Export frame" : "Crop" }));
  const el = await waitFor(() => {
    expect(overlay()).not.toBeNull();
    return overlay()!;
  });
  fireEvent.pointerDown(el, { clientX: 20, clientY: 20, pointerId: 3 });
  fireEvent.pointerMove(el, { clientX: 120, clientY: 100, pointerId: 3 });
  fireEvent.pointerUp(el, { pointerId: 3 });
  // The drag is committed: the page knows there is a crop.
  await waitFor(() => expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument());
}

describe.each([
  { mode: "classic crop", canvas: false },
  { mode: "canvas export frame", canvas: true },
])("ScreenshotEditorPage — crop enter and leave, $mode", ({ canvas }) => {
  it("ending a drag keeps the crop tool: the whole image and the frame stay, no chip", async () => {
    await cropTool(canvas);
    expect(overlay()).not.toBeNull();
    expect(chip()).toBeNull();
  });

  it("Done leaves the tool, keeps the crop and shows the cropped part with the chip", async () => {
    await cropTool(canvas);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(overlay()).toBeNull());
    expect(chip()).not.toBeNull();
  });

  it("Esc leaves the tool and keeps the crop", async () => {
    await cropTool(canvas);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(overlay()).toBeNull());
    expect(chip()).not.toBeNull();
  });

  it("Enter leaves the tool and keeps the crop", async () => {
    await cropTool(canvas);
    fireEvent.keyDown(window, { key: "Enter" });
    await waitFor(() => expect(overlay()).toBeNull());
    expect(chip()).not.toBeNull();
  });

  it("a click on the stage, outside the frame, leaves the tool and keeps the crop", async () => {
    await cropTool(canvas);
    fireEvent.click(stage());
    await waitFor(() => expect(overlay()).toBeNull());
    expect(chip()).not.toBeNull();
  });

  it("choosing another tool keeps the crop and shows the cropped part", async () => {
    await cropTool(canvas);
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    await waitFor(() => expect(overlay()).toBeNull());
    expect(chip()).not.toBeNull();
  });

  it("the chip brings the crop tool back, with the current crop", async () => {
    await cropTool(canvas);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(await waitFor(() => chip()!));
    await waitFor(() => expect(overlay()).not.toBeNull());
    expect(chip()).toBeNull();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("coming back from the Beautify tab shows the Tool tab, with Done", async () => {
    await cropTool(canvas);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    fireEvent.click(screen.getByRole("tab", { name: "Beautify" }));
    fireEvent.click(await waitFor(() => chip()!));
    await waitFor(() => expect(overlay()).not.toBeNull());
    expect(screen.getByRole("tab", { name: "Tool" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
  });

  it("a double-click on the cropped image brings the crop tool back", async () => {
    await cropTool(canvas);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(chip()).not.toBeNull());
    fireEvent.doubleClick(screen.getByRole("img"));
    await waitFor(() => expect(overlay()).not.toBeNull());
  });

  it("no crop set: no chip", async () => {
    imageCanvas = canvas;
    mount();
    fireEvent.load(await screen.findByRole("img"));
    expect(chip()).toBeNull();
  });

  it("Undo removes the crop and the chip with it", async () => {
    await cropTool(canvas);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() => expect(chip()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(chip()).toBeNull());
  });
});
