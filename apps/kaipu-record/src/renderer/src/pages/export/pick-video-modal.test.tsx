import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { uiArea } from "@renderer/lib/ui-area";
import { PickVideoModal, usePickVideoModal, type PickVideoModalProps } from "./pick-video-modal";

function video(over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: `id-${over.assetId}`,
    kind: "recording",
    title: `Title ${over.assetId}`,
    createdAt: Date.UTC(2026, 10, 5, 12, 0),
    durationSeconds: 20,
    fileSizeBytes: 3_600_000,
    derivedFromAssetId: null,
    thumbnailUrl: null,
    capture: { width: 1920, height: 1080 } as never,
    ...over,
  } as LibraryVideo;
}

// illustrative Library: two originals, a copy of the older one and a screenshot
const LIBRARY = [
  video({ assetId: "old", title: "Older take", createdAt: Date.UTC(2026, 9, 1, 12) }),
  video({
    assetId: "new",
    title: "Newer take",
    createdAt: Date.UTC(2026, 10, 5, 12),
    durationSeconds: 62,
  }),
  video({ assetId: "copy", title: "Older take (for sharing)", derivedFromAssetId: "old" }),
  video({ assetId: "shot", kind: "screenshot", title: "A screenshot" }),
];

beforeEach(() => {
  // jsdom implements no media playback.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(over: Partial<Pick<PickVideoModalProps, "videos" | "currentAssetId">> = {}) {
  const props = {
    videos: LIBRARY,
    area: uiArea("exportNew.pickVideoModal"),
    onPick: vi.fn<(video: LibraryVideo) => void>(),
    onClose: vi.fn<() => void>(),
    ...over,
  };
  render(<PickVideoModal {...props} />);
  return props;
}

const rows = (): HTMLElement[] => screen.queryAllByTestId("pick-video-row");
const titles = (): (string | null)[] => rows().map((r) => r.getAttribute("aria-label"));

describe("PickVideoModal", () => {
  it("is a dialog titled Pick a video to export, marked as the screen's area", () => {
    open();
    expect(screen.getByRole("alertdialog", { name: "Pick a video to export" })).toBeInTheDocument();
    expect(document.querySelector('[data-ui-area="exportNew.pickVideoModal"]')).toBeInTheDocument();
  });

  describe("the list", () => {
    it("shows the originals, newest first: no copies and no screenshots", () => {
      open();
      expect(titles()).toEqual(["Newer take", "Older take"]);
    });

    it("a row says duration, size and resolution", () => {
      open();
      expect(rows()[0]).toHaveTextContent("1:02 · 3.6 MB · 1920 × 1080");
    });

    it("selects the first row on open", () => {
      open();
      expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("with a current video: it starts selected and its row says Exporting now", () => {
      open({ currentAssetId: "old" });
      expect(rows()[1]).toHaveAttribute("aria-pressed", "true");
      expect(rows()[1]).toHaveTextContent("Exporting now");
      expect(rows()[0]).not.toHaveTextContent("Exporting now");
    });

    it("without a current video no row says Exporting now", () => {
      open();
      expect(screen.queryByText("Exporting now")).toBeNull();
    });
  });

  describe("the preview", () => {
    it("plays the selected video muted, and another row swaps it", () => {
      open();
      const el = screen.getByTestId("pick-video-video") as HTMLVideoElement;
      expect(el.muted).toBe(true);
      expect(el.getAttribute("src")).toMatch(/^kaipu-media:\/\/recording\/id-new/);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
      fireEvent.click(rows()[1]);
      expect(el.getAttribute("src")).toMatch(/^kaipu-media:\/\/recording\/id-old/);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    });

    it("has play/pause and scrub, and the time as 0:00 / total", () => {
      open();
      const el = screen.getByTestId("pick-video-video") as HTMLVideoElement;
      fireEvent.play(el);
      expect(screen.getByRole("button", { name: "Pause preview" })).toBeInTheDocument();
      fireEvent.change(screen.getByRole("slider", { name: "Seek the preview" }), {
        target: { value: "12" },
      });
      expect(el.currentTime).toBe(12);
      expect(screen.getByTestId("pick-video-time")).toHaveTextContent("0:12 / 1:02");
    });

    it("lists recorded date, size and resolution under it", () => {
      open();
      const facts = within(screen.getByTestId("pick-video-facts"));
      expect(facts.getByText("Recorded")).toBeInTheDocument();
      expect(facts.getByText(/Nov [456], 2026/)).toBeInTheDocument();
      expect(facts.getByText("Size").nextSibling).toHaveTextContent("3.6 MB");
      expect(facts.getByText("Resolution").nextSibling).toHaveTextContent("1920 × 1080");
    });

    it("leaves the resolution out when it is unknown", () => {
      open({ videos: [video({ assetId: "a", capture: null })] });
      expect(within(screen.getByTestId("pick-video-facts")).queryByText("Resolution")).toBeNull();
    });

    it("closing pauses the video and clears its src", () => {
      const { onClose } = open();
      const el = screen.getByTestId("pick-video-video") as HTMLVideoElement;
      cleanup();
      expect(onClose).not.toHaveBeenCalled();
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
      expect(el.hasAttribute("src")).toBe(false);
    });
  });

  describe("choosing and closing", () => {
    it("Export this video picks the selected row", () => {
      const { onPick, onClose } = open();
      fireEvent.click(rows()[1]);
      fireEvent.click(screen.getByRole("button", { name: "Export this video" }));
      expect(onPick).toHaveBeenCalledOnce();
      expect(onPick.mock.calls[0][0]).toMatchObject({ assetId: "old" });
      expect(onClose).not.toHaveBeenCalled();
    });

    it("Export this video picks the first row when nothing was clicked", () => {
      const { onPick } = open();
      fireEvent.click(screen.getByRole("button", { name: "Export this video" }));
      expect(onPick.mock.calls[0][0]).toMatchObject({ assetId: "new" });
    });

    it("a double click on a row picks that row", () => {
      const { onPick } = open();
      fireEvent.doubleClick(rows()[1]);
      expect(onPick).toHaveBeenCalledOnce();
      expect(onPick.mock.calls[0][0]).toMatchObject({ assetId: "old" });
    });

    it("Escape, Cancel and ✕ close without picking", () => {
      const { onPick, onClose } = open();
      fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
      expect(onClose).toHaveBeenCalledTimes(1);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onClose).toHaveBeenCalledTimes(2);
      fireEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(onClose).toHaveBeenCalledTimes(3);
      expect(onPick).not.toHaveBeenCalled();
    });

    it("with nothing to pick, Export this video is disabled", () => {
      open({ videos: [] });
      expect(screen.getByRole("button", { name: "Export this video" })).toBeDisabled();
    });
  });

  describe("search", () => {
    const type = (value: string): void => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search recordings" }), {
        target: { value },
      });
    };

    it("filters by title", () => {
      open();
      type("older");
      expect(titles()).toEqual(["Older take"]);
    });

    it("a title that matches nothing says so, apart from an empty Library", () => {
      open();
      type("zzz");
      expect(screen.getByRole("status")).toHaveTextContent("No recordings match “zzz”");
    });

    it("an empty Library says there are no recordings yet", () => {
      open({ videos: [LIBRARY[2], LIBRARY[3]] });
      expect(screen.getByRole("status")).toHaveTextContent("No recordings in your Library yet.");
    });

    it("searching moves the selection to the first match and the preview follows", () => {
      open({ currentAssetId: "old" });
      type("newer");
      expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
      expect(screen.getByTestId("pick-video-video").getAttribute("src")).toMatch(/id-new/);
    });
  });
});

describe("usePickVideoModal", () => {
  function Host({ onPick }: { onPick(v: LibraryVideo): void }): React.JSX.Element {
    const picker = usePickVideoModal({
      videos: LIBRARY,
      area: uiArea("export.pickVideoModal"),
      onPick,
    });
    return (
      <>
        <button type="button" onClick={picker.onOpen}>
          Open
        </button>
        {picker.modal}
      </>
    );
  }

  it("opens on the trigger, and Escape closes it and returns focus to the trigger", () => {
    render(<Host onPick={vi.fn()} />);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    const trigger = screen.getByRole("button", { name: "Open" });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it("picking closes it and hands over the video", () => {
    const onPick = vi.fn();
    render(<Host onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    fireEvent.click(screen.getByRole("button", { name: "Export this video" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(onPick.mock.calls[0][0]).toMatchObject({ assetId: "new" });
  });
});
