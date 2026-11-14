import { fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import type { CanvasReadResult } from "@shared/types/screenshot-canvas";
import { ScreenshotEditor } from "./screenshot-editor-page";

// The reopen notices (mock I1, I2) only exist in canvas mode.
let imageCanvas = true;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene: vi.fn(async () => new ArrayBuffer(1)),
  clearExportCache: vi.fn(),
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
const flatBytes = new Uint8Array([1, 2, 3]).buffer;
const assetBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9]).buffer;
const LOCAL: ImageSource = { kind: "local", id: "shot-1", assetId: "a-shot-1", title: "Shot" };
const SAVED_AT = Date.UTC(2026, 10, 11, 12, 0, 0);

const docJson = JSON.stringify({
  schemaVersion: 1,
  items: [
    {
      id: "image-base",
      kind: "image",
      assetId: "base",
      x: 0,
      y: 0,
      w: 400,
      h: 400,
      pixelWidth: 400,
      pixelHeight: 400,
    },
  ],
  frame: { bg: "none", padding: 0, radius: 0, shadow: 0 },
});
const stored = (json: string) =>
  ({ docJson: json, assets: { base: assetBytes } }) as CanvasReadResult;

const readCanvas = vi.fn();
const statCanvas = vi.fn();

beforeEach(() => {
  imageCanvas = true;
  URL.createObjectURL = vi.fn(() => "blob:asset");
  URL.revokeObjectURL = vi.fn();
  readCanvas.mockReset();
  statCanvas.mockReset();
  window.electronAPI.readScreenshotCanvas = readCanvas as never;
  window.electronAPI.statScreenshotCanvas = statCanvas as never;
  window.electronAPI.readScreenshotBytes = vi.fn(async () => flatBytes);
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.getBoundingClientRect = () =>
    ({ left: 0, top: 0, width: 200, height: 200, right: 200, bottom: 200, x: 0, y: 0 }) as DOMRect;
});
afterEach(() => {
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
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));

describe("ScreenshotEditor — reopen notices (image-canvas)", () => {
  it("I1: a document that loaded says everything is editable, with when it was saved", async () => {
    readCanvas.mockResolvedValue(stored(docJson));
    statCanvas.mockResolvedValue({ savedAt: SAVED_AT });
    mountLocal();
    await loadImage();
    expect(await screen.findByText("Reopened with everything editable")).toBeInTheDocument();
    const day = new Intl.DateTimeFormat("en", { month: "short", day: "numeric" })
      .format(new Date(SAVED_AT))
      .toUpperCase();
    expect(screen.getByText(new RegExp(`^SAVED ${day} · \\d\\d:\\d\\d$`))).toBeInTheDocument();
  });

  it("I1 goes away on the first edit", async () => {
    readCanvas.mockResolvedValue(stored(docJson));
    statCanvas.mockResolvedValue({ savedAt: SAVED_AT });
    mountLocal();
    await loadImage();
    await screen.findByText("Reopened with everything editable");
    fireEvent.click(screen.getByRole("button", { name: "Redact" }));
    const surface = screen.getByTestId("canvas-hit-surface");
    fireEvent.pointerDown(surface, { button: 0, clientX: 20, clientY: 20, pointerId: 3 });
    fireEvent.pointerMove(surface, { clientX: 120, clientY: 90, pointerId: 3 });
    fireEvent.pointerUp(surface, { pointerId: 3 });
    expect(screen.queryByText("Reopened with everything editable")).toBeNull();
  });

  it.each([
    ["corrupt JSON", () => readCanvas.mockResolvedValue(stored("{not json"))],
    ["a read that rejects", () => readCanvas.mockRejectedValue(new Error("boom"))],
  ])(
    "I2: a document that exists but could not be read opens the flat image and says so: %s",
    async (_name, arrange) => {
      arrange();
      statCanvas.mockResolvedValue({ savedAt: SAVED_AT });
      mountLocal();
      await loadImage();
      expect(await screen.findByText(/^Opened as a flat image\./)).toBeInTheDocument();
      expect(screen.queryByText("Reopened with everything editable")).toBeNull();
      expect(screen.getByRole("img").getAttribute("src")).not.toBe("blob:asset");
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText(/^Opened as a flat image\./)).toBeNull();
    },
  );

  it("I2: an unreadable read the reader reports as null still counts when a document file exists", async () => {
    readCanvas.mockResolvedValue(null);
    statCanvas.mockResolvedValue({ savedAt: SAVED_AT });
    mountLocal();
    await loadImage();
    expect(await screen.findByText(/^Opened as a flat image\./)).toBeInTheDocument();
  });

  it("a plain screenshot (no document) shows neither notice", async () => {
    readCanvas.mockResolvedValue(null);
    statCanvas.mockResolvedValue(null);
    mountLocal();
    await loadImage();
    expect(statCanvas).toHaveBeenCalledWith("shot-1");
    expect(screen.queryByText("Reopened with everything editable")).toBeNull();
    expect(screen.queryByText(/^Opened as a flat image\./)).toBeNull();
  });

  it("flag off: no read, no notice", async () => {
    imageCanvas = false;
    readCanvas.mockResolvedValue(null);
    statCanvas.mockResolvedValue({ savedAt: SAVED_AT });
    mountLocal();
    await loadImage();
    expect(readCanvas).not.toHaveBeenCalled();
    expect(statCanvas).not.toHaveBeenCalled();
    expect(screen.queryByText(/^Opened as a flat image\./)).toBeNull();
  });
});
