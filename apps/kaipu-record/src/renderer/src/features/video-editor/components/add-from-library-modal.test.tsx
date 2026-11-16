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
    onAddScreenshotToSequence: vi.fn(),
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
// The destination menu: items are named by their label plus its hint, so match the label's start.
const OVER = /^Over the video/;
const BEFORE = /^Before this clip/;
const AFTER = /^After this clip/;
const START = /^At the start/;
const END = /^At the end/;
const arrow = (): HTMLElement => screen.getByRole("button", { name: "Choose where it goes" });
const openMenu = (): void => {
  if (arrow().getAttribute("aria-expanded") !== "true") fireEvent.click(arrow());
};
const item = (label: RegExp): HTMLElement => screen.getByRole("menuitemradio", { name: label });
// Picks a destination through the menu, which closes itself.
const choose = (label: RegExp): void => {
  openMenu();
  fireEvent.click(item(label));
};
// Looks at which destination is checked, then puts the menu away again.
const expectChosen = (label: RegExp): void => {
  openMenu();
  expect(item(label)).toHaveAttribute("aria-checked", "true");
  for (const other of screen.getAllByRole("menuitemradio")) {
    if (other !== item(label)) expect(other).toHaveAttribute("aria-checked", "false");
  }
  fireEvent.keyDown(item(label), { key: "Escape" });
};
const ADD = /^Add (over the video|before this clip|after this clip|at the start|at the end)$/;
const add = (): void => {
  fireEvent.click(screen.getByRole("button", { name: ADD }));
};
const sentence = (): string => screen.getByTestId("placement-sentence").textContent ?? "";

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

      it("the menu lists every destination, with Over the video disabled and a hint why", () => {
        renderModal({ videos: list });
        openMenu();
        expect(item(OVER)).toHaveAttribute("aria-disabled", "true");
        expect(screen.getByText("Floating videos come later.")).toBeInTheDocument();
        for (const label of [BEFORE, AFTER, START, END]) {
          expect(item(label)).not.toHaveAttribute("aria-disabled");
        }
        expect(screen.getByText("Pushes this clip and the rest later.")).toBeInTheDocument();
        expect(screen.getByText("Pushes what comes after it later.")).toBeInTheDocument();
        expect(screen.getByText("Pushes the whole video later.")).toBeInTheDocument();
        expect(screen.getByText("Nothing moves.")).toBeInTheDocument();
        expect(screen.getAllByRole("menuitemradio")).toHaveLength(5);
        expect(screen.getByRole("menu", { name: "Where it goes" })).toBeInTheDocument();
      });

      it("selects after this clip by default, never the disabled option", () => {
        renderModal({ videos: list });
        expectChosen(AFTER);
        expect(screen.getByRole("button", { name: "Add after this clip" })).toBeInTheDocument();
      });

      it("Add lands after the clip under the playhead by default", () => {
        // 12 s is inside the second clip (10 to 30), so after it is the end, index 2, at 30 s.
        const props = renderModal({ videos: list, playhead: 12 });
        fireEvent.click(rows()[1]);
        add();
        expect(props.onAddRecording).toHaveBeenCalledOnce();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "b" }),
          { index: 2, time: 30 },
        );
      });

      it("after the clip under the playhead means index 1 while the playhead is in the first clip", () => {
        const props = renderModal({ videos: list, playhead: 3 });
        add();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 1, time: 10 },
        );
      });

      it("Before the clip under the playhead lands where that clip starts", () => {
        const props = renderModal({ videos: list, playhead: 12 });
        choose(BEFORE);
        add();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 1, time: 10 },
        );
      });

      it("At the start lands at index 0", () => {
        const props = renderModal({ videos: list, playhead: 25 });
        choose(START);
        add();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 0, time: 0 },
        );
      });

      it("At the end lands at the layout length", () => {
        const props = renderModal({ videos: list, playhead: 1 });
        choose(END);
        add();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 2, time: 30 },
        );
      });

      it("a double click on a row adds it at the chosen destination", () => {
        const props = renderModal({ videos: list, playhead: 3 });
        choose(START);
        fireEvent.doubleClick(rows()[1]);
        expect(props.onAddRecording).toHaveBeenCalledOnce();
        expect(props.onAddRecording).toHaveBeenCalledWith(
          expect.objectContaining({ assetId: "b" }),
          { index: 0, time: 0 },
        );
      });

      it("stays open after an add, for the next one", () => {
        const props = renderModal({ videos: list });
        add();
        expect(props.onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("alertdialog")).toBeInTheDocument();
      });

      it("reports the destination used so the page can remember it", () => {
        const onRememberDestination = vi.fn();
        renderModal({ videos: list, onRememberDestination });
        choose(END);
        expect(onRememberDestination).not.toHaveBeenCalled();
        add();
        expect(onRememberDestination).toHaveBeenCalledWith("recording", "end");
      });

      it("starts at the destination remembered for recordings, and keeps the choice on a second add", () => {
        const props = renderModal({
          videos: list,
          playhead: 3,
          rememberedDestinations: { recording: "start" },
        });
        expectChosen(START);
        add();
        add();
        expect(props.onAddRecording).toHaveBeenCalledTimes(2);
        expect(props.onAddRecording).toHaveBeenLastCalledWith(
          expect.objectContaining({ assetId: "a" }),
          { index: 0, time: 0 },
        );
      });

      it("ignores a remembered Over the video for a recording", () => {
        renderModal({ videos: list, rememberedDestinations: { recording: "over" } });
        expectChosen(AFTER);
        openMenu();
        expect(item(OVER)).toHaveAttribute("aria-disabled", "true");
      });

      it("Over the video is not choosable for a recording: a click leaves the choice and the menu as they are", () => {
        const onRememberDestination = vi.fn();
        const props = renderModal({ videos: list, onRememberDestination });
        openMenu();
        fireEvent.click(item(OVER));
        expect(screen.getByRole("menu")).toBeInTheDocument();
        expect(item(AFTER)).toHaveAttribute("aria-checked", "true");
        expect(screen.getByRole("button", { name: "Add after this clip" })).toBeInTheDocument();
        expect(props.onAddRecording).not.toHaveBeenCalled();
        expect(onRememberDestination).not.toHaveBeenCalled();
      });

      it("the Add button says where it adds, following the chosen destination", () => {
        renderModal({ videos: list });
        const labels: Array<[RegExp, string]> = [
          [OVER, "Add over the video"],
          [BEFORE, "Add before this clip"],
          [AFTER, "Add after this clip"],
          [START, "Add at the start"],
          [END, "Add at the end"],
        ];
        // Over is for screenshots, so a recording walks the four sequence places.
        for (const [label, name] of labels.filter(([label]) => label !== OVER)) {
          choose(label);
          expect(screen.getByRole("button", { name })).toBeInTheDocument();
        }
      });

      describe("the placement strip", () => {
        it("says, with numbers from the real layout, which clips move and by how much", () => {
          // A 16 s recording; 3 s is in the first clip, so after it the second clip moves 16 s.
          renderModal({ videos: list, playhead: 3 });
          expect(sentence()).toBe("Goes after the clip you are on. 1 clip moves 0:16 later.");
          choose(BEFORE);
          expect(sentence()).toBe("Goes before the clip you are on. 2 clips move 0:16 later.");
          choose(START);
          expect(sentence()).toBe(
            "Becomes the first thing in the video. All 2 clips move 0:16 later.",
          );
          choose(END);
          expect(sentence()).toBe("Goes last. No clip moves.");
        });

        it("after the clip the playhead is in, in the last clip, nothing moves", () => {
          renderModal({ videos: list, playhead: 12 });
          expect(sentence()).toBe("Goes after the clip you are on. No clip moves.");
        });

        it("draws the real sequence: two clips plus the new one, the new one in the right place", () => {
          renderModal({ videos: list, playhead: 3 });
          const blocks = within(screen.getByTestId("placement-strip")).getAllByTestId(
            "placement-block",
          );
          expect(blocks.map((el) => el.getAttribute("data-new"))).toEqual([null, "true", null]);
          expect(blocks.map((el) => el.getAttribute("data-moved"))).toEqual([null, null, "true"]);
          expect(screen.getByText("New · 0:16")).toBeInTheDocument();
          // The drawing is not read out: only the sentence is.
          expect(blocks[0].closest("[aria-hidden]")).not.toBeNull();
          expect(screen.getByTestId("placement-sentence").closest("[aria-hidden]")).toBeNull();
        });
      });

      describe("the destination menu", () => {
        it("opens upward from the arrow part, which reports its state", () => {
          renderModal({ videos: list });
          expect(arrow()).toHaveAttribute("aria-haspopup", "menu");
          expect(arrow()).toHaveAttribute("aria-expanded", "false");
          expect(arrow()).toHaveAttribute("title", "Choose where it goes");
          expect(screen.queryByRole("menu")).toBeNull();
          fireEvent.click(arrow());
          expect(arrow()).toHaveAttribute("aria-expanded", "true");
          expect(arrow()).toHaveAttribute("aria-controls", screen.getByRole("menu").id);
        });

        it("choosing an option sets the destination and closes the menu, without adding", () => {
          const onRememberDestination = vi.fn();
          const props = renderModal({ videos: list, onRememberDestination });
          choose(START);
          expect(screen.queryByRole("menu")).toBeNull();
          expect(screen.getByRole("button", { name: "Add at the start" })).toBeInTheDocument();
          expect(props.onAddRecording).not.toHaveBeenCalled();
          expect(onRememberDestination).not.toHaveBeenCalled();
          expect(arrow()).toHaveFocus();
        });

        it("opening focuses the chosen item", () => {
          renderModal({ videos: list });
          fireEvent.click(arrow());
          expect(item(AFTER)).toHaveFocus();
        });

        it("Escape closes the menu, returns focus to the arrow and leaves the modal open", () => {
          const props = renderModal({ videos: list });
          fireEvent.click(arrow());
          fireEvent.keyDown(item(AFTER), { key: "Escape" });
          expect(screen.queryByRole("menu")).toBeNull();
          expect(arrow()).toHaveFocus();
          expect(props.onClose).not.toHaveBeenCalled();
          // With the menu closed, the next Escape reaches the modal.
          fireEvent.keyDown(arrow(), { key: "Escape" });
          expect(props.onClose).toHaveBeenCalledOnce();
        });

        it("arrows move through the options and skip the disabled one; Home and End jump", () => {
          renderModal({ videos: list });
          fireEvent.click(arrow());
          fireEvent.keyDown(item(AFTER), { key: "ArrowDown" });
          expect(item(START)).toHaveFocus();
          fireEvent.keyDown(item(START), { key: "ArrowDown" });
          expect(item(END)).toHaveFocus();
          fireEvent.keyDown(item(END), { key: "ArrowDown" });
          // Over is disabled for a recording, so the cycle wraps to Before.
          expect(item(BEFORE)).toHaveFocus();
          fireEvent.keyDown(item(BEFORE), { key: "ArrowUp" });
          expect(item(END)).toHaveFocus();
          fireEvent.keyDown(item(END), { key: "Home" });
          expect(item(BEFORE)).toHaveFocus();
          fireEvent.keyDown(item(BEFORE), { key: "End" });
          expect(item(END)).toHaveFocus();
        });

        it("Enter on a focused option chooses it", () => {
          renderModal({ videos: list });
          fireEvent.click(arrow());
          fireEvent.keyDown(item(AFTER), { key: "ArrowUp" });
          expect(item(BEFORE)).toHaveFocus();
          // A native button turns Enter into a click, which jsdom does not; click is that.
          fireEvent.click(item(BEFORE));
          expect(screen.getByRole("button", { name: "Add before this clip" })).toBeInTheDocument();
        });

        it("Tab closes it", () => {
          renderModal({ videos: list });
          fireEvent.click(arrow());
          fireEvent.keyDown(item(AFTER), { key: "Tab" });
          expect(screen.queryByRole("menu")).toBeNull();
        });

        it("a press outside closes it, and a press inside the menu does not", () => {
          renderModal({ videos: list });
          fireEvent.click(arrow());
          fireEvent.pointerDown(item(AFTER));
          expect(screen.getByRole("menu")).toBeInTheDocument();
          fireEvent.pointerDown(screen.getByRole("heading", { name: "Newest" }));
          expect(screen.queryByRole("menu")).toBeNull();
        });

        it("another selection or another tab closes it", () => {
          renderModal({ videos: [...list, shot({ assetId: "s", title: "Frame" })] });
          fireEvent.click(arrow());
          fireEvent.click(rows()[1]);
          expect(screen.queryByRole("menu")).toBeNull();
          fireEvent.click(arrow());
          openScreenshots();
          expect(screen.queryByRole("menu")).toBeNull();
        });

        it("pointing at an option previews it in the strip, and closing goes back to the choice", () => {
          renderModal({ videos: list, playhead: 3 });
          expect(sentence()).toBe("Goes after the clip you are on. 1 clip moves 0:16 later.");
          fireEvent.click(arrow());
          fireEvent.mouseEnter(item(END));
          expect(sentence()).toBe("Goes last. No clip moves.");
          // The Add button still follows the choice, not the preview.
          expect(screen.getByRole("button", { name: "Add after this clip" })).toBeInTheDocument();
          fireEvent.mouseLeave(item(END));
          expect(sentence()).toBe("Goes after the clip you are on. 1 clip moves 0:16 later.");
          fireEvent.mouseEnter(item(START));
          expect(sentence()).toBe(
            "Becomes the first thing in the video. All 2 clips move 0:16 later.",
          );
          fireEvent.keyDown(item(AFTER), { key: "Escape" });
          expect(sentence()).toBe("Goes after the clip you are on. 1 clip moves 0:16 later.");
        });

        it("the keyboard's option previews too", () => {
          renderModal({ videos: list, playhead: 3 });
          fireEvent.click(arrow());
          fireEvent.keyDown(item(AFTER), { key: "End" });
          expect(sentence()).toBe("Goes last. No clip moves.");
        });

        it("a disabled option does not preview", () => {
          renderModal({ videos: list, playhead: 3 });
          fireEvent.click(arrow());
          fireEvent.mouseEnter(item(OVER));
          expect(sentence()).toBe("Goes after the clip you are on. 1 clip moves 0:16 later.");
        });
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
        "Pricing page",
        "Login",
        "Other",
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

    it("a click only selects the card: nothing is added and the chooser appears for it", () => {
      const props = renderModal({ videos: shots });
      openScreenshots();
      expect(screen.queryByTestId("add-destination-button")).toBeNull();
      expect(screen.getByText("Select a screenshot to choose where it goes.")).toBeInTheDocument();
      fireEvent.click(cards()[1]);
      expect(cards()[1]).toHaveAttribute("aria-pressed", "true");
      expect(cards()[1]).toHaveAttribute("data-selected", "true");
      expect(cards()[0]).toHaveAttribute("aria-pressed", "false");
      expect(screen.getByTestId("add-destination-button")).toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Login" })).toBeInTheDocument();
      expect(props.onAddScreenshot).not.toHaveBeenCalled();
      expect(props.onAddScreenshotToSequence).not.toHaveBeenCalled();
    });

    it("shows the selected screenshot's image in the right column, none before a selection", () => {
      renderModal({ videos: shots });
      openScreenshots();
      expect(screen.queryByTestId("add-from-library-shot-preview")).toBeNull();
      fireEvent.click(cards()[1]);
      expect(screen.getByTestId("add-from-library-shot-preview")).toHaveAttribute(
        "src",
        "kaipu-media://thumb/s2",
      );
      fireEvent.click(cards()[0]);
      expect(screen.getByTestId("add-from-library-shot-preview")).toHaveAttribute(
        "src",
        "kaipu-media://thumb/s1",
      );
    });

    it("keeps the placement and Add beside the image when the screenshot has no thumbnail", () => {
      renderModal({ videos: [shot({ assetId: "bare", title: "Bare", thumbnailUrl: null })] });
      openScreenshots();
      fireEvent.click(cards()[0]);
      expect(screen.queryByTestId("add-from-library-shot-preview")).toBeNull();
      expect(screen.getByTestId("add-destination-button")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add over the video" })).toBeInTheDocument();
    });

    it("a card is a native button that takes focus and a click selects it", () => {
      renderModal({ videos: shots });
      openScreenshots();
      cards()[0].focus();
      expect(cards()[0]).toHaveFocus();
      expect(cards()[0].tagName).toBe("BUTTON");
      fireEvent.click(cards()[0]);
      expect(cards()[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("selects Over the video by default, with every option enabled", () => {
      renderModal({ videos: shots });
      openScreenshots();
      fireEvent.click(cards()[1]);
      expectChosen(OVER);
      openMenu();
      expect(
        screen
          .getAllByRole("menuitemradio")
          .every((option) => !option.hasAttribute("aria-disabled")),
      ).toBe(true);
      expect(
        screen.getByText("Floats at the playhead. The clips do not move."),
      ).toBeInTheDocument();
    });

    it("says an image floats for the floating image's own length, and joins the sequence for 5 s", () => {
      // The playhead (12 s) leaves 18 s of video, so the default 10 s fits.
      renderModal({ videos: shots, playhead: 12 });
      openScreenshots();
      fireEvent.click(cards()[1]);
      expect(sentence()).toBe("Floats over the video from the playhead for 10 s. No clip moves.");
      expect(screen.getByText("New · 10 s")).toBeInTheDocument();
      choose(AFTER);
      expect(sentence()).toBe("Goes after the clip you are on. No clip moves.");
      choose(START);
      expect(sentence()).toBe("Becomes the first thing in the video. All 2 clips move 5 s later.");
    });

    it("Add with Over the video calls the floating callback once and leaves the modal open", () => {
      const props = renderModal({ videos: shots });
      openScreenshots();
      fireEvent.click(cards()[1]);
      add();
      expect(props.onAddScreenshot).toHaveBeenCalledOnce();
      expect(props.onAddScreenshot).toHaveBeenCalledWith(
        expect.objectContaining({ assetId: "s2" }),
      );
      expect(props.onAddScreenshotToSequence).not.toHaveBeenCalled();
      expect(props.onClose).not.toHaveBeenCalled();
      expect(props.onAddRecording).not.toHaveBeenCalled();
    });

    it("a sequence destination calls the sequence callback with that boundary", () => {
      // playhead 12 is inside the second clip (10 to 30)
      const props = renderModal({ videos: shots, playhead: 12 });
      openScreenshots();
      fireEvent.click(cards()[0]);
      const expected: Array<[RegExp, { index: number; time: number }]> = [
        [BEFORE, { index: 1, time: 10 }],
        [AFTER, { index: 2, time: 30 }],
        [START, { index: 0, time: 0 }],
        [END, { index: 2, time: 30 }],
      ];
      for (const [label, boundary] of expected) {
        choose(label);
        add();
        expect(props.onAddScreenshotToSequence).toHaveBeenLastCalledWith(
          expect.objectContaining({ assetId: "s1" }),
          boundary,
        );
      }
      expect(props.onAddScreenshotToSequence).toHaveBeenCalledTimes(4);
      expect(props.onAddScreenshot).not.toHaveBeenCalled();
    });

    it("remembers the destination per kind: a screenshot's choice does not move a recording's", () => {
      const onRememberDestination = vi.fn();
      renderModal({
        videos: [...shots, video({ assetId: "r", title: "Take" })],
        onRememberDestination,
      });
      openScreenshots();
      fireEvent.click(cards()[0]);
      choose(END);
      add();
      expect(onRememberDestination).toHaveBeenCalledWith("screenshot", "end");
      // another screenshot starts at the same place
      fireEvent.click(cards()[1]);
      expectChosen(END);
      // the recording still defaults to after the clip
      fireEvent.click(screen.getByRole("tab", { name: /Recordings/ }));
      expectChosen(AFTER);
    });

    it("starts at the remembered screenshot destination", () => {
      renderModal({
        videos: shots,
        initialTab: "screenshots",
        initialSelectedId: "s1",
        rememberedDestinations: { screenshot: "before-clip" },
      });
      expectChosen(BEFORE);
    });

    it("opens on the tab and selection the Captures panel asks for", () => {
      renderModal({
        videos: [...shots, video({ assetId: "r", title: "Take" })],
        initialTab: "screenshots",
        initialSelectedId: "s2",
      });
      expect(screen.getByRole("tab", { name: /Screenshots/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(cards()[1]).toHaveAttribute("aria-pressed", "true");
      expectChosen(OVER);
    });

    it("opens on Recordings with the first row selected when nothing is asked for", () => {
      renderModal({ videos: [video({ assetId: "r", title: "Take" }), ...shots] });
      expect(screen.getByRole("tab", { name: /Recordings/ })).toHaveAttribute(
        "aria-selected",
        "true",
      );
      expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("selects nothing when the asked-for id is not a listed screenshot", () => {
      renderModal({ videos: shots, initialTab: "screenshots", initialSelectedId: "gone" });
      expect(cards().every((card) => card.getAttribute("aria-pressed") === "false")).toBe(true);
      expect(screen.queryByTestId("add-destination-button")).toBeNull();
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
          onAddScreenshotToSequence={vi.fn()}
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
        onAddScreenshotToSequence: vi.fn(),
        onClose: vi.fn(),
      };
      rerender(<AddFromLibraryModal {...props} loaded />);
      expect(screen.getByText("No screenshots in the Library")).toBeInTheDocument();
      rerender(<AddFromLibraryModal {...props} loaded failed />);
      expect(
        screen.getByText("Couldn't read the Library. It will try again when it changes."),
      ).toBeInTheDocument();
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
