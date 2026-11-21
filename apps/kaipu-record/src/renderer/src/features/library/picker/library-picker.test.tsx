import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "../types";
import { LibraryPicker } from "./index";

function video(over: Partial<LibraryVideo> & { assetId: string }): LibraryVideo {
  return {
    id: `id-${over.assetId}`,
    kind: "recording",
    title: `Title ${over.assetId}`,
    createdAt: 1,
    durationSeconds: 20,
    fileSizeBytes: 1_000_000,
    thumbnailUrl: null,
    ...over,
  } as LibraryVideo;
}

const ITEMS = [
  video({ assetId: "a", title: "Alpha" }),
  video({ assetId: "b", title: "Beta" }),
  video({ assetId: "c", title: "Gamma" }),
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

const rows = (): HTMLElement[] => screen.queryAllByTestId("library-picker-row");

describe("LibraryPicker", () => {
  describe("outside the root", () => {
    it("every part throws a clear error", () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      for (const part of [
        <LibraryPicker.Search key="s" placeholder="Search" />,
        <LibraryPicker.List key="l" label="List" />,
        <LibraryPicker.Preview key="p" />,
        <LibraryPicker.Body key="b" />,
        <LibraryPicker.Close key="c" label="Close" onClick={() => {}} />,
      ]) {
        expect(() => render(part)).toThrow(/must be rendered inside <LibraryPicker>/);
        cleanup();
      }
    });
  });

  describe("the list", () => {
    it("renders one row per item with its title, and the first one is selected", () => {
      render(
        <LibraryPicker items={ITEMS}>
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(screen.getByRole("list", { name: "Recordings" })).toBeInTheDocument();
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Alpha", "Beta", "Gamma"]);
      expect(rows().map((r) => r.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
    });

    it("a click selects, and a double click activates", () => {
      const onActivate = vi.fn();
      render(
        <LibraryPicker items={ITEMS} onActivate={onActivate}>
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      fireEvent.click(rows()[1]);
      expect(rows()[1]).toHaveAttribute("aria-pressed", "true");
      expect(rows()[0]).toHaveAttribute("aria-pressed", "false");
      expect(onActivate).not.toHaveBeenCalled();
      fireEvent.doubleClick(rows()[2]);
      expect(onActivate).toHaveBeenCalledWith(ITEMS[2]);
    });

    it("renderRow replaces the default row, and Row takes meta and a badge", () => {
      render(
        <LibraryPicker items={ITEMS}>
          <LibraryPicker.Body>
            <LibraryPicker.List
              label="Recordings"
              renderRow={(item, { selected }) => (
                <LibraryPicker.Row
                  item={item}
                  meta={`${item.durationSeconds} s${selected ? " (picked)" : ""}`}
                  badge={item.assetId === "b" ? "Now" : undefined}
                />
              )}
            />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows()[0]).toHaveTextContent("20 s (picked)");
      expect(rows()[1]).toHaveTextContent("Now");
      expect(rows()[1]).toHaveAccessibleName("Beta, Now");
    });

    it("a row without a thumbnail shows a placeholder, with one shows the image", () => {
      render(
        <LibraryPicker
          items={[video({ assetId: "a", thumbnailUrl: "kaipu-media://thumb/a" }), ITEMS[1]]}
        >
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows()[0].querySelector("img")).toHaveAttribute("src", "kaipu-media://thumb/a");
      expect(screen.getAllByTestId("library-picker-placeholder")).toHaveLength(1);
    });
  });

  describe("selection", () => {
    it("is controlled when selectedId is given: a click asks, the caller decides", () => {
      const onSelectedIdChange = vi.fn();
      const { rerender } = render(
        <LibraryPicker items={ITEMS} selectedId="b" onSelectedIdChange={onSelectedIdChange}>
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows()[1]).toHaveAttribute("aria-pressed", "true");
      fireEvent.click(rows()[2]);
      expect(onSelectedIdChange).toHaveBeenCalledWith("c");
      expect(rows()[1]).toHaveAttribute("aria-pressed", "true");
      rerender(
        <LibraryPicker items={ITEMS} selectedId="c" onSelectedIdChange={onSelectedIdChange}>
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows()[2]).toHaveAttribute("aria-pressed", "true");
    });

    it("defaultSelectedId starts the uncontrolled state", () => {
      render(
        <LibraryPicker items={ITEMS} defaultSelectedId="c">
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows()[2]).toHaveAttribute("aria-pressed", "true");
    });

    it("a selection that is gone or filtered out falls back to the first row", () => {
      render(
        <LibraryPicker items={ITEMS} defaultSelectedId="missing">
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows()[0]).toHaveAttribute("aria-pressed", "true");
    });

    it("with autoSelectFirst off nothing is selected until one is picked", () => {
      render(
        <LibraryPicker items={ITEMS} autoSelectFirst={false}>
          <LibraryPicker.Body>
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(rows().every((r) => r.getAttribute("aria-pressed") === "false")).toBe(true);
    });
  });

  describe("search", () => {
    const tree = (props: Partial<React.ComponentProps<typeof LibraryPicker>> = {}) => (
      <LibraryPicker items={ITEMS} {...props}>
        <LibraryPicker.Header title="Pick" titleId="t">
          <LibraryPicker.Search placeholder="Search recordings" />
        </LibraryPicker.Header>
        <LibraryPicker.Body
          empty={<LibraryPicker.Note>Nothing here.</LibraryPicker.Note>}
          noMatch={(query) => (
            <LibraryPicker.Note title={`No match for “${query}”`} hint="Try again" />
          )}
        >
          <LibraryPicker.List label="Recordings" />
        </LibraryPicker.Body>
      </LibraryPicker>
    );
    const type = (value: string): void => {
      fireEvent.change(screen.getByRole("searchbox", { name: "Search recordings" }), {
        target: { value },
      });
    };

    it("filters by title, ignoring case and surrounding spaces", () => {
      render(tree());
      type("  ALP ");
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Alpha"]);
    });

    it("a query that matches nothing shows the no-match note, with the query", () => {
      render(tree());
      type("zzz");
      expect(rows()).toHaveLength(0);
      expect(screen.getByRole("status")).toHaveTextContent("No match for “zzz”");
      expect(screen.getByRole("status")).toHaveTextContent("Try again");
    });

    it("no items at all shows the empty note, not the no-match one", () => {
      render(tree({ items: [] }));
      expect(screen.getByRole("status")).toHaveTextContent("Nothing here.");
    });

    it("loading wins over both notes", () => {
      render(
        <LibraryPicker items={[]} loading>
          <LibraryPicker.Body
            loading={<LibraryPicker.Note>Loading…</LibraryPicker.Note>}
            empty={<LibraryPicker.Note>Nothing here.</LibraryPicker.Note>}
          >
            <LibraryPicker.List label="Recordings" />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(screen.getByRole("status")).toHaveTextContent("Loading…");
    });

    it("the query can be controlled", () => {
      const onQueryChange = vi.fn();
      render(tree({ query: "bet", onQueryChange }));
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Beta"]);
      type("gam");
      expect(onQueryChange).toHaveBeenCalledWith("gam");
      // The caller decides the query: typing alone does not change the list.
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Beta"]);
    });

    it("a custom filter replaces the title match", () => {
      render(tree({ filter: (item, query) => item.assetId === query }));
      type("c");
      expect(rows().map((r) => r.getAttribute("aria-label"))).toEqual(["Gamma"]);
    });
  });

  describe("the preview", () => {
    const tree = (
      items: LibraryVideo[] = [
        video({ assetId: "a", id: "newest-id" }),
        video({ assetId: "b", id: "older-id" }),
      ],
    ) => (
      <LibraryPicker items={items}>
        <LibraryPicker.Body>
          <LibraryPicker.List label="Recordings" />
          <LibraryPicker.Preview>
            {(item) => <p data-testid="facts">{item.title}</p>}
          </LibraryPicker.Preview>
        </LibraryPicker.Body>
      </LibraryPicker>
    );
    const videoEl = (): HTMLVideoElement => screen.getByTestId("library-picker-video");

    it("plays the selected recording muted from the Library's media URL", () => {
      render(tree());
      expect(videoEl().muted).toBe(true);
      expect(videoEl().getAttribute("src")).toMatch(/^kaipu-media:\/\/recording\/newest-id/);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledOnce();
    });

    it("is one element: choosing another row swaps its src", () => {
      render(tree());
      const before = videoEl();
      fireEvent.click(rows()[1]);
      expect(document.querySelectorAll("video")).toHaveLength(1);
      expect(videoEl()).toBe(before);
      expect(before.getAttribute("src")).toMatch(/^kaipu-media:\/\/recording\/older-id/);
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    });

    it("pauses and clears src on unmount", () => {
      const { unmount } = render(tree());
      const el = videoEl();
      unmount();
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
      expect(el.hasAttribute("src")).toBe(false);
    });

    it("children can be a function of the selected item", () => {
      render(tree());
      expect(screen.getByTestId("facts")).toHaveTextContent("Title a");
      fireEvent.click(rows()[1]);
      expect(screen.getByTestId("facts")).toHaveTextContent("Title b");
    });

    it("has a play/pause button that follows the element", () => {
      render(tree());
      fireEvent.play(videoEl());
      expect(screen.getByRole("button", { name: "Pause preview" })).toBeInTheDocument();
      Object.defineProperty(videoEl(), "paused", { value: false, configurable: true });
      fireEvent.click(screen.getByRole("button", { name: "Pause preview" }));
      expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
      fireEvent.pause(videoEl());
      expect(screen.getByRole("button", { name: "Play preview" })).toBeInTheDocument();
    });

    it("a scrub bar seeks the element", () => {
      render(tree());
      fireEvent.change(screen.getByRole("slider", { name: "Seek the preview" }), {
        target: { value: "7" },
      });
      expect(videoEl().currentTime).toBe(7);
    });

    it("an unplayable file shows a message and disables the controls", () => {
      render(tree());
      fireEvent.error(videoEl());
      expect(screen.getByTestId("library-picker-unavailable")).toHaveTextContent(
        "This recording can't be played.",
      );
      expect(screen.getByRole("button", { name: "Play preview" })).toBeDisabled();
    });

    it("showTime adds the elapsed and total time", () => {
      render(
        <LibraryPicker items={[video({ assetId: "a", durationSeconds: 20 })]}>
          <LibraryPicker.Body>
            <LibraryPicker.Preview showTime />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(screen.getByTestId("library-picker-time")).toHaveTextContent("0:00 / 0:20");
    });

    it("renders nothing with nothing selected", () => {
      render(
        <LibraryPicker items={ITEMS} autoSelectFirst={false}>
          <LibraryPicker.Body>
            <LibraryPicker.Preview />
          </LibraryPicker.Body>
        </LibraryPicker>,
      );
      expect(document.querySelector("video")).toBeNull();
    });
  });

  describe("the chrome", () => {
    it("Header titles the sheet, Close and Footer take the caller's content", () => {
      const onClose = vi.fn();
      render(
        <LibraryPicker items={ITEMS} data-testid="sheet">
          <LibraryPicker.Header title="Pick a video" titleId="pick-title">
            <LibraryPicker.Close label="Close picker" onClick={onClose} />
          </LibraryPicker.Header>
          <LibraryPicker.Footer>
            <button type="button">Go</button>
          </LibraryPicker.Footer>
        </LibraryPicker>,
      );
      expect(screen.getByText("Pick a video")).toHaveAttribute("id", "pick-title");
      fireEvent.click(screen.getByRole("button", { name: "Close picker" }));
      expect(onClose).toHaveBeenCalledOnce();
      expect(screen.getByRole("button", { name: "Go" })).toBeInTheDocument();
      expect(screen.getByTestId("sheet")).toBeInTheDocument();
    });
  });
});
