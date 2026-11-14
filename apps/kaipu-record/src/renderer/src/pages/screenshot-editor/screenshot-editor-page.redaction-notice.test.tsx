import { readFileSync } from "node:fs";
import path from "node:path";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import { REDACTION_NOTICE_KEY } from "@renderer/features/screenshots/canvas";
import { ScreenshotEditor, ScreenshotEditorPage } from "./screenshot-editor-page";

// The editable document (ADR 0053, NIW2-700) only exists in canvas mode.
let imageCanvas = true;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// jsdom has no createImageBitmap or canvas: baking is the identity here. The pixel work has
// its own tests (redaction.test.ts).
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

const flatBytes = new Uint8Array([1, 2, 3]).buffer;
// A PNG signature and one byte: enough for the reader's PNG check.
const assetBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]).buffer;
const LOCAL: ImageSource = { kind: "local", id: "shot-1", assetId: "a-shot-1", title: "Shot" };
const PASTE: ImageSource = {
  kind: "blob",
  bytes: flatBytes,
  width: 400,
  height: 400,
  origin: "paste",
};

const FRAME = { bg: "none", padding: 0, radius: 0, shadow: 0 };
const arrow = {
  id: "a7",
  kind: "arrow",
  x1: 0.1,
  y1: 0.1,
  x2: 0.9,
  y2: 0.1,
  color: "#ff0000",
  stroke: 1,
  seed: 1,
};
const blur = { id: "a8", kind: "blur", x: 0.2, y: 0.5, w: 0.3, h: 0.2, locked: true };
const image = {
  id: "image-base",
  kind: "image",
  assetId: "base",
  x: 0,
  y: 0,
  w: 400,
  h: 400,
  pixelWidth: 400,
  pixelHeight: 400,
};
const docJson = (patch: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schemaVersion: 1,
    items: [image, arrow, blur],
    frame: FRAME,
    ...patch,
  });
const stored = (json: string, assets: Record<string, ArrayBuffer> = { base: assetBytes }) =>
  ({ docJson: json, assets }) as CanvasReadResult;

const readCanvas = vi.fn();
const saveScreenshot = vi.fn();

beforeEach(async () => {
  imageCanvas = true;
  localStorage.clear();
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "auto" as const,
  }));
  URL.createObjectURL = vi.fn(() => "blob:asset");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  readCanvas.mockReset();
  saveScreenshot.mockReset();
  saveScreenshot.mockImplementation(async (_png: ArrayBuffer, opts: { title: string }) => ({
    id: "shot-1",
    assetId: "a-shot-1",
    title: opts.title,
    kind: "screenshot",
  }));
  window.electronAPI.readScreenshotCanvas = readCanvas as never;
  window.electronAPI.readScreenshotBytes = vi.fn(async () => flatBytes);
  window.electronAPI.saveScreenshot = saveScreenshot as never;
  window.electronAPI.copyImageToClipboard = vi.fn(async () => {});
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
  getToasts().forEach((x) => dismissToast(x.id));
  // @ts-expect-error — drop the stubs
  delete HTMLElement.prototype.clientWidth;
  // @ts-expect-error — see above
  delete HTMLElement.prototype.clientHeight;
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
});

function mountLocal() {
  const router = createMemoryRouter(
    [
      { path: "/editor/:id", element: <ScreenshotEditor source={LOCAL} /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: ["/editor/shot-1"] },
  );
  return render(<RouterProvider router={router} />);
}
function mountPaste() {
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/", element: <div>capture</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: PASTE }] },
  );
  return render(<RouterProvider router={router} />);
}
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));

// The one-time notice before redactions become permanent (mock H4b, NIW2-713).
const NOTICE = "Saving makes redactions permanent";
const notice = () => screen.queryByRole("dialog", { name: NOTICE });

function drawRedaction() {
  // The tool is "Redact" in canvas mode and "Blur" before it.
  fireEvent.click(screen.getByRole("button", { name: imageCanvas ? "Redact" : "Blur" }));
  const surface = imageCanvas
    ? screen.getByTestId("canvas-hit-surface")
    : document.querySelector('svg[width="200"]')!.parentElement!;
  fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 20, pointerId: 3 });
  fireEvent.pointerMove(surface, { clientX: 120, clientY: 90, pointerId: 3 });
  fireEvent.pointerUp(surface, { pointerId: 3 });
}
const blurIds = (): string[] =>
  [...document.querySelectorAll("[data-annotation]")]
    .map((el) => (el as HTMLElement).dataset.annotation!)
    .filter((id) => id !== "a7");

describe("ScreenshotEditor — redaction notice (image-canvas)", () => {
  it("opens when the first redaction is drawn, and is not modal", async () => {
    mountPaste();
    await loadImage();
    expect(notice()).toBeNull();
    drawRedaction();
    const dialog = await screen.findByRole("dialog", { name: NOTICE });
    expect(dialog).not.toHaveAttribute("aria-modal");
    expect(document.querySelector('[aria-modal="true"]')).toBeNull();
  });

  it("does not open when it was acknowledged on this machine", async () => {
    localStorage.setItem(REDACTION_NOTICE_KEY, "1");
    mountPaste();
    await loadImage();
    drawRedaction();
    expect(blurIds()).toHaveLength(1);
    expect(notice()).toBeNull();
  });

  it("does not open for a locked redaction loaded from a saved document", async () => {
    readCanvas.mockResolvedValue(stored(docJson()));
    mountLocal();
    await loadImage();
    expect(notice()).toBeNull();
  });

  it("never opens with the flag off", async () => {
    imageCanvas = false;
    mountPaste();
    await loadImage();
    drawRedaction();
    // The blur is really there: the notice is absent because of the flag, not for lack of a draw.
    expect(document.querySelectorAll("[data-annotation]")).toHaveLength(1);
    expect(notice()).toBeNull();
  });

  it("Got it stores the acknowledgement and closes", async () => {
    mountPaste();
    await loadImage();
    drawRedaction();
    fireEvent.click(await screen.findByRole("button", { name: "Got it" }));
    expect(localStorage.getItem(REDACTION_NOTICE_KEY)).toBe("1");
    expect(notice()).toBeNull();
    expect(blurIds()).toHaveLength(1);
  });

  it("Undo redaction removes the redaction, closes, and does not acknowledge", async () => {
    mountPaste();
    await loadImage();
    drawRedaction();
    expect(blurIds()).toHaveLength(1);
    fireEvent.click(await screen.findByRole("button", { name: "Undo redaction" }));
    expect(blurIds()).toHaveLength(0);
    expect(notice()).toBeNull();
    expect(localStorage.getItem(REDACTION_NOTICE_KEY)).toBeNull();
    // The next first redaction opens it again.
    drawRedaction();
    expect(await screen.findByRole("dialog", { name: NOTICE })).toBeInTheDocument();
  });

  it("an explicit Save still saves while it is open, and counts as acknowledging", async () => {
    mountPaste();
    await loadImage();
    drawRedaction();
    await screen.findByRole("dialog", { name: NOTICE });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(notice()).toBeNull());
    expect(localStorage.getItem(REDACTION_NOTICE_KEY)).toBe("1");
  });

  it("the edit autosave still runs while it is open", async () => {
    readCanvas.mockResolvedValue(stored(docJson()));
    mountLocal();
    await loadImage();
    vi.useFakeTimers();
    drawRedaction();
    expect(notice()).not.toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(saveScreenshot).toHaveBeenCalledTimes(1);
    expect((saveScreenshot.mock.calls[0][1] as { overwriteId?: string }).overwriteId).toBe(
      "shot-1",
    );
    // The notice is still there: only Got it or an explicit save acknowledges it.
    expect(notice()).not.toBeNull();
  });

  it("lockedAt is the time of the save that succeeded, not of a failed attempt", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const stamps = (call: number): number[] => {
      const canvas = (saveScreenshot.mock.calls[call][1] as { canvas: { docJson: string } }).canvas;
      return (JSON.parse(canvas.docJson).items as { kind: string; lockedAt?: number }[])
        .filter((i) => i.kind === "blur")
        .map((i) => i.lockedAt as number);
    };
    mountPaste();
    await loadImage();
    drawRedaction();
    await screen.findByRole("dialog", { name: NOTICE });
    const save = async () => fireEvent.click(await screen.findByRole("button", { name: "Save" }));

    vi.setSystemTime(1_000);
    saveScreenshot.mockRejectedValueOnce(new Error("disk full"));
    await save();
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(1));
    expect(stamps(0)).toEqual([1_000]);

    vi.setSystemTime(2_000);
    await save();
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(2));
    expect(stamps(1)).toEqual([2_000]);

    // A new edit makes the button Save again; the first redaction keeps its stamp.
    vi.setSystemTime(3_000);
    drawRedaction();
    await waitFor(() => expect(blurIds()).toHaveLength(2));
    await save();
    await waitFor(() => expect(saveScreenshot).toHaveBeenCalledTimes(3));
    expect(stamps(2)).toEqual([2_000, 3_000]);
  });

  it("the catalog's forgetRedactionNotice action removes the store's key", () => {
    const run = readFileSync(path.join(process.cwd(), "ui-catalog/run.ts"), "utf8");
    expect(run).toContain(`localStorage.removeItem("${REDACTION_NOTICE_KEY}")`);
  });
});
