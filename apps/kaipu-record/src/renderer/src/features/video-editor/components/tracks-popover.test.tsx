import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { availableTracks, type TrackKey } from "../tracks";
import { TracksPopover } from "./tracks-popover";

function setup(
  input: { hasCursorTrack?: boolean; hasWebcam?: boolean; hidden?: TrackKey[] } = {},
): { onToggle: ReturnType<typeof vi.fn>; onClose: ReturnType<typeof vi.fn>; anchor: HTMLElement } {
  const anchor = document.createElement("button");
  document.body.appendChild(anchor);
  const onToggle = vi.fn();
  const onClose = vi.fn();
  render(
    <TracksPopover
      anchor={anchor}
      available={availableTracks({
        hasCursorTrack: input.hasCursorTrack ?? true,
        hasWebcam: input.hasWebcam ?? false,
      })}
      hidden={input.hidden ?? []}
      onToggle={onToggle}
      onClose={onClose}
    />,
  );
  return { onToggle, onClose, anchor };
}

const row = (name: string): HTMLElement => screen.getByRole("menuitemcheckbox", { name });
const rowNames = (): string[] =>
  screen.getAllByRole("menuitemcheckbox").map((r) => r.textContent ?? "");

describe("TracksPopover — rows", () => {
  it("is a menu named Show tracks, with the declared UI area", () => {
    setup();
    const menu = screen.getByRole("menu", { name: "Show tracks" });
    expect(menu.getAttribute("data-ui-area")).toBe("editorVideo.tracksPopover");
  });

  it("lists, for a take with a cursor track and no camera, six rows with Cursor activity under Zooms", () => {
    setup();
    expect(rowNames()).toEqual([
      "ClipsAlways",
      "Annotations",
      "Zooms",
      "Cursor activity",
      "Privacy",
      "Audio",
    ]);
  });

  it("leaves Cursor activity out without a cursor track, and Webcam out without a camera", () => {
    setup({ hasCursorTrack: false });
    expect(rowNames()).toEqual(["ClipsAlways", "Annotations", "Zooms", "Privacy", "Audio"]);
  });

  it("lists Webcam when the take has a camera", () => {
    setup({ hasWebcam: true });
    expect(rowNames()).toContain("Webcam");
  });

  it("shows Clips checked and disabled, and every other row as the setting says", () => {
    setup({ hidden: ["privacy"] });
    expect(row("ClipsAlways").getAttribute("aria-checked")).toBe("true");
    expect(row("ClipsAlways").getAttribute("aria-disabled")).toBe("true");
    expect(row("Privacy").getAttribute("aria-checked")).toBe("false");
    expect(row("Audio").getAttribute("aria-checked")).toBe("true");
    expect(row("Audio").getAttribute("aria-disabled")).toBeNull();
  });

  it("says that hidden tracks keep their edits", () => {
    setup();
    expect(
      screen.getByText("Hidden tracks keep their edits; they only leave the timeline."),
    ).toBeInTheDocument();
  });
});

describe("TracksPopover — toggling", () => {
  it("toggles a lane and stays open, so several can be changed in a row", () => {
    const { onToggle, onClose } = setup();
    fireEvent.click(row("Zooms"));
    fireEvent.click(row("Audio"));
    expect(onToggle.mock.calls).toEqual([["zooms"], ["audio"]]);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("never toggles Clips", () => {
    const { onToggle } = setup();
    fireEvent.click(row("ClipsAlways"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("disables Cursor activity, without changing it, while Zooms is hidden", () => {
    const { onToggle } = setup({ hidden: ["zooms"] });
    const child = row("Cursor activity");
    expect(child.getAttribute("aria-disabled")).toBe("true");
    // Its stored choice (shown) is what the checkbox keeps showing.
    expect(child.getAttribute("aria-checked")).toBe("true");
    fireEvent.click(child);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("lets Cursor activity be toggled while Zooms is shown", () => {
    const { onToggle } = setup({ hidden: ["activity"] });
    expect(row("Cursor activity").getAttribute("aria-checked")).toBe("false");
    fireEvent.click(row("Cursor activity"));
    expect(onToggle).toHaveBeenCalledWith("activity");
  });
});

describe("TracksPopover — position", () => {
  it("re-measures the trigger when a toggle moves it (the footer changes height with the lanes)", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    let top = 600;
    anchor.getBoundingClientRect = () => ({ left: 40, top }) as DOMRect;
    const props = {
      anchor,
      available: availableTracks({ hasCursorTrack: true, hasWebcam: false }),
      onToggle: vi.fn(),
      onClose: vi.fn(),
    };
    const { rerender } = render(<TracksPopover {...props} hidden={[]} />);
    const menu = screen.getByRole("menu");
    // jsdom has no layout: the panel is 0 px tall, so it sits 8 px above the trigger.
    expect(menu.style.top).toBe("592px");
    // Hiding a lane shortens the footer: the transport, and the trigger, move down 18 px.
    top = 618;
    rerender(<TracksPopover {...props} hidden={["zooms"]} />);
    expect(menu.style.top).toBe("610px");
  });
});

describe("TracksPopover — keyboard and dismissal", () => {
  it("focuses the first row that can be toggled when it opens", () => {
    setup();
    expect(row("Annotations")).toHaveFocus();
  });

  it("moves with the arrow keys and wraps", () => {
    setup();
    const menu = screen.getByRole("menu");
    fireEvent.keyDown(menu, { key: "ArrowDown" });
    expect(row("Zooms")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(row("ClipsAlways")).toHaveFocus();
    fireEvent.keyDown(menu, { key: "ArrowUp" });
    expect(row("Audio")).toHaveFocus();
  });

  it("toggles the focused row with Space and Enter", () => {
    const { onToggle } = setup();
    fireEvent.keyDown(screen.getByRole("menu"), { key: " " });
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Enter" });
    expect(onToggle.mock.calls).toEqual([["annotations"], ["annotations"]]);
  });

  it("keeps Delete and Backspace to itself: the page would delete the selected clip, zoom or redaction", () => {
    setup();
    const reachedPage = vi.fn();
    window.addEventListener("keydown", reachedPage);
    for (const key of ["Delete", "Backspace"]) {
      fireEvent.keyDown(screen.getByRole("menu"), { key });
    }
    window.removeEventListener("keydown", reachedPage);
    expect(reachedPage).not.toHaveBeenCalled();
  });

  it("closes on Escape and gives focus back to the trigger", () => {
    const { onClose, anchor } = setup();
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(anchor).toHaveFocus();
  });

  it("closes on a pointer-down outside, but not on the trigger or inside", () => {
    const { onClose, anchor } = setup();
    fireEvent.pointerDown(anchor);
    fireEvent.pointerDown(screen.getByRole("menu"));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
