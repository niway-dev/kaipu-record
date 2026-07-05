import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import { VideoEditorPage, type VideoEditorSource } from "./video-editor-page";

// `useVideoExport`'s own worker/IPC pipeline is exercised in its own test suite
// (use-video-export.test.ts). Here we only care about the page's wiring around it —
// specifically that a successful export's onSaved doesn't trip the dirty-edit
// useBlocker — so the hook is replaced with a controllable stub whose `start` drives
// onSaved directly, without spinning up a fake Worker.
const startExport = vi.fn(
  async (args: { onSaved: (recording: LocalRecording) => void | Promise<void> }) => {
    await args.onSaved({
      id: "new-rec",
      kind: "recording",
      title: "My recording (editado)",
      filePath: "/vault/new-rec.mp4",
      createdAt: 1_700_000_000_000,
      sizeBytes: 100,
      durationSeconds: 10,
      thumbnailUrl: null,
    });
  },
);
vi.mock("@renderer/features/video-editor/export/use-video-export", () => ({
  useVideoExport: () => ({
    status: "idle",
    fraction: 0,
    error: null,
    start: startExport,
    cancel: vi.fn(),
  }),
}));

// jsdom's Image never fires onload for blob: URLs (no real image decoding) — the
// slide asset store's put() would hang forever without a controllable fake. Same
// approach as slide-assets.test.ts.
const FIXTURE_W = 640;
const FIXTURE_H = 480;

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 0;
  naturalHeight = 0;
  private _src = "";

  get src(): string {
    return this._src;
  }

  set src(value: string) {
    this._src = value;
    queueMicrotask(() => {
      this.naturalWidth = FIXTURE_W;
      this.naturalHeight = FIXTURE_H;
      this.onload?.();
    });
  }
}

const SOURCE: VideoEditorSource = { id: "rec-1", title: "My recording", durationSeconds: 30 };

function renderEditor() {
  const router = createMemoryRouter(
    [
      { path: "/", element: <VideoEditorPage /> },
      { path: "/library/:id", element: <div>library-detail</div> },
    ],
    { initialEntries: [{ pathname: "/", state: SOURCE }] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

async function waitForEditorLoaded(): Promise<HTMLElement> {
  // VideoEditorLoader runs an async session IPC call before rendering the real editor —
  // wait for the footer (which only appears after the load resolves) rather than
  // querying it synchronously, which would race the Promise.
  await waitFor(() => {
    expect(document.querySelector("footer")).not.toBeNull();
  });
  return document.querySelector("footer")!;
}

/** Adds an image slide via the toolbar — the simplest way to produce one undoable
 *  commit, which is what makes `controller.dirty` true. */
async function makeDirty(footer: HTMLElement): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "Agregar imagen" }));
  const input = screen.getByTestId("slide-image-input") as HTMLInputElement;
  const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "x.png", {
    type: "image/png",
  });
  fireEvent.change(input, { target: { files: [file] } });
  await waitFor(() => {
    expect(footer.querySelectorAll("button")).toHaveLength(2);
  });
}

describe("VideoEditorPage — transport bar", () => {
  it("renders the play/pause button with aria-label Reproducir by default", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.getByRole("button", { name: "Reproducir" })).not.toBeNull();
  });

  it("renders the mute button with aria-label Silenciar by default (unmuted)", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.getByRole("button", { name: "Silenciar" })).not.toBeNull();
  });

  it("clicking the mute button toggles aria-label to Activar sonido", async () => {
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Silenciar" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Activar sonido" })).not.toBeNull();
    });
  });

  it("clicking Activar sonido toggles back to Silenciar", async () => {
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Silenciar" }));
    await waitFor(() => screen.getByRole("button", { name: "Activar sonido" }));

    fireEvent.click(screen.getByRole("button", { name: "Activar sonido" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Silenciar" })).not.toBeNull();
    });
  });
});

describe("VideoEditorPage — add-image wiring", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("inserts a new image slide at the boundary nearest the playhead (index 0 at t=0)", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();

    // Starting scene is a single clip covering the whole recording — one track block.
    expect(footer.querySelectorAll("button")).toHaveLength(1);

    await makeDirty(footer);

    const blocks = footer.querySelectorAll("button");
    // Playhead is at 0, so boundaryIndexAt lands the slide at index 0 — the first
    // block. Only a slide block renders an <img> (its picture) and the ImagePlus
    // badge icon; a plain clip block with no decoded thumbnails renders neither.
    expect(blocks[0].querySelector("img")).not.toBeNull();
    expect(blocks[0].querySelector("svg")).not.toBeNull();
    expect(blocks[1].querySelector("img")).toBeNull();
    expect(blocks[1].querySelector("svg")).toBeNull();
  });
});

describe("VideoEditorPage — post-export navigation vs. useBlocker", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    startExport.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const DISCARD_DIALOG_TITLE = "¿Descartar los cambios del video?";

  it("a successful export's onSaved navigates straight to the library item, without the discard-changes dialog", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    await makeDirty(footer); // controller.dirty === true, same as right before a real export

    fireEvent.click(screen.getByRole("button", { name: "Exportar" }));

    // startExport's onSaved awaits saveVideoEditSession (mocked, resolves), calls
    // markClean(), flips the bypass ref, then navigates — all async, so wait for the
    // target route's element to land.
    await waitFor(() => {
      expect(screen.getByText("library-detail")).toBeInTheDocument();
    });
    expect(startExport).toHaveBeenCalledOnce();
    // The critical regression: if the blocker predicate still read stale `dirty`
    // state at navigate-time, this dialog would render instead of the route change.
    expect(screen.queryByText(DISCARD_DIALOG_TITLE)).toBeNull();
  });

  it("blocks a normal (non-export) navigation while dirty", async () => {
    const router = renderEditor();
    const footer = await waitForEditorLoaded();
    await makeDirty(footer);

    await act(async () => {
      await router.navigate("/library/rec-1");
    });

    expect(await screen.findByText(DISCARD_DIALOG_TITLE)).toBeInTheDocument();
    // Navigation is paused mid-flight: still on the editor, not the target route.
    expect(screen.queryByText("library-detail")).toBeNull();
    expect(startExport).not.toHaveBeenCalled();
  });

  it("never blocks navigation when the editor is clean", async () => {
    const router = renderEditor();
    await waitForEditorLoaded(); // no edits made — controller.dirty stays false

    await act(async () => {
      await router.navigate("/library/rec-1");
    });

    expect(await screen.findByText("library-detail")).toBeInTheDocument();
    expect(screen.queryByText(DISCARD_DIALOG_TITLE)).toBeNull();
  });
});
