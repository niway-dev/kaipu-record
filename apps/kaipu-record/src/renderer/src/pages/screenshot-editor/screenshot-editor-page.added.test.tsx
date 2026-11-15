import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import type { ImageSource } from "@renderer/features/screenshots/image-source";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

// Images added to the canvas (NIW2-703) exist only in canvas mode.
let imageCanvas = true;
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => (name === "image-canvas" ? imageCanvas : false),
}));

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({
  exportScene,
  clearExportCache: vi.fn(),
}));

// The layer is a probe: it reports the page's "just added" id and lets a test drive the scene.
// Where the added image landed, read by the move-back probe.
const landing = vi.hoisted(() => ({ x: undefined as number | undefined }));
vi.mock("@renderer/features/screenshots/annotations/annotation-layer", () => ({
  AnnotationLayer: (props: {
    scene: {
      annotations: { id: string; kind: string }[];
      selectedId: string | null;
      select(id: string | null): void;
      commitAnnotation(id: string, patch: { x?: number; w?: number }): void;
      undo(): void;
    };
    justAddedId?: string | null;
  }) => {
    const added = props.scene.annotations.find((a) => a.kind === "image" && a.id !== "image-base");
    return (
      <div
        data-testid="layer"
        data-just-added={props.justAddedId ?? ""}
        data-annotations={JSON.stringify(props.scene.annotations)}
      >
        <button onClick={() => props.scene.select(null)}>probe-deselect</button>
        <button onClick={() => props.scene.select(added?.id ?? null)}>probe-select</button>
        <button onClick={() => added && props.scene.commitAnnotation(added.id, { x: 9 })}>
          probe-move
        </button>
        <button onClick={() => added && props.scene.commitAnnotation(added.id, { w: 0.9 })}>
          probe-resize
        </button>
        <button
          onClick={() => added && props.scene.commitAnnotation(added.id, { x: landing.x ?? 0 })}
        >
          probe-move-back
        </button>
        <button onClick={() => props.scene.undo()}>probe-undo</button>
      </div>
    );
  },
}));

// jsdom cannot decode: a pasted file decodes to a fixed 200×100 PNG.
const pastedPng = new Uint8Array([7, 7, 7]).buffer;
vi.mock("@renderer/features/editor/paste-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/editor/paste-image")>()),
  decodeToPng: vi.fn(async () => ({ png: pastedPng, width: 200, height: 100 })),
}));

const originalRect = Element.prototype.getBoundingClientRect;

const flatBytes = new Uint8Array([1, 2, 3]).buffer;
const PASTE: ImageSource = {
  kind: "blob",
  bytes: flatBytes,
  width: 400,
  height: 400,
  origin: "paste",
};

const readCanvas = vi.fn();
const saveScreenshot = vi.fn();
let urlCount = 0;

beforeEach(async () => {
  imageCanvas = true;
  urlCount = 0;
  const base = await window.electronAPI.getSettings();
  window.electronAPI.getSettings = vi.fn(async () => ({
    ...base,
    screenshotCopy: "manual" as const,
  }));
  URL.createObjectURL = vi.fn(() => `blob:${(urlCount += 1)}`);
  URL.revokeObjectURL = vi.fn();
  exportScene.mockReset();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  readCanvas.mockReset();
  readCanvas.mockResolvedValue(null);
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
  window.electronAPI.listLocalRecordings = vi.fn(async () => []);
  window.electronAPI.revealAfterCapture = vi.fn();
  window.electronAPI.readClipboardImage = vi.fn(async () => null);
  for (const prop of ["clientWidth", "clientHeight"]) {
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get: () => 200 });
  }
  // The base's pixel size, which the placement of an added image is computed from.
  Object.defineProperty(HTMLImageElement.prototype, "naturalWidth", {
    configurable: true,
    get: () => 400,
  });
  Object.defineProperty(HTMLImageElement.prototype, "naturalHeight", {
    configurable: true,
    get: () => 400,
  });
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
  // @ts-expect-error — see above
  delete HTMLImageElement.prototype.naturalWidth;
  // @ts-expect-error — see above
  delete HTMLImageElement.prototype.naturalHeight;
  Element.prototype.getBoundingClientRect = originalRect;
  // @ts-expect-error — jsdom has no pointer capture; the tests stub it
  delete Element.prototype.setPointerCapture;
  vi.unstubAllGlobals();
});

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
const loadImage = async () => {
  const img = (await screen.findAllByRole("img")).find((el) => el.tagName === "IMG")!;
  fireEvent.load(img);
};
const layer = (): HTMLElement => screen.getByTestId("layer");
const pasteImage = () =>
  fireEvent.paste(document.body, {
    clipboardData: {
      items: [
        {
          kind: "file",
          type: "image/png",
          getAsFile: () => new File([pastedPng], "clip.png", { type: "image/png" }),
        },
      ],
    },
  });

const justAddedId = (): string => screen.getByTestId("layer").dataset.justAdded!;
const probe = (name: string) => fireEvent.click(screen.getByText(`probe-${name}`));
const pasted = async () => {
  mountPaste();
  await loadImage();
  pasteImage();
  await waitFor(() => expect(justAddedId()).not.toBe(""));
};

describe("an image just added (NIW2-715)", () => {
  it("is flagged just added, and a success toast says where it went", async () => {
    await pasted();
    expect(justAddedId()).toBe(
      (JSON.parse(layer().dataset.annotations!) as { id: string }[]).at(-1)!.id,
    );
    expect(getToasts().map((x) => [x.message, x.tone])).toContainEqual([
      "Image added to the right of your content",
      "success",
    ]);
  });

  it("goes back to the normal tag after the selection moves elsewhere and returns", async () => {
    await pasted();
    probe("deselect");
    await waitFor(() => expect(justAddedId()).toBe(""));
    probe("select");
    expect(justAddedId()).toBe("");
  });

  it("goes back to the normal tag once the image has moved", async () => {
    await pasted();
    probe("move");
    await waitFor(() => expect(justAddedId()).toBe(""));
  });

  it("goes back to the normal tag once the image has been resized with x and y fixed", async () => {
    await pasted();
    probe("resize");
    await waitFor(() => expect(justAddedId()).toBe(""));
  });

  it("stays a normal tag when the image is dragged back to where it landed", async () => {
    await pasted();
    landing.x = (JSON.parse(layer().dataset.annotations!) as { x: number }[]).at(-1)!.x;
    probe("move");
    await waitFor(() => expect(justAddedId()).toBe(""));
    probe("move-back");
    await waitFor(() =>
      expect((JSON.parse(layer().dataset.annotations!) as { x: number }[]).at(-1)!.x).toBe(
        landing.x,
      ),
    );
    expect(justAddedId()).toBe("");
  });

  it("leaves no stale flag when the add is undone", async () => {
    await pasted();
    probe("undo");
    await waitFor(() => expect(justAddedId()).toBe(""));
  });
});
