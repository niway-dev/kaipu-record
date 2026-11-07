import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalRecording } from "@shared/types/library-storage";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { SESSION_BEFORE_WEBCAM } from "@renderer/features/video-editor/session-before-webcam.fixture";
import { serializeSession } from "@renderer/features/video-editor/session";
import { initialScene } from "@renderer/features/video-editor/scene";
import { TRACK_KEYS } from "@renderer/features/video-editor/tracks";
import { WEBCAM_DEFAULTS } from "@renderer/features/video-editor/webcam/webcam-model";
import { setHeaderActionsElement } from "@renderer/features/workspaces/header-slot";
import {
  toolForShortcut,
  VideoEditorLoader,
  VideoEditorPage,
  type VideoEditorSource,
} from "./video-editor-page";

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
  async (args: { onSaved: (recording: LocalRecording) => void | Promise<void> }): Promise<void> => {
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

// The page reports one product event for the speed button. The real client is a no-op
// without PostHog; spying on it lets the tests pin the name and the payload.
const captureEventSpy = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/analytics", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/features/analytics")>()),
  captureEvent: captureEventSpy,
}));

// Thumbnails never decode in jsdom (no WebCodecs); spying on the hook lets the webcam tests
// pin which file and offset the webcam lane's filmstrip is decoded from.
const thumbnailCalls = vi.hoisted(() => [] as unknown[][]);
vi.mock("@renderer/features/video-editor/use-source-thumbnails", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@renderer/features/video-editor/use-source-thumbnails")
  >()),
  useSourceThumbnails: (...args: unknown[]) => {
    thumbnailCalls.push(args);
    return [];
  },
  useCompanionThumbnails: (...args: unknown[]) => {
    thumbnailCalls.push(args);
    return { thumbnails: [], covered: null };
  },
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

// Main holds the item under its current id before the editor loads anything (NIW2-560).
// The title bar's actions slot stands in for the shell's (NIW2-619): the editor renders
// undo, split, Export… into it, so without one those buttons would not exist here.
let headerActions: HTMLElement;
beforeEach(() => {
  window.electronAPI.acquireEditorSession = async () => SOURCE.id;
  headerActions = document.createElement("div");
  headerActions.dataset.testid = "header-actions";
  document.body.appendChild(headerActions);
  setHeaderActionsElement(headerActions);
});
afterEach(() => {
  setHeaderActionsElement(null);
  headerActions.remove();
});

function renderEditor(source: VideoEditorSource = SOURCE) {
  const router = createMemoryRouter(
    [
      { path: "/", element: <VideoEditorLoader source={source} /> },
      { path: "/library/:assetId", element: <div>library-detail</div> },
    ],
    { initialEntries: ["/"] },
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

/**
 * Press an editor shortcut until the page reacts to it.
 *
 * The footer `waitForEditorLoaded` waits for appears on the commit that renders the
 * editor; the page registers its `keydown` listener in a `useEffect` of that same
 * component, which runs a moment AFTER the commit. A key fired in that gap reaches
 * no listener and is lost. On a fast machine the gap is never hit; on a GitHub
 * runner it was, and "arming the Box tool (R)" waited 10 s for a panel the dropped
 * key never opened. Re-pressing inside `waitFor` closes the gap — every shortcut
 * used this way is idempotent (R arms Box again; it does not toggle it off).
 */
async function pressUntil(key: string, assertion: () => void): Promise<void> {
  await waitFor(() => {
    fireEvent.keyDown(window, { key });
    assertion();
  });
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

/**
 * "Export" opens the export sheet (NIW2-217); its primary "Export ~N MB" runs the MP4
 * export. When the metadata guard refuses, no sheet opens and only the first click happens.
 */
function clickExportVideo(): void {
  fireEvent.click(screen.getByRole("button", { name: "Export" }));
  const sheet = screen.queryByRole("alertdialog");
  if (sheet) fireEvent.click(within(sheet).getByRole("button", { name: /^Export( |$)/ }));
}

describe("VideoEditorPage — legacy /video-editor redirect", () => {
  const renderLegacy = (state: unknown) => {
    const router = createMemoryRouter(
      [
        { path: "/video-editor", element: <VideoEditorPage /> },
        { path: "/editor", element: <div>editor-home</div> },
        { path: "/editor/video/:assetId", element: <div>editor-video</div> },
      ],
      { initialEntries: [{ pathname: "/video-editor", state }] },
    );
    render(<RouterProvider router={router} />);
    return router;
  };

  it("lands an old navigation that carries the recording on its editor URL", () => {
    const router = renderLegacy(SOURCE);
    expect(screen.getByText("editor-video")).not.toBeNull();
    expect(router.state.location.pathname).toBe("/editor/video/asset-1");
  });

  it("sends a stateless (or unusable) navigation to the Editor home", () => {
    renderLegacy({ ...SOURCE, durationSeconds: 0 });
    expect(screen.getByText("editor-home")).not.toBeNull();
  });
});

describe("VideoEditorLoader — editor hold (NIW2-560)", () => {
  afterEach(() => {
    window.electronAPI.closeEditorSession = () => {};
  });

  it("loads nothing before main acknowledges the hold, then loads under the current id", async () => {
    let acknowledge!: (id: string) => void;
    window.electronAPI.acquireEditorSession = vi.fn(
      () => new Promise<string | null>((resolve) => (acknowledge = resolve)),
    );
    const loadSession = vi.fn(async () => null);
    const loadTrack = vi.fn(async () => null);
    window.electronAPI.loadVideoEditSession = loadSession;
    window.electronAPI.loadCursorTrack = loadTrack;
    const close = vi.fn();
    window.electronAPI.closeEditorSession = close;

    const { unmount } = render(
      <RouterProvider
        router={createMemoryRouter([{ path: "/", element: <VideoEditorLoader source={SOURCE} /> }])}
      />,
    );
    await waitFor(() =>
      expect(window.electronAPI.acquireEditorSession).toHaveBeenCalledWith("asset-1"),
    );
    expect(loadSession).not.toHaveBeenCalled();
    expect(loadTrack).not.toHaveBeenCalled();

    // A rename moved the file while the editor was opening.
    await act(async () => acknowledge("Renamed clip"));
    await waitFor(() => expect(loadSession).toHaveBeenCalledWith("Renamed clip"));
    expect(loadTrack).toHaveBeenCalledWith("Renamed clip");
    unmount();
    expect(close).toHaveBeenCalledWith("Renamed clip");
  });
});

describe("VideoEditorLoader — item no longer available (NIW2-560)", () => {
  it.each([
    ["main answers null (deleted; another item took its name)", async () => null],
    [
      "the acquisition rejects",
      async () => {
        throw new Error("ipc down");
      },
    ],
  ])("never loads under the route's id when %s", async (_label, acquire) => {
    window.electronAPI.acquireEditorSession = vi.fn(acquire) as never;
    const loadSession = vi.fn(async () => null);
    const loadTrack = vi.fn(async () => null);
    window.electronAPI.loadVideoEditSession = loadSession;
    window.electronAPI.loadCursorTrack = loadTrack;
    const router = createMemoryRouter(
      [
        { path: "/", element: <VideoEditorLoader source={SOURCE} /> },
        { path: "/library", element: <div>library-page</div> },
      ],
      { initialEntries: ["/"] },
    );
    render(<RouterProvider router={router} />);

    expect(await screen.findByText(/no longer in your library/i)).toBeInTheDocument();
    expect(loadSession).not.toHaveBeenCalled();
    expect(loadTrack).not.toHaveBeenCalled();
    expect(document.querySelector("footer")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /back to library/i }));
    expect(await screen.findByText("library-page")).toBeInTheDocument();
  });
});

describe("VideoEditorLoader — an identity two files claim (NIW2-560)", () => {
  it("says the item is claimed twice instead of 'no longer in your library', and loads nothing", async () => {
    window.electronAPI.acquireEditorSession = vi.fn(async () => {
      throw new Error("Error invoking remote method: vault-ambiguous-identity: 2 local items");
    }) as never;
    const loadSession = vi.fn(async () => null);
    window.electronAPI.loadVideoEditSession = loadSession;
    render(
      <RouterProvider
        router={createMemoryRouter([
          { path: "/", element: <VideoEditorLoader source={SOURCE} /> },
          { path: "/library", element: <div>library-page</div> },
        ])}
      />,
    );
    expect(await screen.findByText(/two files in your folder/i)).toBeInTheDocument();
    expect(screen.queryByText(/no longer in your library/i)).toBeNull();
    expect(loadSession).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /back to library/i })).toBeInTheDocument();
  });
});

describe("VideoEditorPage — actions in the title bar (NIW2-619)", () => {
  it("renders undo, redo, add image, the status and Export into the title bar, not the side column", async () => {
    renderEditor();
    await waitForEditorLoaded();

    const inspector = document.querySelector('[data-testid="editor-inspector"]')!;
    const side = inspector.parentElement!;
    for (const name of ["Undo", "Redo", "Add image", "Export"]) {
      const button = screen.getByRole("button", { name });
      expect(headerActions.contains(button)).toBe(true);
      expect(side.contains(button)).toBe(false);
    }
    // Split and delete act on the timeline, so they live on the transport bar (NIW2-664).
    for (const name of ["Split here", "Delete segment"]) {
      expect(within(headerActions).queryByRole("button", { name })).toBeNull();
    }
    const badge = within(headerActions).getByText("ORIGINAL UNTOUCHED", { exact: false });
    // The badge is the first thing a crowded title bar hides; Export stays, last.
    expect(badge.closest("[data-collapse]")).toHaveAttribute("data-collapse", "badge");
    const buttons = within(headerActions).getAllByRole("button");
    expect(buttons[buttons.length - 1]).toHaveAccessibleName("Export");
  });
});

describe("VideoEditorPage — playback is the play button and Space only (NIW2-619)", () => {
  it("Space starts playback", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderEditor();
    await waitForEditorLoaded();

    await waitFor(() => {
      fireEvent.keyDown(window, { key: " " });
      expect(playSpy).toHaveBeenCalled();
    });
    playSpy.mockRestore();
  });

  it("a click on the picture does not start playback, and no 'click to play' text is shown", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(document.querySelector("video")!);
    await act(async () => {});

    expect(playSpy).not.toHaveBeenCalled();
    expect(screen.queryByText(/click .*to play/i)).toBeNull();
    playSpy.mockRestore();
  });
});

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

  it("holds split, delete, mute and fullscreen, with play and the time between them", async () => {
    renderEditor();
    await waitForEditorLoaded();

    const transport = document.querySelector<HTMLElement>(
      "[data-ui-area='editorVideo.transport']",
    )!;
    for (const name of ["Split here", "Delete segment", "Mute", "Fullscreen", "Play"]) {
      expect(within(transport).getByRole("button", { name })).toBeInTheDocument();
    }
    expect(within(transport).getByText("0:00.0 / 0:30.0")).toBeInTheDocument();
  });

  it("Forward skips five seconds through the playback seek, and Rewind comes back", async () => {
    renderEditor();
    await waitForEditorLoaded();

    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("0:05.0 / 0:30.0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
    await waitFor(() => expect(screen.getByText("0:00.0 / 0:30.0")).toBeInTheDocument());
  });

  it("Split here cuts the clip under the playhead in two", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    // One clip covers the recording: one block on the timeline.
    expect(footer.querySelectorAll("button")).toHaveLength(1);

    // Step off t=0 so the cut lands inside the clip (a cut on the boundary is a no-op).
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("0:05.0 / 0:30.0")).toBeInTheDocument());
    const split = screen.getByRole("button", { name: "Split here" });
    expect(split).toBeEnabled();
    fireEvent.click(split);

    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(2));
  });

  it("Delete segment is disabled until a segment is selected, then removes it", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    // Two segments, so the only thing keeping Delete disabled is the missing selection
    // (with one item left it is disabled regardless).
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("0:05.0 / 0:30.0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(2));

    expect(screen.getByRole("button", { name: "Delete segment" })).toBeDisabled();

    fireEvent.click(footer.querySelectorAll("button")[0]);
    const remove = await waitFor(() => {
      const button = screen.getByRole("button", { name: "Delete segment" });
      expect(button).toBeEnabled();
      return button;
    });
    fireEvent.click(remove);

    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(1));
    expect(screen.getByRole("button", { name: "Delete segment" })).toBeDisabled();
  });

  it("renders the fullscreen button with aria-label 'Fullscreen' by default", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.getByRole("button", { name: "Fullscreen" })).not.toBeNull();
  });
});

describe("VideoEditorPage — editable cursor entry", () => {
  it("hides the Cursor entry for a recording whose cursor is baked into the video", async () => {
    renderEditor();
    await waitForEditorLoaded();

    expect(screen.queryByRole("button", { name: "Cursor" })).toBeNull();
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

describe("VideoEditorPage — background export vs. useBlocker", () => {
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

  it("an export runs in the background: the user stays in the editor, and the session is stamped as exported", async () => {
    // The global stub is a plain async function, not a spy; wrap it for this test only.
    const save = vi.spyOn(window.electronAPI, "saveVideoEditSession");
    renderEditor();
    const footer = await waitForEditorLoaded();
    await makeDirty(footer);

    clickExportVideo();

    // The 4th argument stamps this scene as the one burned into the file. Without it the
    // library shows "not exported" on a recording the user exported a second ago.
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        expect.any(Array),
        true,
      ),
    );
    expect(startExport).toHaveBeenCalledOnce();
    // No navigation: the "Ready to share" card takes over, and the editor stays open.
    expect(screen.queryByText("library-detail")).toBeNull();
    expect(screen.queryByText(DISCARD_DIALOG_TITLE)).toBeNull();
  });

  it("does not stamp the session when the user kept editing while the export ran", async () => {
    let pending: { onSaved: (recording: LocalRecording) => void | Promise<void> } | null = null;
    startExport.mockImplementationOnce(async (args) => {
      pending = args;
    });
    const save = vi.spyOn(window.electronAPI, "saveVideoEditSession");
    save.mockClear();
    renderEditor();
    const footer = await waitForEditorLoaded();
    await makeDirty(footer);
    clickExportVideo();
    await waitFor(() => expect(pending).not.toBeNull());

    // Another edit while the export encodes.
    fireEvent.click(screen.getByRole("button", { name: "Add image" }));
    fireEvent.change(screen.getByTestId("slide-image-input"), {
      target: { files: [new File([new Uint8Array([0x89, 0x50])], "y.png", { type: "image/png" })] },
    });
    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(3));

    await act(async () => {
      await pending!.onSaved({
        id: "new-rec",
        assetId: "00000000-0000-0000-0000-000000000001",
        kind: "recording",
        title: "My recording (edited)",
        filePath: "/vault/new-rec.mp4",
        createdAt: 1,
        sizeBytes: 100,
        durationSeconds: 10,
        thumbnailUrl: null,
        derivedFromAssetId: null,
        contentSha256: null,
      });
    });
    expect(save).not.toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.any(Array),
      true,
    );
  });

  it("blocks a normal (non-export) navigation while dirty", async () => {
    // The blocker only fires while an edit is pending, i.e. not yet written. Two
    // things make that depend on the runner's speed; either one lets the navigation
    // through, which is how this failed on CI:
    //  - autosave writes AUTOSAVE_DEBOUNCE_MS after the edit and clears the flag, so a
    //    write that never resolves keeps the edit pending for the whole test;
    //  - the flag is set in a passive effect that runs a moment AFTER the commit
    //    `makeDirty` waits for. Navigating in that gap finds nothing pending and goes
    //    through. The "Saving…" chip is set by the same effect, so waiting for it
    //    proves the flag is up.
    const save = vi
      .spyOn(window.electronAPI, "saveVideoEditSession")
      .mockReturnValue(new Promise(() => {}));
    try {
      const router = renderEditor();
      const footer = await waitForEditorLoaded();
      await makeDirty(footer);
      expect(await screen.findByText("Saving…")).toBeInTheDocument();

      await act(async () => {
        await router.navigate("/library/rec-1");
      });

      expect(await screen.findByText(DISCARD_DIALOG_TITLE)).toBeInTheDocument();
      // Navigation is paused mid-flight: still on the editor, not the target route.
      expect(screen.queryByText("library-detail")).toBeNull();
      expect(startExport).not.toHaveBeenCalled();
    } finally {
      save.mockRestore();
    }
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
    clickExportVideo();

    // Wait for the toast first, then assert the negative. A bare
    // `not.toHaveBeenCalled()` after a click passes just as happily when the
    // handler never ran at all, so it needs an observable effect to anchor it —
    // the toast proves the guard is what refused.
    await waitFor(() => {
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message: "The video is still loading. Try again in a moment.",
        }),
      );
    });
    expect(startExport).not.toHaveBeenCalled();
  });

  it("refuses to start the export when only videoHeight is 0", async () => {
    stubDecodedVideoSize(1280, 0);
    renderEditor();
    await waitForEditorLoaded();

    clickExportVideo();

    // Same guard, same toast: waiting for it is what makes the negative below mean
    // "the guard refused" rather than "the handler had not started".
    await waitFor(() => {
      expect(getToasts()).toContainEqual(
        expect.objectContaining({
          message: "The video is still loading. Try again in a moment.",
        }),
      );
    });
    expect(startExport).not.toHaveBeenCalled();
    stubDecodedVideoSize(0, 0); // restore the undecoded default for other suites
  });

  it("starts the export once the video has a decoded size", async () => {
    stubDecodedVideoSize(1280, 720);
    renderEditor();
    await waitForEditorLoaded();

    clickExportVideo();

    await waitFor(() => {
      expect(startExport).toHaveBeenCalledOnce();
    });
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

    // Let any queued effect or promise the keydown could have started settle, so
    // this negative means "the gate held" and not "playback had not begun yet".
    await act(async () => {});

    expect(playSpy).not.toHaveBeenCalled();
    playSpy.mockRestore();
  });
});

describe("VideoEditorPage — shortcuts leave dropdowns alone", () => {
  it("does not toggle playback when Space is pressed in a select (e.g. the cursor style)", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    renderEditor();
    await waitForEditorLoaded();
    const select = document.createElement("select");
    document.body.appendChild(select);

    fireEvent.keyDown(select, { key: " " });
    await act(async () => {});

    expect(playSpy).not.toHaveBeenCalled();
    select.remove();
    playSpy.mockRestore();
  });
});

describe("VideoEditorPage — a tool flyout keeps its keys to itself", () => {
  beforeEach(() => {
    stubDecodedVideoSize(1280, 720);
  });

  afterEach(() => {
    stubDecodedVideoSize(0, 0);
  });

  async function openAudioFlyoutWithZoomSelected(): Promise<HTMLElement> {
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    await screen.findByRole("heading", { name: "Zoom 1" });
    fireEvent.click(screen.getByRole("button", { name: "Audio" }));
    return screen.getByRole("menu", { name: "Audio" });
  }

  it("Escape closes the flyout and leaves the selected zoom selected", async () => {
    const menu = await openAudioFlyoutWithZoomSelected();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("heading", { name: "Zoom 1" })).toBeInTheDocument();
  });

  it("Space picks the focused option and does not toggle playback", async () => {
    const playSpy = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    try {
      await openAudioFlyoutWithZoomSelected();
      playSpy.mockClear();
      fireEvent.keyDown(document.activeElement!, { key: " " });
      expect(screen.queryByRole("menu")).toBeNull();
      expect(playSpy).not.toHaveBeenCalled();
    } finally {
      playSpy.mockRestore();
    }
  });

  it("a shortcut letter typed in the flyout does not arm a tool underneath", async () => {
    const menu = await openAudioFlyoutWithZoomSelected();
    fireEvent.keyDown(menu, { key: "r" });
    expect(screen.getByRole("button", { name: "Box" }).className).not.toMatch(/toolActive/);
  });
});

describe("toolForShortcut — the keyboard agrees with the toolbar's disabled states", () => {
  it("maps each annotation shortcut to its tool", () => {
    expect(toolForShortcut("v", { onSlide: false })).toBe("select");
    expect(toolForShortcut("r", { onSlide: false })).toBe("box");
    expect(toolForShortcut("a", { onSlide: false })).toBe("arrow");
    expect(toolForShortcut("t", { onSlide: false })).toBe("text");
  });

  it("maps B and C to the privacy tools off a slide", () => {
    expect(toolForShortcut("b", { onSlide: false })).toBe("blur");
    expect(toolForShortcut("c", { onSlide: false })).toBe("cover");
  });

  it("refuses B and C on a slide — the toolbar disables those buttons there", () => {
    expect(toolForShortcut("b", { onSlide: true })).toBeNull();
    expect(toolForShortcut("c", { onSlide: true })).toBeNull();
  });

  it("leaves the annotation tools alone on a slide — only privacy is gated", () => {
    expect(toolForShortcut("v", { onSlide: true })).toBe("select");
    expect(toolForShortcut("r", { onSlide: true })).toBe("box");
    expect(toolForShortcut("t", { onSlide: true })).toBe("text");
  });

  it("returns null for a key that is not a shortcut", () => {
    expect(toolForShortcut("q", { onSlide: false })).toBeNull();
    expect(toolForShortcut("enter", { onSlide: false })).toBeNull();
    // `key in obj` walks the prototype chain; a real KeyboardEvent never produces
    // these, but the lookup must not resolve them to a "tool" either.
    expect(toolForShortcut("constructor", { onSlide: false })).toBeNull();
  });
});

describe("VideoEditorPage — tool shortcuts end to end", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    stubDecodedVideoSize(1280, 720);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stubDecodedVideoSize(0, 0);
  });

  it("R arms the Box tool from the keyboard", async () => {
    renderEditor();
    await waitForEditorLoaded();

    // The class lands on a re-render, not on the event. Asserting it synchronously
    // reads the DOM one render too early and only passes when the machine is fast
    // enough — which is how this failed under a parallel `turbo run test`.
    await pressUntil("r", () => {
      expect(screen.getByRole("button", { name: "Box" }).className).toMatch(/toolActive/);
    });
  });

  it.each([
    ["a", "Arrow", "annotate"],
    ["t", "Text", "annotate"],
    ["b", "Blur", "privacy"],
    ["c", "Cover", "privacy"],
  ])("%s goes straight to %s, shown on the %s button", async (key, name, group) => {
    renderEditor();
    await waitForEditorLoaded();

    await pressUntil(key, () => {
      const button = screen.getByRole("button", { name });
      expect(button).toHaveAttribute("data-tool-group", group);
      expect(button.className).toMatch(/toolActive/);
    });
  });

  it("Shift+R cycles Annotate to its next variant; Shift+B on Select arms the next after Blur", async () => {
    renderEditor();
    await waitForEditorLoaded();

    await pressUntil("r", () => {
      expect(screen.getByRole("button", { name: "Box" }).className).toMatch(/toolActive/);
    });
    fireEvent.keyDown(window, { key: "R", shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Arrow" }).className).toMatch(/toolActive/);
    });
    fireEvent.keyDown(window, { key: "R", shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Text" }).className).toMatch(/toolActive/);
    });

    // From another group's tool, Shift+B starts from Blur and lands on Cover.
    fireEvent.keyDown(window, { key: "B", shiftKey: true });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Cover" }).className).toMatch(/toolActive/);
    });
  });

  it("V hands the tool back to select after R armed Box", async () => {
    renderEditor();
    await waitForEditorLoaded();

    await pressUntil("r", () => {
      expect(screen.getByRole("button", { name: "Box" }).className).toMatch(/toolActive/);
    });

    fireEvent.keyDown(window, { key: "v" });

    // The way back was untested: `toolForShortcut` proves "v" maps to select as a
    // pure function, but nothing proved the page acts on it and disarms Box.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Box" }).className).not.toMatch(/toolActive/);
    });
    expect(screen.getByRole("button", { name: "Select" }).className).toMatch(/toolActive/);
  });
});

// The floating `OverlayOptions` popover (`.optionsFloat`) is gone — annotation controls
// now live in the inspector column alongside ZoomInspector / BlurInspector /
// CoverInspector (backlog/video-editor-annotation-inspector). These tests cover what the
// page harness can honestly reach; see the comment before the last test for what is
// deliberately NOT covered here (and why).
describe("VideoEditorPage — inspector column priority (annotation follow-ups)", () => {
  beforeEach(() => {
    vi.stubGlobal("Image", FakeImage);
    stubDecodedVideoSize(1280, 720);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    stubDecodedVideoSize(0, 0);
  });

  it("shows the Detection panel by default (select tool, nothing selected)", async () => {
    renderEditor();
    await waitForEditorLoaded();

    // The footer this harness waits on and the inspector column land on different
    // renders, so the inspector's heading is a `findBy`, not a `getBy`.
    expect(await screen.findByRole("heading", { name: "Detection" })).toBeInTheDocument();
  });

  it("with nothing selected the inspector opens on 'Click a segment on the timeline to edit it.'", async () => {
    renderEditor();
    await waitForEditorLoaded();

    const empty = await screen.findByText("Click a segment on the timeline to edit it.");
    const inspector = document.querySelector('[data-testid="editor-inspector"]')!;
    // The hint row above the inspector is gone: the text lives in the inspector, once.
    expect(inspector.contains(empty)).toBe(true);
    expect(screen.getAllByText("Click a segment on the timeline to edit it.")).toHaveLength(1);
  });

  it("arming the Box tool (R) shows the annotation defaults panel in the inspector, with no floating popover duplicating its controls", async () => {
    renderEditor();
    await waitForEditorLoaded();

    await pressUntil("r", () => {
      expect(screen.getByRole("heading", { name: "Next annotation" })).toBeInTheDocument();
    });
    // Before this change, the same "Color" picker rendered twice: once in the floating
    // OverlayOptions popover over the stage, once (if it existed) in the inspector. Now
    // there is exactly one, and it lives inside the inspector column.
    const colorLabels = screen.getAllByText("Color");
    expect(colorLabels).toHaveLength(1);
    const inspector = document.querySelector('[data-testid="editor-inspector"]')!;
    expect(inspector.contains(colorLabels[0])).toBe(true);
  });

  // The seek-on-zoom-select rule (seekTargetForSegment: seek only when the playhead is
  // outside the segment) is a pure function covered on its own in select-seek.test.ts.
  // Driving a REAL zoom segment through this page's harness would require a cursor-track
  // fixture wired through withInitialZooms/useZoomEditing, which this file's harness
  // does not set up (no test here creates a cursor track) — faking that path would test
  // a shape the real detector never produces, so it is intentionally left uncovered at
  // the page level. Likewise, the post-selection focus move (focusInspectorFirstControl,
  // scheduled via requestAnimationFrame) has its own unit tests in
  // focus-inspector.test.ts; asserting the rAF callback fired from inside this page's
  // jsdom harness would be timing-fragile without an existing fake-timers/rAF-flush
  // pattern already in this file, so it is skipped here too.
});

// The webcam layer (ADR 0038): everything it adds hangs off the sidecar's webcam track.
// The loader (review W6): a saved session meets the sidecar, which alone decides whether the
// recording has a webcam (`reconcileWebcam`).
describe("VideoEditorPage — loading a session against the webcam sidecar", () => {
  const WITH_WEBCAM: VideoEditorSource = {
    ...SOURCE,
    webcam: { startOffsetMs: 0, offsetQuality: "exact", width: 1280, height: 720, fps: 30 },
  };
  const original = window.electronAPI.loadVideoEditSession;
  const savedSession = (sessionJson: string): void => {
    window.electronAPI.loadVideoEditSession = vi.fn(async () => ({ sessionJson, assets: [] }));
  };
  afterEach(() => {
    window.electronAPI.loadVideoEditSession = original;
  });

  it("a session saved before the webcam keeps its edits and gets the layer seeded from the sidecar", async () => {
    savedSession(SESSION_BEFORE_WEBCAM);
    renderEditor(WITH_WEBCAM);
    const footer = await waitForEditorLoaded();
    expect(getToasts().map((toast) => toast.message)).toContain("Restored your previous edit");
    expect(footer.querySelector('[data-zoom-id="zoom-1"]')).not.toBeNull();
    expect(footer.querySelector('[data-testid="webcam-lane"]')).not.toBeNull();
    expect(footer.querySelectorAll("[data-webcam-id]")).toHaveLength(0);
    expect(screen.getByTestId("webcam-layer")).toBeInTheDocument();
  });

  it("the same session on a recording without a webcam opens exactly as before", async () => {
    savedSession(SESSION_BEFORE_WEBCAM);
    renderEditor();
    const footer = await waitForEditorLoaded();
    expect(footer.querySelector('[data-zoom-id="zoom-1"]')).not.toBeNull();
    expect(footer.querySelector('[data-testid="webcam-lane"]')).toBeNull();
    expect(screen.queryByTestId("webcam-layer")).toBeNull();
  });

  it("a saved layer is restored with its segments; the sidecar's absence drops it", async () => {
    const scene = JSON.parse(SESSION_BEFORE_WEBCAM).scene;
    const withLayer = JSON.stringify({
      version: 1,
      scene: {
        ...scene,
        webcam: {
          layout: { ...WEBCAM_DEFAULTS },
          segments: [{ id: "cam-hidden", start: 3, end: 6, mode: "hidden" }],
        },
      },
    });
    savedSession(withLayer);
    renderEditor(WITH_WEBCAM);
    let footer = await waitForEditorLoaded();
    expect(footer.querySelector('[data-webcam-id="cam-hidden"]')).not.toBeNull();
    cleanup();

    savedSession(withLayer);
    renderEditor();
    footer = await waitForEditorLoaded();
    expect(footer.querySelector('[data-testid="webcam-lane"]')).toBeNull();
    expect(screen.queryByTestId("webcam-layer")).toBeNull();
  });
});

describe("VideoEditorPage — webcam track", () => {
  const WITH_WEBCAM: VideoEditorSource = {
    ...SOURCE,
    webcam: { startOffsetMs: 120, offsetQuality: "exact", width: 1280, height: 720, fps: 30 },
  };

  it("a recording without a webcam shows no lane, no layer, no second video and no hide action", async () => {
    thumbnailCalls.length = 0;
    renderEditor();
    const footer = await waitForEditorLoaded();
    expect(footer.querySelector('[data-testid="webcam-lane"]')).toBeNull();
    expect(screen.queryByTestId("webcam-layer")).toBeNull();
    expect(document.querySelectorAll("video")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Hide webcam here" })).toBeNull();
    // No webcam file to decode: the webcam filmstrip is asked for nothing.
    expect(thumbnailCalls.some((args) => String(args[0]).startsWith("kaipu-media://webcam"))).toBe(
      false,
    );
  });

  it("the webcam lane's filmstrip decodes the webcam file at its offset", async () => {
    thumbnailCalls.length = 0;
    renderEditor(WITH_WEBCAM);
    await waitForEditorLoaded();
    expect(thumbnailCalls).toContainEqual([
      "kaipu-media://webcam/rec-1",
      SOURCE.durationSeconds,
      0.12,
    ]);
  });

  it("a recording with a webcam gets the lane, the layer's own muted video and the hide action", async () => {
    renderEditor(WITH_WEBCAM);
    const footer = await waitForEditorLoaded();
    expect(footer.querySelector('[data-testid="webcam-lane"]')).not.toBeNull();
    expect(screen.getByText("Webcam")).toBeInTheDocument();
    const cam = screen.getByTestId("webcam-video") as HTMLVideoElement;
    expect(cam.getAttribute("src")).toBe("kaipu-media://webcam/rec-1");
    expect(cam.muted).toBe(true);
    expect(screen.getByRole("button", { name: "Hide webcam here" })).toBeInTheDocument();
  });

  it("Hide webcam here adds a selected hidden section; Delete removes it", async () => {
    renderEditor(WITH_WEBCAM);
    const footer = await waitForEditorLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Hide webcam here" }));
    const block = await waitFor(() => {
      const found = footer.querySelector('[data-webcam-id][data-mode="hidden"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
    expect(block).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("heading", { name: "Webcam section 1" })).toBeInTheDocument();
    await waitFor(() => {
      fireEvent.keyDown(window, { key: "Delete" });
      expect(footer.querySelector("[data-webcam-id]")).toBeNull();
    });
  });

  it("draws the bubble once both files report their size, and hides it while holding the original", async () => {
    stubDecodedVideoSize(1280, 720);
    try {
      renderEditor(WITH_WEBCAM);
      await waitForEditorLoaded();
      const main = Array.from(document.querySelectorAll("video")).find(
        (v) => v.dataset.testid !== "webcam-video",
      )!;
      fireEvent.loadedMetadata(main);
      const cam = screen.getByTestId("webcam-video") as HTMLVideoElement;
      Object.defineProperty(cam, "duration", { configurable: true, get: () => 60 });
      fireEvent.loadedMetadata(cam);
      // Main video at 0 s, webcam started 120 ms later: no webcam frame yet.
      expect(screen.getByTestId("webcam-layer").style.display).toBe("none");
      main.currentTime = 1;
      fireEvent(main, new Event("seeked"));
      expect(screen.getByTestId("webcam-layer").style.display).toBe("");
      const hold = screen.getByRole("button", { name: /original/i, pressed: false });
      fireEvent.pointerDown(hold, { pointerId: 1 });
      await waitFor(() => expect(screen.getByTestId("webcam-layer").style.display).toBe("none"));
      fireEvent.pointerUp(hold, { pointerId: 1 });
      await waitFor(() => expect(screen.getByTestId("webcam-layer").style.display).toBe(""));
    } finally {
      stubDecodedVideoSize(0, 0);
    }
  });

  // Review S1: with the layer selected the inspector follows the playhead into an override.
  // A slider drag that crossed that boundary used to swap the inspector, unmount the slider
  // mid-gesture and leave the scene's drag open — every later commit and undo was dropped.
  it("a slider drag survives the playhead entering an override; commits and undo still land", async () => {
    const scene = JSON.parse(SESSION_BEFORE_WEBCAM).scene;
    const original = window.electronAPI.loadVideoEditSession;
    window.electronAPI.loadVideoEditSession = vi.fn(async () => ({
      sessionJson: JSON.stringify({
        version: 1,
        scene: {
          ...scene,
          webcam: {
            layout: { ...WEBCAM_DEFAULTS },
            segments: [{ id: "cam-ov", start: 5, end: 8, mode: "override", layout: {} }],
          },
        },
      }),
      assets: [],
    }));
    try {
      renderEditor(WITH_WEBCAM);
      await waitForEditorLoaded();
      const bubble = screen.getByTestId("webcam-layer");
      fireEvent.pointerDown(bubble, { pointerId: 1 });
      fireEvent.pointerUp(bubble, { pointerId: 1 });
      expect(await screen.findByRole("heading", { name: "Webcam" })).toBeInTheDocument();

      const size = screen.getByRole("slider", { name: "Size" });
      fireEvent.pointerDown(size, { pointerId: 2 });
      fireEvent.change(size, { target: { value: "0.3" } });
      const main = Array.from(document.querySelectorAll("video")).find(
        (v) => v.dataset.testid !== "webcam-video",
      )!;
      main.currentTime = 6;
      fireEvent.timeUpdate(main);
      // The drag owns the inspector: it does not swap to the override under the playhead.
      expect(screen.getByRole("heading", { name: "Webcam" })).toBeInTheDocument();
      fireEvent.pointerUp(size, { pointerId: 2 });

      // Drag over, the playhead's override takes the inspector — and a commit lands.
      expect(await screen.findByRole("heading", { name: "Webcam section 1" })).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Square" }));
      expect(screen.getByRole("button", { name: "Square" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      fireEvent.keyDown(window, { key: "z", ctrlKey: true });
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Square" })).toHaveAttribute(
          "aria-pressed",
          "false",
        ),
      );
    } finally {
      window.electronAPI.loadVideoEditSession = original;
    }
  });

  it("grabbing the bubble opens the Webcam section of the inspector", async () => {
    renderEditor(WITH_WEBCAM);
    await waitForEditorLoaded();
    fireEvent.pointerDown(screen.getByTestId("webcam-layer"), { pointerId: 1 });
    expect(await screen.findByRole("heading", { name: "Webcam" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Position" })).toBeInTheDocument();
  });
});

describe("VideoEditorPage — Tracks popover (NIW2-665)", () => {
  type Settings = Awaited<ReturnType<typeof window.electronAPI.getSettings>>;
  type Patch = Parameters<typeof window.electronAPI.updateSettings>[0];
  let writes: Patch[];
  let original: Pick<
    typeof window.electronAPI,
    "getSettings" | "updateSettings" | "onSettingsChanged"
  >;

  /** A settings store that remembers what the page writes and tells its subscribers. */
  function fakeSettings(hiddenTracks: string[]): void {
    const base = original.getSettings();
    const listeners = new Set<(s: Settings) => void>();
    let current: Settings | null = null;
    const read = async (): Promise<Settings> => {
      current ??= { ...(await base), editor: { hiddenTracks } } as unknown as Settings;
      return current;
    };
    window.electronAPI.getSettings = read;
    window.electronAPI.updateSettings = async (patch: Patch) => {
      writes.push(patch);
      current = { ...(await read()), ...patch } as Settings;
      listeners.forEach((listener) => listener(current!));
      return current;
    };
    window.electronAPI.onSettingsChanged = (cb) => {
      listeners.add(cb as (s: Settings) => void);
      return () => listeners.delete(cb as (s: Settings) => void);
    };
  }

  beforeEach(() => {
    writes = [];
    original = {
      getSettings: window.electronAPI.getSettings,
      updateSettings: window.electronAPI.updateSettings,
      onSettingsChanged: window.electronAPI.onSettingsChanged,
    };
    stubDecodedVideoSize(1280, 720);
  });
  afterEach(() => {
    Object.assign(window.electronAPI, original);
    stubDecodedVideoSize(0, 0);
  });

  const laneLabels = (): string[] =>
    [...document.querySelectorAll("footer span")]
      .filter((el) => el.querySelector("svg") && el.textContent)
      .map((el) => el.textContent ?? "");
  const tracksTrigger = (): HTMLElement => screen.getByRole("button", { name: /^Tracks/ });

  const EDITED = {
    ...initialScene(30),
    items: [{ id: "clip-1", kind: "clip" as const, sourceStart: 0, sourceEnd: 30 }],
    overlays: [
      {
        id: "o1",
        kind: "text" as const,
        x: 0.4,
        y: 0.4,
        text: "still here",
        size: 19,
        color: "#000000",
        start: 0,
        end: 30,
      },
    ],
    redactions: [
      {
        id: "r1",
        kind: "cover" as const,
        start: 0,
        end: 30,
        rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
        fill: "#18181b",
        label: "",
      },
    ],
    mutedRanges: [{ id: "m1", sourceStart: 3, sourceEnd: 5 }],
    zoomSegments: [
      {
        id: "z1",
        start: 1,
        end: 10,
        scale: 2,
        mode: "fixed" as const,
        anchor: { x: 0.25, y: 0.25 },
        smoothing: 0,
        origin: "manual" as const,
        trigger: null,
      },
    ],
  };

  it("counts the lanes this take can show: 5/5 without a cursor track or a camera", async () => {
    fakeSettings([]);
    renderEditor();
    await waitForEditorLoaded();
    expect(tracksTrigger()).toHaveTextContent("Tracks 5/5");
    expect(laneLabels()).toEqual(["Clips", "Zooms", "Privacy", "Audio"]);
  });

  it("has no Activity row any more", async () => {
    fakeSettings([]);
    renderEditor();
    await waitForEditorLoaded();
    expect(laneLabels()).not.toContain("Activity");
    expect(document.querySelector("[data-testid='activity-lane']")).toBeNull();
  });

  it("draws the stored choice: a hidden lane is not on the timeline and the trigger counts it", async () => {
    fakeSettings(["zooms", "privacy"]);
    renderEditor();
    await waitForEditorLoaded();
    await waitFor(() => expect(tracksTrigger()).toHaveTextContent("Tracks 3/5"));
    expect(laneLabels()).toEqual(["Clips", "Audio"]);
  });

  it("unchecking Zooms in the popover hides the lane and saves editor.hiddenTracks", async () => {
    fakeSettings([]);
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(tracksTrigger());
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Zooms" }));
    await waitFor(() => expect(laneLabels()).toEqual(["Clips", "Privacy", "Audio"]));
    expect(writes).toEqual([{ editor: { hiddenTracks: ["zooms"] } }]);
    expect(tracksTrigger()).toHaveTextContent("Tracks 4/5");
  });

  it("selecting a zoom while Zooms is hidden shows the lane again, with the zoom selected", async () => {
    fakeSettings(["zooms"]);
    renderEditor();
    await waitForEditorLoaded();
    await waitFor(() => expect(laneLabels()).toEqual(["Clips", "Privacy", "Audio"]));

    // The Zoom tool adds a manual zoom at the playhead and selects it.
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    await screen.findByRole("heading", { name: "Zoom 1" });

    await waitFor(() => expect(laneLabels()).toContain("Zooms"));
    expect(writes).toEqual([{ editor: { hiddenTracks: [] } }]);
    expect(document.querySelector("[data-zoom-id]")).not.toBeNull();
  });

  it("adding a mute while Audio is hidden shows the Audio lane again", async () => {
    fakeSettings(["audio"]);
    renderEditor();
    await waitForEditorLoaded();
    await waitFor(() => expect(laneLabels()).not.toContain("Audio"));

    fireEvent.click(screen.getByRole("button", { name: "Audio" }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Mute a section/ }));

    await waitFor(() => expect(laneLabels()).toContain("Audio"));
    expect(writes).toEqual([{ editor: { hiddenTracks: [] } }]);
  });

  it("selecting something on a lane that is shown writes nothing", async () => {
    fakeSettings(["privacy"]);
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
    await screen.findByRole("heading", { name: "Zoom 1" });
    expect(writes).toEqual([]);
  });

  describe("hiding a lane clears a selection that lives on it", () => {
    const kinds: { lane: string; heading: string; select(footer: HTMLElement): void }[] = [
      {
        lane: "Privacy",
        heading: "Cover region",
        select: (footer) => fireEvent.click(footer.querySelector('[data-redaction-block="r1"]')!),
      },
      {
        lane: "Zooms",
        heading: "Zoom 1",
        select: (footer) => fireEvent.click(footer.querySelector('[data-zoom-id="z1"]')!),
      },
      {
        lane: "Audio",
        heading: "Muted section 1",
        select: (footer) => fireEvent.click(footer.querySelector('[data-mute-id="m1"]')!),
      },
      {
        lane: "Annotations",
        heading: "Text",
        // The annotation's pill in its lane: a button with an icon and no text.
        select: (footer) => fireEvent.pointerDown(footer.querySelector('button[class*="_pill_"]')!),
      },
    ];

    it.each(kinds)(
      "$lane: hiding it deselects the item on it, so Delete cannot remove it unseen",
      async ({ lane, heading, select }) => {
        window.electronAPI.loadVideoEditSession = vi.fn(async () => ({
          sessionJson: serializeSession(EDITED),
          assets: [],
        }));
        fakeSettings([]);
        renderEditor();
        const footer = await waitForEditorLoaded();
        await waitFor(() => expect(laneLabels()).toContain(lane));
        select(footer);
        await screen.findByRole("heading", { name: heading });

        fireEvent.click(tracksTrigger());
        fireEvent.click(screen.getByRole("menuitemcheckbox", { name: lane }));
        await waitFor(() => expect(laneLabels()).not.toContain(lane));
        expect(screen.queryByRole("heading", { name: heading })).toBeNull();

        // The page's Delete handler now has nothing selected: everything still exports.
        fireEvent.keyDown(window, { key: "Delete" });
        startExport.mockClear();
        clickExportVideo();
        await waitFor(() => expect(startExport).toHaveBeenCalledOnce());
        const handed = (startExport.mock.calls[0] as unknown[])[0] as { scene: typeof EDITED };
        expect(handed.scene.overlays).toHaveLength(1);
        expect(handed.scene.redactions).toHaveLength(1);
        expect(handed.scene.zoomSegments).toHaveLength(1);
        expect(handed.scene.mutedRanges).toHaveLength(1);
      },
    );

    it("leaves a selection on another lane alone", async () => {
      window.electronAPI.loadVideoEditSession = vi.fn(async () => ({
        sessionJson: serializeSession(EDITED),
        assets: [],
      }));
      fakeSettings([]);
      renderEditor();
      const footer = await waitForEditorLoaded();
      await waitFor(() => expect(laneLabels()).toContain("Privacy"));
      fireEvent.click(footer.querySelector('[data-zoom-id="z1"]')!);
      await screen.findByRole("heading", { name: "Zoom 1" });
      fireEvent.click(tracksTrigger());
      fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Privacy" }));
      await waitFor(() => expect(laneLabels()).not.toContain("Privacy"));
      expect(screen.getByRole("heading", { name: "Zoom 1" })).toBeInTheDocument();
    });
  });

  describe("hiding every lane changes no scene handed to the export (ADR 0050 decision 1)", () => {
    const HIDEABLE = TRACK_KEYS.filter((key) => key !== "clips");

    /** Open the saved edit with these lanes hidden, seek into the zoom, and export. */
    async function openAndExport(hidden: string[]) {
      window.electronAPI.loadVideoEditSession = vi.fn(async () => ({
        sessionJson: serializeSession(EDITED),
        assets: [],
      }));
      fakeSettings(hidden);
      startExport.mockClear();
      renderEditor();
      await waitForEditorLoaded();
      await waitFor(() =>
        expect(tracksTrigger()).toHaveTextContent(hidden.length ? /Tracks [1-9]\/5/ : "Tracks 5/5"),
      );
      const video = document.querySelector("video") as HTMLVideoElement;
      video.currentTime = 4;
      fireEvent(video, new Event("seeked"));
      const preview = {
        overlay: screen.queryByText("still here") !== null,
        redaction: document.querySelector('[data-redaction-id="r1"]') !== null,
        // The zoomed frame is the redaction layer's parent. A missing parent must fail the
        // test, not read back as `undefined` on both sides and compare equal.
        zoom: (
          document.querySelector('[data-testid="redaction-layer"]')?.parentElement as
            | HTMLElement
            | undefined
        )?.style.transform,
      };
      clickExportVideo();
      await waitFor(() => expect(startExport).toHaveBeenCalledOnce());
      const handed = (startExport.mock.calls[0] as unknown[])[0] as { scene: unknown };
      return { preview, scene: structuredClone(handed.scene) };
    }

    it("keeps the annotation, the redaction and the zoom in the preview, and hands the export the same scene", async () => {
      const shown = await openAndExport([]);
      cleanup();
      const hidden = await openAndExport(HIDEABLE);
      expect(laneLabels()).toEqual(["Clips"]);
      // Drawn in the preview whatever the timeline shows.
      expect(shown.preview.overlay).toBe(true);
      expect(shown.preview.redaction).toBe(true);
      expect(shown.preview.zoom).toEqual(expect.stringMatching(/scale\(/));
      expect(hidden.preview.zoom).toBe(shown.preview.zoom);
      expect(hidden.preview).toEqual(shown.preview);
      // And the export is handed the same scene: nothing dropped with its lane. (Annotation
      // stroke scale follows the live preview width, which this test does not pin.)
      expect(hidden.scene).toEqual(shown.scene);
      expect(hidden.scene).toMatchObject({
        overlays: [{ id: "o1" }],
        redactions: [{ id: "r1" }],
        zoomSegments: [{ id: "z1" }],
        mutedRanges: [{ id: "m1" }],
      });
    });
  });
});

describe("VideoEditorPage — preview playback speed (NIW2-666)", () => {
  const speedButton = (): HTMLElement => screen.getByRole("button", { name: /^Playback speed/ });
  const videoEl = (): HTMLVideoElement => document.querySelector("video") as HTMLVideoElement;

  beforeEach(() => {
    captureEventSpy.mockClear();
    startExport.mockClear();
    stubDecodedVideoSize(1280, 720);
  });
  afterEach(() => {
    cleanup();
    stubDecodedVideoSize(0, 0);
  });

  it("cycles 1x, 1.5x, 2x, 0.5x, 1x and the <video> follows each rate", async () => {
    renderEditor();
    await waitForEditorLoaded();
    expect(speedButton()).toHaveTextContent("1×");
    expect(videoEl().playbackRate).toBe(1);

    const seen: Array<[string | null, number]> = [];
    for (let i = 0; i < 4; i++) {
      fireEvent.click(speedButton());
      seen.push([speedButton().textContent, videoEl().playbackRate]);
    }
    expect(seen).toEqual([
      ["1.5×", 1.5],
      ["2×", 2],
      ["0.5×", 0.5],
      ["1×", 1],
    ]);
  });

  it("keeps the rate when the element loads a new source", async () => {
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(speedButton());
    fireEvent.click(speedButton()); // 2x
    videoEl().playbackRate = 1; // what a src change does to a real element
    fireEvent.loadedMetadata(videoEl());
    expect(videoEl().playbackRate).toBe(2);
  });

  it("reports one editor_speed_changed per change, with the speed and nothing else", async () => {
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(speedButton());
    fireEvent.click(speedButton());
    expect(captureEventSpy.mock.calls).toEqual([
      ["editor_speed_changed", { speed: 1.5 }],
      ["editor_speed_changed", { speed: 2 }],
    ]);
  });

  it("starts at 1x again when the editor is reopened", async () => {
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(speedButton());
    fireEvent.click(speedButton());
    expect(speedButton()).toHaveTextContent("2×");
    cleanup();

    renderEditor();
    await waitForEditorLoaded();
    expect(speedButton()).toHaveTextContent("1×");
    expect(videoEl().playbackRate).toBe(1);
    expect(captureEventSpy).toHaveBeenCalledTimes(2); // opening reports nothing
  });

  it("hands the export the same scene at 1x and at 2x", async () => {
    const exportedScene = async (clicks: number): Promise<unknown> => {
      renderEditor();
      await waitForEditorLoaded();
      for (let i = 0; i < clicks; i++) fireEvent.click(speedButton());
      startExport.mockClear();
      clickExportVideo();
      await waitFor(() => expect(startExport).toHaveBeenCalledOnce());
      const handed = (startExport.mock.calls[0] as unknown[])[0] as { scene: unknown };
      const scene = structuredClone(handed.scene);
      cleanup();
      return scene;
    };
    const at1x = await exportedScene(0);
    const at2x = await exportedScene(2);
    expect(at2x).toEqual(at1x);
    expect(JSON.stringify(at2x)).not.toMatch(/speed|playbackRate/i);
  });
});

describe("VideoEditorPage — timeline zoom (NIW2-667)", () => {
  // jsdom lays nothing out: the lane sits at x = 220 and is 1000 px wide, so the 30 s
  // recording is 33.3 px/s at fit and zooms up to 240 / 33.3 = 7.2x.
  const LANE_LEFT = 220;
  const LANE_WIDTH = 1000;

  // These tests need ONE fresh clip. An earlier describe leaves a saved session on the shared
  // fake IPC, which would open the editor already cut; start every test from no session.
  let loadSession: typeof window.electronAPI.loadVideoEditSession;
  beforeEach(() => {
    loadSession = window.electronAPI.loadVideoEditSession;
    window.electronAPI.loadVideoEditSession = async () => null;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const rect = (left: number, width: number): DOMRect =>
          ({
            left,
            right: left + width,
            width,
            top: 0,
            bottom: 20,
            height: 20,
            x: left,
            y: 0,
            toJSON: () => ({}),
          }) as DOMRect;
        const id = this.dataset.testid;
        if (id === "timeline-scroller") return rect(100, 120 + LANE_WIDTH);
        if (id === "lane-corner") return rect(100, 120);
        return rect(0, 0);
      },
    );
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.electronAPI.loadVideoEditSession = loadSession;
    stubDecodedVideoSize(0, 0);
  });

  const scroller = (): HTMLElement =>
    document.querySelector('[data-testid="timeline-scroller"]') as HTMLElement;
  const zoomIn = (): HTMLElement => screen.getByRole("button", { name: "Zoom in the timeline" });
  const zoomOut = (): HTMLElement => screen.getByRole("button", { name: "Zoom out the timeline" });
  const fit = (): HTMLElement =>
    screen.getByRole("button", { name: "Fit the whole recording in the timeline" });
  const zoomTo4x = (): void => {
    for (let i = 0; i < 4; i++) fireEvent.click(zoomIn()); // (√2)^4
    expect(Number(scroller().dataset.zoom)).toBeCloseTo(4, 6);
  };
  const stubCapture = (el: HTMLElement): HTMLElement => {
    el.setPointerCapture = vi.fn();
    el.hasPointerCapture = vi.fn(() => true);
    el.releasePointerCapture = vi.fn();
    return el;
  };

  it("opens at 1x, showing the whole recording as before: nothing to zoom out of or fit", async () => {
    renderEditor();
    await waitForEditorLoaded();
    expect(scroller().dataset.zoom).toBe("1");
    expect(scroller().scrollLeft).toBe(0);
    expect(zoomOut()).toBeDisabled();
    expect(fit()).toBeDisabled();
  });

  it("the transport bar's + and the strip are one view: + zooms the lanes, FIT brings them back", async () => {
    renderEditor();
    await waitForEditorLoaded();
    fireEvent.click(zoomIn());
    fireEvent.click(zoomIn());
    expect(Number(scroller().dataset.zoom)).toBeCloseTo(2, 6);
    expect(fit()).toBeEnabled();
    fireEvent.click(fit());
    expect(scroller().dataset.zoom).toBe("1");
    expect(scroller().scrollLeft).toBe(0);
  });

  it("a trim at 4x moves the edge by the time under the pointer, not the 1x amount", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    zoomTo4x();
    fireEvent.click(footer.querySelectorAll("button")[0]); // select the clip: its handles appear
    const end = stubCapture(
      await waitFor(() => {
        const handle = document.querySelector<HTMLElement>('[data-trim-handle="end"]');
        expect(handle).not.toBeNull();
        return handle!;
      }),
    );
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 800 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 600 }); // -200 px
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 600 });
    // 200 px at 4x (133.3 px/s) is 1.5 s: 30 s becomes 28.5 s. At 1x it would be -6 s: 24 s.
    await waitFor(() => expect(screen.getByText("0:00.0 / 0:28.5")).toBeInTheDocument());
  });

  it("a click on the ruler at 4x seeks to the time under the pointer", async () => {
    renderEditor();
    await waitForEditorLoaded();
    zoomTo4x();
    const ruler = stubCapture(screen.getByTestId("ruler"));
    // Off the centre: the + buttons zoom around the centre of the lane, so a click there
    // would read the same at 1x and at 4x and prove nothing.
    fireEvent.pointerDown(ruler, { pointerId: 1, clientX: LANE_LEFT + 800 });
    const scale = (Number(scroller().dataset.zoom) * LANE_WIDTH) / 30;
    const expected = (800 + scroller().scrollLeft) / scale;
    const tenths = Math.floor(expected * 10 + 1e-6);
    const label = `0:${String(Math.floor(tenths / 10)).padStart(2, "0")}.${tenths % 10} / 0:30.0`;
    await waitFor(() => expect(screen.getByText(label)).toBeInTheDocument());
    // The time the same pixel shows at 1x would be 24.0 s.
    expect(label).not.toBe("0:24.0 / 0:30.0");
    expect(screen.queryByText("0:24.0 / 0:30.0")).toBeNull();
  });

  it("deleting a clip while zoomed keeps the scroll inside the shorter content", async () => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    fireEvent.click(screen.getByRole("button", { name: "Forward" })); // 5 s
    await waitFor(() => expect(screen.getByText("0:05.0 / 0:30.0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(2));
    for (let i = 0; i < 6; i++) fireEvent.click(zoomIn()); // 8x would pass the 7.2x maximum
    const zoomBefore = Number(scroller().dataset.zoom);
    expect(zoomBefore).toBeCloseTo(7.2, 6);
    act(() => {
      scroller().scrollLeft = 99_999;
      fireEvent.scroll(scroller());
    });
    // The scroll really sits on the 7.2x maximum (6200 px), far past the 200 px that the
    // content left after the delete allows, so the re-clamp below has work to do.
    expect(scroller().scrollLeft).toBeCloseTo(zoomBefore * LANE_WIDTH - LANE_WIDTH, 3);
    fireEvent.click(footer.querySelectorAll("button")[1]); // select the second clip (25 s)
    fireEvent.click(screen.getByRole("button", { name: "Delete segment" }));
    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(1));
    // 5 s are left: it can only zoom 1.2x now, so the zoom and the scroll came down with it.
    const zoomAfter = Number(scroller().dataset.zoom);
    expect(zoomAfter).toBeLessThan(zoomBefore);
    expect(scroller().scrollLeft).toBeLessThanOrEqual(zoomAfter * LANE_WIDTH - LANE_WIDTH + 0.5);
    expect(scroller().scrollLeft).toBeLessThan(zoomBefore * LANE_WIDTH - LANE_WIDTH);
  });

  // Esc runs clearSelection(), which unmounts the trim handles. The handle held pointer
  // capture, so the browser sends `lostpointercapture` to the document and the handle's own
  // "drag ended" never fires (NIW2-667 review R2-1). Split and Delete are held back while a
  // drag owns the scene, so a drag that never ends also leaves them dead.
  const startTrimDragThenEscape = async (): Promise<HTMLElement> => {
    renderEditor();
    const footer = await waitForEditorLoaded();
    zoomTo4x();
    fireEvent.click(footer.querySelectorAll("button")[0]); // select the clip: its handles appear
    const end = stubCapture(
      await waitFor(() => {
        const handle = document.querySelector<HTMLElement>('[data-trim-handle="end"]');
        expect(handle).not.toBeNull();
        return handle!;
      }),
    );
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 800 });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(document.querySelector("[data-trim-handle]")).toBeNull());
    return footer;
  };

  it("Escape in the middle of a trim drag ends the drag: Split here works again", async () => {
    const footer = await startTrimDragThenEscape();
    fireEvent.click(screen.getByRole("button", { name: "Forward" })); // 5 s: inside the clip
    await waitFor(() => expect(screen.getByText("0:05.0 / 0:30.0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    await waitFor(() => expect(footer.querySelectorAll("button")).toHaveLength(2));
  });

  it("Escape in the middle of a trim drag leaves a paused seek off screen revealed", async () => {
    await startTrimDragThenEscape();
    // The zoom buttons zoom around the centre: the lane shows 11.25..18.75 s of the 30.
    for (let i = 0; i < 5; i++) fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    await waitFor(() => expect(screen.getByText("0:25.0 / 0:30.0")).toBeInTheDocument());
    // 25 s at 4x is 3333 px from the start of a 1000 px lane: unless the view scrolled to
    // follow the seek, it sits 1833 px off the right edge.
    await waitFor(() => {
      const x = (25 * Number(scroller().dataset.zoom) * LANE_WIDTH) / 30 - scroller().scrollLeft;
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(LANE_WIDTH);
    });
  });

  it("starts at 1x again when the editor is reopened: the view is not saved", async () => {
    renderEditor();
    await waitForEditorLoaded();
    zoomTo4x();
    cleanup();
    renderEditor();
    await waitForEditorLoaded();
    expect(scroller().dataset.zoom).toBe("1");
  });

  it("hands the export the same scene at 1x and at 4x", async () => {
    stubDecodedVideoSize(1280, 720);
    const exportedScene = async (zoom: boolean): Promise<unknown> => {
      renderEditor();
      await waitForEditorLoaded();
      if (zoom) zoomTo4x();
      startExport.mockClear();
      clickExportVideo();
      await waitFor(() => expect(startExport).toHaveBeenCalledOnce());
      const handed = (startExport.mock.calls[0] as unknown[])[0] as { scene: unknown };
      // A fresh open mints a fresh clip id; everything else must match.
      const scene = JSON.parse(
        JSON.stringify(handed.scene).replace(/"id":"[0-9a-f-]{36}"/g, '"id":"clip"'),
      ) as unknown;
      cleanup();
      return scene;
    };
    const atFit = await exportedScene(false);
    const zoomed = await exportedScene(true);
    expect(zoomed).toEqual(atFit);
  });
});

describe("VideoEditorPage — background (NIW2-668)", () => {
  const MAGENTA = { bg: "magenta", padding: 48, radius: 16, shadow: 24 } as const;

  // The saved-session fake is shared; start each test from none, and put it back after.
  let loadSession: typeof window.electronAPI.loadVideoEditSession;
  const savedSession = (json: string | null): void => {
    window.electronAPI.loadVideoEditSession = vi.fn(async () =>
      json === null ? null : { sessionJson: json, assets: [] },
    );
  };
  beforeEach(() => {
    loadSession = window.electronAPI.loadVideoEditSession;
    savedSession(null);
    startExport.mockClear();
    stubDecodedVideoSize(1280, 720);
    // The preview frame measures itself; jsdom lays nothing out.
    vi.spyOn(Element.prototype, "clientWidth", "get").mockReturnValue(960);
    vi.spyOn(Element.prototype, "clientHeight", "get").mockReturnValue(540);
  });
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    window.electronAPI.loadVideoEditSession = loadSession;
    stubDecodedVideoSize(0, 0);
  });

  const picture = (): HTMLElement => screen.getByTestId("preview-picture");
  const swatch = (name: string): HTMLElement => screen.getByRole("button", { name });
  const slider = (name: string): HTMLInputElement =>
    screen.getByRole("slider", { name }) as HTMLInputElement;
  const exportedArgs = async (): Promise<{
    scene: { background?: unknown };
    fingerprint: string;
  }> => {
    startExport.mockClear();
    clickExportVideo();
    await waitFor(() => expect(startExport).toHaveBeenCalledOnce());
    return (startExport.mock.calls[0] as unknown[])[0] as never;
  };

  it("shows the Background section above Detection with nothing selected: none, sliders disabled, picture fills the frame", async () => {
    renderEditor();
    await waitForEditorLoaded();
    const section = await screen.findByRole("region", { name: "Background" });
    const inspector = document.querySelector('[data-testid="editor-inspector"]')!;
    expect(inspector.contains(section)).toBe(true);
    const detection = screen.getByRole("heading", { name: "Detection" });
    expect(
      section.compareDocumentPosition(detection) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(section).getAllByRole("button")).toHaveLength(9);
    expect(swatch("None")).toHaveAttribute("aria-pressed", "true");
    for (const name of ["Padding", "Corners", "Shadow"]) expect(slider(name)).toBeDisabled();
    expect(slider("Padding")).toHaveValue("0");
    expect(picture().style.left).toBe("");
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--frame-bg")).toBe("");
  });

  it("choosing Magenta enables the sliders; padding 48, corners 16, shadow 24 insets the picture on the gradient", async () => {
    renderEditor();
    await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    fireEvent.click(swatch("Magenta"));
    for (const name of ["Padding", "Corners", "Shadow"]) expect(slider(name)).toBeEnabled();
    fireEvent.change(slider("Padding"), { target: { value: "48" } });
    fireEvent.change(slider("Corners"), { target: { value: "16" } });
    fireEvent.change(slider("Shadow"), { target: { value: "24" } });
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--frame-bg")).toBe(
      "linear-gradient(135deg, #ff2d6e, #a3044a)",
    );
    // 960×540 stage: 48 px at 1080 is 24 px, the radius 8 px, the picture keeps 16:9.
    expect(parseFloat(picture().style.top)).toBeCloseTo(24, 6);
    expect(parseFloat(picture().style.borderRadius)).toBeCloseTo(8, 6);
    expect(parseFloat(picture().style.height)).toBeCloseTo(492, 6);
    expect(picture().style.boxShadow).toMatch(/^0 \d/);
  });

  it("hands the export the background in the scene, and bg1 in the fingerprint; a plain scene has neither", async () => {
    renderEditor();
    await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    const plain = await exportedArgs();
    expect(plain.fingerprint).not.toMatch(/bg1/);
    cleanup();

    savedSession(serializeSession({ ...initialScene(30), background: MAGENTA }));
    renderEditor();
    await waitForEditorLoaded();
    const withBackground = await exportedArgs();
    expect(withBackground.scene.background).toEqual(MAGENTA);
    expect(withBackground.fingerprint).toMatch(/^edit:bg1:[0-9a-z]+$/);
    expect(withBackground.fingerprint).not.toBe(plain.fingerprint);
  });

  it("keeps the old fingerprint for none, even with stored numbers", async () => {
    renderEditor();
    await waitForEditorLoaded();
    const plain = await exportedArgs();
    cleanup();
    savedSession(
      serializeSession({
        ...initialScene(30),
        background: { bg: "none", padding: 48, radius: 16, shadow: 24 },
      }),
    );
    renderEditor();
    await waitForEditorLoaded();
    const stored = await exportedArgs();
    // The scene's items carry fresh ids per open, so compare what the fingerprint keys on: the
    // tag, which is absent for none.
    expect(stored.fingerprint).not.toMatch(/bg1/);
    expect(stored.fingerprint.split(":")).toHaveLength(plain.fingerprint.split(":").length);
  });

  it("restores the background when the editor is opened again", async () => {
    savedSession(serializeSession({ ...initialScene(30), background: MAGENTA }));
    renderEditor();
    await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    expect(getToasts().map((toast) => toast.message)).toContain("Restored your previous edit");
    expect(swatch("Magenta")).toHaveAttribute("aria-pressed", "true");
    expect(slider("Padding")).toHaveValue("48");
    expect(slider("Corners")).toHaveValue("16");
    expect(slider("Shadow")).toHaveValue("24");
    expect(parseFloat(picture().style.top)).toBeCloseTo(24, 6);
    expect(screen.getByTestId("preview-frame").style.getPropertyValue("--frame-bg")).toContain(
      "#ff2d6e",
    );
  });

  it("saves the background with the session", async () => {
    const save = vi.spyOn(window.electronAPI, "saveVideoEditSession");
    renderEditor();
    await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    fireEvent.click(swatch("Ocean"));
    clickExportVideo();
    await waitFor(() => expect(save).toHaveBeenCalled());
    const json = (save.mock.calls[0] as unknown[])[1] as string;
    expect(JSON.parse(json).scene.background).toMatchObject({ bg: "ocean" });
    expect(JSON.parse(json).version).toBe(1);
  });

  it("opens a session saved before backgrounds as none, edits intact", async () => {
    savedSession(SESSION_BEFORE_WEBCAM);
    renderEditor();
    const footer = await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    expect(footer.querySelector('[data-zoom-id="zoom-1"]')).not.toBeNull();
    expect(swatch("None")).toHaveAttribute("aria-pressed", "true");
    expect(slider("Padding")).toBeDisabled();
  });

  it("undo takes the background back, one step per click", async () => {
    renderEditor();
    await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    fireEvent.click(swatch("Magenta"));
    fireEvent.click(swatch("Ocean"));
    expect(swatch("Ocean")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(swatch("Magenta")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    expect(swatch("None")).toHaveAttribute("aria-pressed", "true");
    expect(slider("Padding")).toBeDisabled();
  });

  it("keeps the camera-transformed content layer inside the picture, so a zoom never reaches the padding", async () => {
    savedSession(serializeSession({ ...initialScene(30), background: MAGENTA }));
    renderEditor();
    await waitForEditorLoaded();
    await screen.findByRole("region", { name: "Background" });
    // The camera transform is written to the content layer, which lives inside the picture.
    expect(picture().contains(screen.getByTestId("preview-content"))).toBe(true);
    expect(screen.getByTestId("preview-frame").contains(picture())).toBe(true);
    // That the picture clips (`overflow: hidden`) is a stylesheet fact: preview-stage-sizing.test.ts.
  });
});
