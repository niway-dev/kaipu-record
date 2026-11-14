import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { toLayout } from "../timeline";
import { AddFromLibraryModal, type AddFromLibraryModalProps } from "./add-from-library-modal";

function video(over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: `id-${over.assetId}`,
    kind: "recording",
    title: `Title ${over.assetId}`,
    createdAt: Date.UTC(2026, 10, 5, 12, 0),
    durationSeconds: 16,
    derivedFromAssetId: null,
    sourceVideoAssetId: null,
    thumbnailUrl: `kaipu-media://thumb/${over.assetId}`,
    capture: { width: 1440, height: 1080 } as never,
    ...over,
  } as LibraryVideo;
}

const shot = (over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo =>
  video({ kind: "screenshot", durationSeconds: 0, ...over });

// illustrative: clips of 10 s and 20 s, ending at 10 and 30
const LAYOUT = toLayout([
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 30 },
]);

function renderModal(over: Partial<AddFromLibraryModalProps> = {}): AddFromLibraryModalProps {
  const props: AddFromLibraryModalProps = {
    videos: [],
    openedAssetId: "opened",
    layout: LAYOUT,
    playhead: 12,
    loaded: true,
    onAddRecording: vi.fn(),
    onAddScreenshot: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  render(<AddFromLibraryModal {...props} />);
  return props;
}

const rows = (): HTMLElement[] => screen.queryAllByTestId("add-from-library-row");
const cards = (): HTMLElement[] => screen.queryAllByTestId("add-from-library-screenshot");
const openScreenshots = (): void => {
  fireEvent.click(screen.getByRole("tab", { name: /Screenshots/ }));
};

beforeEach(() => {
  // jsdom implements no media playback: the preview's calls are recorded instead.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AddFromLibraryModal", () => {
  it("is the editorVideo.addFromLibrary area, a dialog titled Add from Library", () => {
    renderModal();
    expect(document.querySelector('[data-ui-area="editorVideo.addFromLibrary"]')).not.toBeNull();
    expect(screen.getByRole("alertdialog", { name: "Add from Library" })).toBeInTheDocument();
  });

  describe("Recordings tab", () => {
    it("lists each recording with thumbnail, duration badge, title, date and resolution", () => {
      renderModal({
        videos: [video({ assetId: "a", title: "Checkout bug", durationSeconds: 96 })],
      });
      const row = screen.getByRole("button", { name: "Checkout bug" });
      expect(row.querySelector("img")).toHaveAttribute("src", "kaipu-media://thumb/a");
      expect(within(row).getByText("1:36")).toBeInTheDocument();
      expect(within(row).getByText(/Nov 5, 2026/)).toBeInTheDocument();
      expect(within(row).getByText("1440 × 1080")).toBeInTheDocument();
    });

    it("draws a placeholder for a recording with no thumbnail and omits an unknown resolution", () => {
      renderModal({ videos: [video({ assetId: "a", thumbnailUrl: null, capture: null })] });
      const row = rows()[0];
      expect(row.querySelector("img")).toBeNull();
      expect(within(row).getByTestId("add-from-library-placeholder")).toBeInTheDocument();
      expect(within(row).queryByText(/×/)).toBeNull();
    });

    it("offers what joinableRecordings does, newest first: no opened recording, export, screenshot or GIF", () => {
      renderModal({
        videos: [
          video({ assetId: "opened", title: "Being edited" }),
          video({ assetId: "x", title: "An export", derivedFromAssetId: "opened" }),
          shot({ assetId: "s", title: "A frame" }),
          video({ assetId: "g", title: "A gif", kind: "gif" }),
          video({ assetId: "old", title: "Older take", createdAt: 1 }),
          video({ assetId: "new", title: "Newer take", createdAt: 9 }),
        ],
      });
      expect(rows().map((row) => row.getAttribute("aria-label"))).toEqual([
        "Newer take",
        "Older take",
      ]);
    });

    it("selects the first row by default and previews it", () => {
      renderModal({
        videos: [
          video({ assetId: "a", title: "Newest", createdAt: 9, durationSeconds: 21 }),
          video({ assetId: "b", title: "Older", createdAt: 1 }),
        ],
      });
      expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
      expect(rows()[1]).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByRole("heading", { name: "Newest" })).toBeInTheDocument();
    });

    it("clicking a row selects it and shows its title in the preview, without adding it", () => {
      const props = renderModal({
        videos: [
          video({ assetId: "a", title: "Newest", createdAt: 9 }),
          video({ assetId: "b", title: "Older", createdAt: 1 }),
        ],
      });
      fireEvent.click(rows()[1]);
      expect(rows()[1]).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByRole("heading", { name: "Older" })).toBeInTheDocument();
      expect(props.onAddRecording).not.toHaveBeenCalled();
    });

    it("filters by title, case-insensitively, and keeps a selection that is still listed", () => {
      renderModal({
        videos: [
          video({ assetId: "a", title: "Checkout bug", createdAt: 9 }),
          video({ assetId: "b", title: "Signup flow", createdAt: 1 }),
        ],
      });
      fireEvent.click(rows()[1]);
      fireEvent.change(screen.getByRole("searchbox", { name: "Search recordings" }), {
        target: { value: "SIGN" },
      });
      expect(rows()).toHaveLength(1);
      expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("falls back to the first row when the selected one is filtered out", () => {
      renderModal({
        videos: [
          video({ assetId: "a", title: "Checkout bug", createdAt: 9 }),
          video({ assetId: "b", title: "Signup flow", createdAt: 1 }),
        ],
      });
      fireEvent.click(rows()[1]);
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "checkout" } });
      expect(screen.getByRole("heading", { name: "Checkout bug" })).toBeInTheDocument();
    });

    it("says nothing matches, naming the query, and no preview is left", () => {
      renderModal({ videos: [video({ assetId: "a", title: "Checkout bug" })] });
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: " zzz " } });
      expect(screen.getByText("No recordings match “zzz”")).toBeInTheDocument();
      expect(rows()).toHaveLength(0);
      expect(screen.queryByTestId("add-from-library-video")).toBeNull();
    });

    it("is a tab widget: the panel is labelled by the selected tab, and arrows and Home/End move the selection and focus", () => {
      renderModal({ videos: [video({ assetId: "a" }), shot({ assetId: "s1" })] });
      const recordingsTab = screen.getByRole("tab", { name: /Recordings/ });
      const screenshotsTab = screen.getByRole("tab", { name: /Screenshots/ });
      expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Recordings/);
      expect(recordingsTab).toHaveAttribute("aria-controls", screen.getByRole("tabpanel").id);
      // Only the selected tab is a Tab stop.
      expect(recordingsTab).toHaveAttribute("tabindex", "0");
      expect(screenshotsTab).toHaveAttribute("tabindex", "-1");

      fireEvent.keyDown(recordingsTab, { key: "ArrowRight" });
      expect(screenshotsTab).toHaveAttribute("aria-selected", "true");
      expect(screenshotsTab).toHaveFocus();
      expect(screen.getByRole("tabpanel")).toHaveAccessibleName(/Screenshots/);
      expect(cards()).toHaveLength(1);

      // Wraps around, and Home/End go to the ends.
      fireEvent.keyDown(screenshotsTab, { key: "ArrowRight" });
      expect(recordingsTab).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(recordingsTab, { key: "End" });
      expect(screenshotsTab).toHaveAttribute("aria-selected", "true");
      fireEvent.keyDown(screenshotsTab, { key: "Home" });
      expect(recordingsTab).toHaveAttribute("aria-selected", "true");
      expect(recordingsTab).toHaveFocus();
    });

    it("counts the tabs from the unfiltered lists", () => {
      renderModal({
        videos: [
          video({ assetId: "a", title: "Checkout bug" }),
          video({ assetId: "b", title: "Signup flow" }),
          shot({ assetId: "s1" }),
        ],
      });
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "checkout" } });
      expect(screen.getByRole("tab", { name: "Recordings 2" })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(screen.getByRole("tab", { name: "Screenshots 1" })).toHaveAttribute(
        "aria-selected",
        "false",
      );
    });

    it("says there are no other recordings, even for a query over an empty list", () => {
      renderModal({ videos: [video({ assetId: "opened" })] });
      expect(screen.getByText("No other recordings")).toBeInTheDocument();
      fireEvent.change(screen.getByRole("searchbox"), { target: { value: "abc" } });
      expect(screen.getByText("No other recordings")).toBeInTheDocument();
    });

    it("says the read failed, not that there are none, when it failed with no rows", () => {
      renderModal({ failed: true });
      expect(
        screen.getByText("Couldn't read the Library. It will try again when it changes."),
      ).toBeInTheDocument();
      expect(screen.queryByText("No other recordings")).toBeNull();
    });

    it("still lists the rows it has when a read failed", () => {
      renderModal({ failed: true, videos: [video({ assetId: "a", title: "Checkout bug" })] });
      expect(rows()).toHaveLength(1);
    });

    it("says it is loading, and nothing about empty, before the first read lands", () => {
      renderModal({ loaded: false });
      expect(screen.getByText("Loading recordings…")).toBeInTheDocument();
      expect(screen.queryByText("No other recordings")).toBeNull();
    });

    describe("adding", () => {
      const list = [
        video({ assetId: "a", title: "Newest", createdAt: 9 }),
        video({ assetId: "b", title: "Older", createdAt: 1 }),
      ];

      it("Add after current clip lands after the clip under the playhead", () => {
        // 12 s is inside the second clip (10 to 30), so after it is the end, index 2, at 30 s.
        const props = renderModal({ videos: list, playhead: 12 });
        fireEvent.click(rows()[1]);
        fireEvent.click(screen.getByRole("button", { name: "Add after current clip" }));
        expect(props.onAddRecording).toHaveBeenCalledOnce();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "b" }),
          { index: 2, time: 30 },
        );
      });

      it("after the clip under the playhead means index 1 while the playhead is in the first clip", () => {
        const props = renderModal({ videos: list, playhead: 3 });
        fireEvent.click(screen.getByRole("button", { name: "Add after current clip" }));
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 1, time: 10 },
        );
      });

      it("Add at start lands at index 0", () => {
        const props = renderModal({ videos: list, playhead: 25 });
        fireEvent.click(screen.getByRole("button", { name: "Add at start" }));
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 0, time: 0 },
        );
      });

      it("Add at end lands at the layout length", () => {
        const props = renderModal({ videos: list, playhead: 1 });
        fireEvent.click(screen.getByRole("button", { name: "Add at end" }));
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 2, time: 30 },
        );
      });

      it("a double click on a row adds that recording after the current clip", () => {
        const props = renderModal({ videos: list, playhead: 3 });
        fireEvent.doubleClick(rows()[1]);
        expect(props.onAddRecording).toHaveBeenCalledOnce();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "b" }),
          { index: 1, time: 10 },
        );
      });

      it("stays open after an add, for the next one", () => {
        const props = renderModal({ videos: list });
        fireEvent.click(screen.getByRole("button", { name: "Add at end" }));
        expect(props.onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });
    });

    describe("the preview", () => {
      const list = [
        video({ assetId: "a", title: "Newest", createdAt: 9, id: "newest-id" }),
        video({ assetId: "b", title: "Older", createdAt: 1, id: "older-id" }),
      ];
      const videoEl = (): HTMLVideoElement => screen.getByTestId("add-from-library-video");

      it("plays the selected recording muted from the Library's media URL", () => {
        renderModal({ videos: list });
        expect(videoEl().muted).toBe(true);
        expect(videoEl().getAttribute("src")).toMatch(/^kaipu-media:\/\/recording\/newest-id/);
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
      });

      it("is one element: choosing another row swaps its src", () => {
        renderModal({ videos: list });
        const before = videoEl();
        fireEvent.click(rows()[1]);
        expect(document.querySelectorAll("video")).toHaveLength(1);
        expect(videoEl()).toBe(before);
        expect(before.getAttribute("src")).toMatch(/^kaipu-media:\/\/recording\/older-id/);
        expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
      });

      it("pauses and clears src on unmount, and on leaving the tab", () => {
        renderModal({ videos: list });
        const el = videoEl();
        openScreenshots();
        expect(document.querySelectorAll("video")).toHaveLength(0);
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
        expect(el.hasAttribute("src")).toBe(false);

        fireEvent.click(screen.getByRole("tab", { name: /Recordings/ }));
        const again = videoEl();
        cleanup();
        expect(again.hasAttribute("src")).toBe(false);
      });

      it("has a play/pause button that follows the element and a scrub bar that seeks it", () => {
        renderModal({ videos: [video({ assetId: "a", id: "x", durationSeconds: 21 })] });
        // The element is "playing" once it says so.
        fireEvent.play(videoEl());
        const pauseButton = screen.getByRole("button", { name: "Pause preview" });
        Object.defineProperty(videoEl(), "paused", { value: false, configurable: true });
        fireEvent.click(pauseButton);
        expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
        fireEvent.pause(videoEl());
        expect(screen.getByRole("button", { name: "Play preview" })).toBeInTheDocument();

        const scrub = screen.getByRole("slider", { name: "Seek the preview" });
        expect(scrub).toHaveAttribute("max", "21");
        fireEvent.change(scrub, { target: { value: "7.5" } });
        expect(videoEl().currentTime).toBe(7.5);
      });

      it("says the file cannot be played, and still previews the next selection", () => {
        renderModal({ videos: list });
        fireEvent.error(videoEl());
        expect(screen.getByText("This recording can't be played.")).toBeInTheDocument();
        fireEvent.click(rows()[1]);
        expect(screen.queryByText("This recording can't be played.")).toBeNull();
        expect(videoEl().getAttribute("src")).toMatch(/older-id/);
      });
    });
  });

  describe("Screenshots tab", () => {
    const shots = [
      shot({ assetId: "s1", title: "Pricing page", createdAt: 9 }),
      shot({ assetId: "s2", title: "Login", createdAt: 5, sourceVideoAssetId: "opened" }),
      shot({ assetId: "s3", title: "Other", createdAt: 1, sourceVideoAssetId: "someone-else" }),
    ];

    it("shows every screenshot as a card, newest first, with title, date and resolution", () => {
      renderModal({
        videos: [...shots, video({ assetId: "r" }), video({ assetId: "g", kind: "gif" })],
      });
      openScreenshots();
      expect(cards().map((card) => card.getAttribute("aria-label"))).toEqual([
        "Add Pricing page",
        "Add Login",
        "Add Other",
      ]);
      expect(within(cards()[0]).getByText(/\d{4} · \d{2}:\d{2} · 1440 × 1080/)).toBeInTheDocument();
      expect(cards()[0].querySelector("img")).toHaveAttribute("src", "kaipu-media://thumb/s1");
    });

    it("never lists GIFs, even though the Library holds them", () => {
      renderModal({ videos: [shot({ assetId: "s" }), video({ assetId: "g", kind: "gif" })] });
      openScreenshots();
      expect(cards()).toHaveLength(1);
      expect(screen.getByRole("tab", { name: "Screenshots 1" })).toBeInTheDocument();
    });

    it("tags only the screenshots taken from the opened recording", () => {
      renderModal({ videos: shots });
      openScreenshots();
      expect(within(cards()[1]).getByText("From this recording")).toBeInTheDocument();
      expect(within(cards()[0]).queryByText("From this recording")).toBeNull();
      expect(within(cards()[2]).queryByText("From this recording")).toBeNull();
    });

    it("a click adds that screenshot, once, and leaves the modal open", () => {
      const props = renderModal({ videos: shots });
      openScreenshots();
      fireEvent.click(cards()[1]);
      expect(props.onAddScreenshot).toHaveBeenCalledOnce();
      expect(props.onAddScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: "s2" }),
      );
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onAddRecording).not.toHaveBeenCalled();
    });

    it("searches its own field, by title, apart from the recordings search", () => {
      renderModal({ videos: [...shots, video({ assetId: "r", title: "Pricing take" })] });
      fireEvent.change(screen.getByRole("searchbox", { name: "Search recordings" }), {
        target: { value: "nothing like it" },
      });
      openScreenshots();
      const search = screen.getByRole("searchbox", { name: "Search screenshots" });
      expect(search).toHaveValue("");
      expect(cards()).toHaveLength(3);
      fireEvent.change(search, { target: { value: "PRICING" } });
      expect(cards()).toHaveLength(1);
      fireEvent.change(search, { target: { value: "zzz" } });
      expect(screen.getByText("No screenshots match “zzz”")).toBeInTheDocument();
      // The recordings tab kept its own query.
      fireEvent.click(screen.getByRole("tab", { name: /Recordings/ }));
      expect(screen.getByRole("searchbox", { name: "Search recordings" })).toHaveValue(
        "nothing like it",
      );
    });

    it("says the Library has no screenshots, loading, and a failed read", () => {
      const { rerender } = render(
        <AddFromLibraryModal
          videos={[]}
          openedAssetId="opened"
          layout={LAYOUT}
          playhead={0}
          loaded={false}
          onAddRecording={vi.fn()}
          onAddScreenshot={vi.fn()}
          onClose={vi.fn()}
        />,
      );
      openScreenshots();
      expect(screen.getByText("Loading screenshots…")).toBeInTheDocument();
      const props = {
        videos: [],
        openedAssetId: "opened",
        layout: LAYOUT,
        playhead: 0,
        onAddRecording: vi.fn(),
        onAddScreenshot: vi.fn(),
        onClose: vi.fn(),
      };
      rerender(<AddFromLibraryModal {...props} loaded />);
      expect(screen.getByText("No screenshots in the Library")).toBeInTheDocument();
      rerender(<AddFromLibraryModal {...props} loaded failed />);
      expect(
        screen.getByText("Couldn't read the Library. It will try again when it changes."),
      ).toBeInTheDocument();
    });

    it("hints that it adds at the playhead, with the time", () => {
      renderModal({ videos: shots, playhead: 169.4 });
      openScreenshots();
      expect(screen.getByText("2:49.4")).toBeInTheDocument();
      expect(screen.getByText(/Adds at the playhead/)).toBeInTheDocument();
      expect(screen.getByText("Click to add")).toBeInTheDocument();
    });

    it("the recordings tab shows no playhead footer", () => {
      renderModal({ videos: [video({ assetId: "a" })] });
      expect(screen.queryByText("Click to add")).toBeNull();
    });
  });

  describe("closing", () => {
    it("the close button closes", () => {
      const props = renderModal();
      fireEvent.click(screen.getByRole("button", { name: "Close Add from Library" }));
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it("Escape closes", () => {
      const props = renderModal({ videos: [video({ assetId: "a" })] });
      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
      expect(props.onClose).toHaveBeenCalledOnce();
    });

    it("a click on the backdrop closes, a click inside does not", () => {
      const props = renderModal({ videos: [video({ assetId: "a" })] });
      fireEvent.click(screen.getByTestId("add-from-library-modal"));
      expect(props.onClose).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("alertdialog"));
      expect(props.onClose).toHaveBeenCalledOnce();
    });
  });
});
