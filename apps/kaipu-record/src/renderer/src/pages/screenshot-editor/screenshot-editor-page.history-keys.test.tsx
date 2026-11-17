import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

// The canvas chrome (NIW2-711, mocks A1-A6) is canvas mode only. Each test picks its flags.
let flags: Record<string, boolean> = {};
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => flags[name] ?? false,
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// Inspect decodes the image; jsdom has no canvas, so the page test replaces the decoders.
vi.mock("@renderer/features/screenshots/inspect/pixel-buffer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/screenshots/inspect/pixel-buffer")>()),
  decodeSrgbBuffer: vi.fn(async () => ({
    width: 4,
    height: 4,
    // One flat opaque colour: a ruler run spans the whole image.
    data: new Uint8ClampedArray(64).fill(200),
  })),
  probeCaptured: vi.fn(async () => null),
}));
vi.mock("@renderer/features/screenshots/annotations/redaction", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@renderer/features/screenshots/annotations/redaction")
  >()),
  bakeRedactions: vi.fn(async (bytes: ArrayBuffer) => bytes),
  bakeCanvasRedactions: vi.fn(async (base: ArrayBuffer, assets: Record<string, ArrayBuffer>) => ({
    base,
    assets,
  })),
}));

const originalRect = Element.prototype.getBoundingClientRect;
const bytes = new Uint8Array([1, 2, 3]).buffer;
// A pasted image runs no auto action.
const PASTE: ImageSource = { kind: "blob", bytes, width: 400, height: 400, origin: "paste" };

beforeEach(async () => {
  flags = { "image-canvas": true };
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  window.electronAPI.recognizeScreenshotText = vi.fn(async () => ({
    status: "ready",
    words: [],
  })) as never;
  sizeTheCanvas();
});
afterEach(() => {
  flags = {};
  getToasts().forEach((x) => dismissToast(x.id));
  for (const prop of ["clientWidth", "clientHeight"]) {
    Reflect.deleteProperty(HTMLElement.prototype, prop);
  }
  for (const prop of ["naturalWidth", "naturalHeight"]) {
    Reflect.deleteProperty(HTMLImageElement.prototype, prop);
  }
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
});

/**
 * A 400 px shot (its file size) shown at 200 px at the origin: scale 2, so a pointer at
 * (x, y) in display px is at (2x, 2y) in the file.
 */
function sizeTheCanvas(): void {
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
}

function mount(source: ImageSource = PASTE) {
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
const annotations = (): number => document.querySelectorAll("[data-annotation]").length;
const padding = (): HTMLInputElement => {
  fireEvent.click(screen.getByRole("tab", { name: "Beautify" }));
  return screen
    .getByText("Padding")
    .parentElement!.parentElement!.querySelector("input[type=range]") as HTMLInputElement;
};

async function drawBox(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Box" }));
  const surface = screen.getByTestId("canvas-hit-surface");
  fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 20, pointerId: 4 });
  fireEvent.pointerMove(surface, { clientX: 120, clientY: 100, pointerId: 4 });
  fireEvent.pointerUp(surface, { pointerId: 4 });
  await waitFor(() => expect(annotations()).toBe(1));
}

const undoKey = (target: Element | Window = window, init: KeyboardEventInit = {}) =>
  fireEvent.keyDown(target, { key: "z", metaKey: true, ...init });

describe("ScreenshotEditorPage — Undo / Redo keys (NIW2-847)", () => {
  it("Cmd+Z removes an added annotation and Cmd+Shift+Z brings it back", async () => {
    mount();
    await loadImage();
    await drawBox();
    undoKey();
    await waitFor(() => expect(annotations()).toBe(0));
    undoKey(window, { key: "Z", shiftKey: true });
    await waitFor(() => expect(annotations()).toBe(1));
  });

  it("Cmd+Z in the title field leaves the history alone", async () => {
    mount();
    await loadImage();
    await drawBox();
    undoKey(screen.getByRole("textbox", { name: /title/i }));
    expect(annotations()).toBe(1);
  });

  it("Cmd+Z on a focused slider undoes the canvas", async () => {
    mount();
    await loadImage();
    await drawBox();
    undoKey(padding());
    await waitFor(() => expect(annotations()).toBe(0));
  });

  it("does nothing while a menu or a dialog is open", async () => {
    mount();
    await loadImage();
    await drawBox();
    const menu = document.createElement("div");
    menu.setAttribute("role", "menu");
    document.body.appendChild(menu);
    undoKey();
    expect(annotations()).toBe(1);
    menu.remove();
    const dialog = document.createElement("div");
    dialog.setAttribute("aria-modal", "true");
    document.body.appendChild(dialog);
    undoKey();
    expect(annotations()).toBe(1);
    dialog.remove();
    undoKey();
    await waitFor(() => expect(annotations()).toBe(0));
  });

  it("does nothing in the middle of a slider drag, then steps the finished edit", async () => {
    mount();
    await loadImage();
    await drawBox();
    const range = padding();
    const before = range.value;
    fireEvent.keyDown(range, { key: "ArrowRight" }); // begins the edit
    fireEvent.change(range, { target: { value: "40" } });
    undoKey(range);
    expect(annotations()).toBe(1);
    expect(padding().value).toBe("40");
    fireEvent.keyUp(range, { key: "ArrowRight" }); // ends it: one history entry
    undoKey(range);
    await waitFor(() => expect(padding().value).toBe(before));
    expect(annotations()).toBe(1);
  });

  it("a slider that loses focus mid-edit does not leave Undo blocked", async () => {
    mount();
    await loadImage();
    await drawBox();
    const range = padding();
    fireEvent.keyDown(range, { key: "ArrowRight" });
    fireEvent.change(range, { target: { value: "40" } });
    fireEvent.blur(range); // the key-up never arrives
    undoKey();
    await waitFor(() => expect(padding().value).not.toBe("40"));
  });

  it("names the keys to assistive tech in ARIA form and prevents the default only when it acts", async () => {
    mount();
    await loadImage();
    expect(screen.getByRole("button", { name: "Undo" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+Z",
    );
    expect(screen.getByRole("button", { name: "Redo" })).toHaveAttribute(
      "aria-keyshortcuts",
      "Meta+Shift+Z",
    );
    // Nothing to undo yet: the chord is left alone for the browser.
    expect(undoKey()).toBe(true);
    await drawBox();
    expect(undoKey()).toBe(false);
  });
});
