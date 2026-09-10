import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { VideoEditorPage, type VideoEditorSource } from "./video-editor-page";

/** jsdom's <video> never decodes real media, so videoWidth/videoHeight default to
 *  0 — the same "still loading" state handleExport's metadata guard refuses to
 *  export from. Tests that need export to actually start (post-export navigation,
 *  keydown-gate setup) override this; tests of the guard itself rely on the jsdom
 *  default. */
function stubDecodedVideoSize(width: number, height: number): void {
  Object.defineProperty(HTMLVideoElement.prototype, "videoWidth", {
    configurable: true,
    get: () => width,
  });
  Object.defineProperty(HTMLVideoElement.prototype, "videoHeight", {
    configurable: true,
    get: () => height,
  });
}

// `useVideoExport`'s own worker/IPC pipeline is exercised in its own test suite
// (use-video-export.test.ts). Here we only care about the page's wiring around it —
// specifically that a successful export's onSaved doesn't trip the dirty-edit
// useBlocker — so the hook is replaced with a controllable stub whose `start` drives
// onSaved directly, without spinning up a fake Worker.
const startExport = vi.fn(
  async (args: { onSaved: (recording: LocalRecording) => void | Promise<void> }) => {
    await args.onSaved({
      id: "new-rec",
      assetId: "00000000-0000-0000-0000-000000000001",
      kind: "recording",
      title: "My recording (editado)",
      filePath: "/vault/new-rec.mp4",
      createdAt: 1_700_000_000_000,
      sizeBytes: 100,
      durationSeconds: 10,
      thumbnailUrl: null,
      derivedFromAssetId: null,
      contentSha256: null,
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

const SOURCE: VideoEditorSource = {
  id: "rec-1",
  assetId: "asset-1",
  title: "My recording",
  durationSeconds: 30,
};

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
  fireEvent.click(screen.getByRole("button", { name: "Add image" }));
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
  it("renders the play/pause button with aria-label Play by default", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.getByRole("button", { name: "Play" })).not.toBeNull();
  });

  it("renders the mute button with aria-label Mute by default (unmuted)", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.getByRole("button", { name: "Mute" })).not.toBeNull();
  });

  it("clicking the mute button toggles aria-label to Unmute", async () => {
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Unmute" })).not.toBeNull();
    });
  });

  it("clicking Unmute toggles back to Mute", async () => {
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Mute" }));
    await waitFor(() => screen.getByRole("button", { name: "Unmute" }));

    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Mute" })).not.toBeNull();
    });
  });

  it("renders the fullscreen button with aria-label 'Fullscreen' by default", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.getByRole("button", { name: "Fullscreen" })).not.toBeNull();
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
    // These tests exercise export wiring, not the metadata guard — give the video a
    // decoded size so handleExport's videoWidth/videoHeight === 0 check doesn't block it.
    stubDecodedVideoSize(1280, 720);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stubDecodedVideoSize(0, 0); // restore jsdom's undecoded default for other suites
  });

  const DISCARD_DIALOG_TITLE = "Discard the video changes?";

  it("a successful export's onSaved navigates straight to the library item, without the discard-changes dialog", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    await makeDirty(footer); // controller.dirty === true, same as right before a real export

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

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

describe("VideoEditorPage — handleExport metadata guard", () => {
  beforeEach(() => {
    startExport.mockClear();
    // jsdom's HTMLVideoElement.videoWidth/videoHeight default to 0 (no real decode)
    // — exactly the "still loading" condition the guard exists to catch. No stub
    // needed here; stubDecodedVideoSize(0, 0) is the implicit starting state.
  });

  afterEach(() => {
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("refuses to start the export and shows a toast when videoWidth is 0 (stream not decoded yet)", async () => {
    renderEditor();
    await waitForEditorLoaded();

    // Initial scene has one clip so the export button is enabled (not disabled by
    // the empty-timeline guard) — clicking it hits the videoWidth === 0 guard instead.
    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(startExport).not.toHaveBeenCalled();
    expect(getToasts()).toContainEqual(
      expect.objectContaining({
        message: "The video is still loading. Try again in a moment.",
      }),
    );
  });

  it("refuses to start the export when only videoHeight is 0", async () => {
    stubDecodedVideoSize(1280, 0);
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(startExport).not.toHaveBeenCalled();
    stubDecodedVideoSize(0, 0); // restore the undecoded default for other suites
  });

  it("starts the export once the video has a decoded size", async () => {
    stubDecodedVideoSize(1280, 720);
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Export" }));

    expect(startExport).toHaveBeenCalledOnce();
    stubDecodedVideoSize(0, 0); // restore the undecoded default for other suites
  });
});

describe("VideoEditorPage — add-image decode failure", () => {
  class FailingImage {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    naturalWidth = 0;
    naturalHeight = 0;
    set src(_value: string) {
      // Simulate the async decode failure a corrupt/unsupported file would trigger.
      queueMicrotask(() => this.onerror?.());
    }
  }

  beforeEach(() => {
    vi.stubGlobal("Image", FailingImage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const t of getToasts()) dismissToast(t.id);
  });

  it("shows a toast and leaves the timeline untouched when the image fails to decode", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const input = screen.getByTestId("slide-image-input") as HTMLInputElement;
    const file = new File([new Uint8Array([0x00, 0x01])], "corrupt.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message: "Couldn't load the image. Try another file.",
        }),
      );
    });
    // No slide was inserted — still the single starting clip block.
    expect(footer.querySelectorAll("button")).toHaveLength(1);
  });

  it("resets the file input's value so re-selecting the same (still-corrupt) file fires another change event", async () => {
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    const input = screen.getByTestId("slide-image-input") as HTMLInputElement;
    const file = new File([new Uint8Array([0x00, 0x01])], "corrupt.png", {
      type: "image/png",
    });
    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(getToasts().length).toBeGreaterThan(0);
    });
    // editor-toolbar.tsx resets event.target.value synchronously in its onChange,
    // before handleAddImage's async decode even settles.
    expect(input.value).toBe("");
  });
});

describe("VideoEditorPage — keydown gate behind open modals", () => {
  // The videoExport.status !== "idle" half of the same OR-gated early return is
  // covered structurally (same line, same condition shape) rather than with its own
  // dynamic test here — the mocked useVideoExport() hook returns a fixed "idle" for
  // this whole file, and forcing it to "exporting" mid-test would require reaching
  // into React internals rather than driving the UI, which use-video-export.test.ts
  // already exercises for the real hook's status transitions.
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    // Dirty-edit setup below goes through the image-add flow, not export — give the
    // video a decoded size so it never trips the unrelated metadata guard.
    stubDecodedVideoSize(1280, 720);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stubDecodedVideoSize(0, 0);
  });

  it("does not toggle playback via Space while the discard-changes modal is open (blocker.state === 'blocked')", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    const router = renderEditor();
    const footer = await waitForEditorLoaded();
    await makeDirty(footer);

    await act(async () => {
      await router.navigate("/library/rec-1");
    });
    expect(await screen.findByText("Discard the video changes?")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: " " });

    expect(playSpy).not.toHaveBeenCalled();
    playSpy.mockRestore();
  });
});
