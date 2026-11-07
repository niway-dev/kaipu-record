import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { toLayout } from "../timeline";
import { availableTracks, type TrackKey } from "../tracks";
import type { TrackItem } from "../scene";
import { TransportBar, type TransportBarProps } from "./transport-bar";

// 0–10 s and 20–25 s of source, laid out as two entries: 0–10 and 10–15 (15 s total).
const ITEMS: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 10 },
  { id: "b", kind: "clip", sourceStart: 20, sourceEnd: 25 },
];

function barProps(overrides: Partial<TransportBarProps> = {}): TransportBarProps {
  return {
    layout: toLayout(ITEMS),
    playing: false,
    muted: false,
    speed: 1,
    timelineTime: 9,
    duration: 29,
    isFullscreen: false,
    zoomCount: null,
    privacyCount: 0,
    tracks: {
      available: availableTracks({ hasCursorTrack: true, hasWebcam: false }),
      hidden: [],
      onToggle: vi.fn(),
    },
    onTogglePlay: vi.fn(),
    onToggleMute: vi.fn(),
    onSpeedChange: vi.fn(),
    onSeek: vi.fn(),
    onSplit: vi.fn(),
    splitDisabled: false,
    onDeleteSelected: vi.fn(),
    deleteDisabled: false,
    onToggleFullscreen: vi.fn(),
    ...overrides,
  };
}

function renderBar(overrides: Partial<TransportBarProps> = {}): TransportBarProps {
  const props = barProps(overrides);
  render(<TransportBar {...props} />);
  return props;
}

/** Every control in DOM order, by accessible name. */
function controlNames(): string[] {
  return screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent!);
}

describe("TransportBar — layout", () => {
  it("lists the controls left to right: Tracks, rewind, play, forward, split, delete, mute, speed, fullscreen", () => {
    renderBar();
    expect(controlNames()).toEqual([
      "Tracks, 6 of 6 shown",
      "Rewind",
      "Play",
      "Forward",
      "Split here",
      "Delete segment",
      "Mute",
      "Playback speed 1×",
      "Fullscreen",
    ]);
  });

  it("shows the time with tenths of a second", () => {
    renderBar({ timelineTime: 9, duration: 29 });
    expect(screen.getByText("0:09.0 / 0:29.0")).toBeInTheDocument();
  });

  it("puts the time between forward and split", () => {
    renderBar();
    const forward = screen.getByRole("button", { name: "Forward" });
    const time = screen.getByText("0:09.0 / 0:29.0");
    const split = screen.getByRole("button", { name: "Split here" });
    expect(forward.compareDocumentPosition(time) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(time.compareDocumentPosition(split) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("carries the transport UI area on its root", () => {
    renderBar();
    expect(document.querySelector("[data-ui-area='editorVideo.transport']")).not.toBeNull();
  });

  it("keeps the three-column 1fr auto 1fr grid so play stays centred", () => {
    const css = readFileSync(resolve(__dirname, "transport-bar.module.css"), "utf8");
    expect(css).toMatch(/grid-template-columns:\s*1fr auto 1fr/);
  });

  it("hangs the time off the centre column, so play (not the play + time group) is what is centred", () => {
    const css = readFileSync(resolve(__dirname, "transport-bar.module.css"), "utf8");
    const rule = css.match(/\.timeDisplay\s*\{[^}]*\}/)![0];
    expect(rule).toMatch(/position:\s*absolute/);
  });
});

/** The Tracks trigger, whatever count it shows. */
const trigger = (): HTMLElement => screen.getByRole("button", { name: /^Tracks/ });

function tracksProps(hidden: TrackKey[], input = { hasCursorTrack: true, hasWebcam: false }) {
  return { available: availableTracks(input), hidden, onToggle: vi.fn() };
}

describe("TransportBar — Tracks trigger", () => {
  it("reads Tracks n/m: 6/6 for a take with a cursor track and no camera", () => {
    renderBar();
    expect(trigger()).toHaveTextContent("Tracks 6/6");
    expect(trigger()).toBeEnabled();
  });

  it("reads 5/5 without a cursor track", () => {
    renderBar({ tracks: tracksProps([], { hasCursorTrack: false, hasWebcam: false }) });
    expect(trigger()).toHaveTextContent("Tracks 5/5");
  });

  it("reads 4/6 with two lanes hidden", () => {
    renderBar({ tracks: tracksProps(["annotations", "privacy"]) });
    expect(trigger()).toHaveTextContent("Tracks 4/6");
    expect(trigger()).toHaveAccessibleName("Tracks, 4 of 6 shown");
  });

  it("reads 4/6, not 5/6, when only Zooms is hidden: its Cursor activity marks go with it", () => {
    renderBar({ tracks: tracksProps(["zooms"]) });
    expect(trigger()).toHaveTextContent("Tracks 4/6");
    expect(trigger()).toHaveAccessibleName("Tracks, 4 of 6 shown");
  });

  it("opens Show tracks on click and closes on a second click", () => {
    renderBar();
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger());
    expect(screen.getByRole("menu", { name: "Show tracks" })).toBeInTheDocument();
    expect(trigger()).toHaveAttribute("aria-expanded", "true");
    expect(trigger()).toHaveAttribute("aria-haspopup", "menu");
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("hands a toggle to the page and keeps the panel open", () => {
    const props = renderBar();
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("menuitemcheckbox", { name: "Zooms" }));
    expect(props.tracks.onToggle).toHaveBeenCalledWith("zooms");
    expect(screen.getByRole("menu")).toBeInTheDocument();
  });

  it("closes on Escape and returns focus to the trigger", () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.keyDown(screen.getByRole("menu"), { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveFocus();
  });

  it("closes on a click outside", () => {
    renderBar();
    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  // Only the stage <main> goes fullscreen, and the popover is portaled to <body>: in
  // fullscreen the panel would be invisible while focus sat inside it (NIW2-665 review).
  it("disables the trigger in fullscreen: the timeline footer is not drawn there", () => {
    renderBar({ isFullscreen: true });
    expect(trigger()).toBeDisabled();
    fireEvent.click(trigger());
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes an open panel when fullscreen starts", () => {
    const props = barProps();
    const { rerender } = render(<TransportBar {...props} />);
    fireEvent.click(trigger());
    expect(screen.getByRole("menu")).toBeInTheDocument();
    rerender(<TransportBar {...props} isFullscreen />);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(trigger()).toHaveAttribute("aria-expanded", "false");
    // Leaving fullscreen does not bring the panel back by itself.
    rerender(<TransportBar {...props} isFullscreen={false} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("TransportBar — left cluster", () => {
  it("sits in the left cluster with the zoom and privacy counts", () => {
    renderBar({ zoomCount: 4, privacyCount: 2 });
    const left = trigger().parentElement!;
    expect(within(left).getByText("4 zooms detected")).toBeInTheDocument();
    expect(within(left).getByText("2 private regions")).toBeInTheDocument();
  });

  it("carries a short form for a narrow bar, with the full sentence as tooltip and the short one hidden from screen readers", () => {
    renderBar({ zoomCount: 4, privacyCount: 2 });
    const zoom = screen.getByText("4 zooms detected").parentElement!;
    expect(zoom).toHaveAttribute("title", "4 zooms detected");
    expect(within(zoom).getByText("4 zooms")).toHaveAttribute("aria-hidden", "true");
    const privacy = screen.getByText("2 private regions").parentElement!;
    expect(privacy).toHaveAttribute("title", "2 private regions");
    expect(within(privacy).getByText("2 regions")).toHaveAttribute("aria-hidden", "true");
  });

  it("hides the counts when there is nothing to count", () => {
    renderBar({ zoomCount: null, privacyCount: 0 });
    expect(screen.queryByText(/zoom.* detected/)).toBeNull();
    expect(screen.queryByText(/private region/)).toBeNull();
  });

  it("shows a zero zoom count when the recording can have zooms", () => {
    renderBar({ zoomCount: 0 });
    expect(screen.getByText("0 zooms detected")).toBeInTheDocument();
  });
});

describe("TransportBar — play, mute, fullscreen", () => {
  it("play/pause label follows the state and fires onTogglePlay", () => {
    const props = renderBar({ playing: true });
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(props.onTogglePlay).toHaveBeenCalledOnce();
  });

  it("mute label follows the state and fires onToggleMute", () => {
    const props = renderBar({ muted: true });
    fireEvent.click(screen.getByRole("button", { name: "Unmute" }));
    expect(props.onToggleMute).toHaveBeenCalledOnce();
  });

  it("fullscreen label follows the state and fires onToggleFullscreen", () => {
    const props = renderBar({ isFullscreen: true });
    fireEvent.click(screen.getByRole("button", { name: "Exit fullscreen" }));
    expect(props.onToggleFullscreen).toHaveBeenCalledOnce();
  });
});

describe("TransportBar — playback speed", () => {
  const speedButton = (): HTMLElement => screen.getByRole("button", { name: /^Playback speed/ });

  it("sits right after mute, in the right cluster", () => {
    renderBar();
    const mute = screen.getByRole("button", { name: "Mute" });
    expect(mute.nextElementSibling).toBe(speedButton());
    expect(speedButton().parentElement).toBe(mute.parentElement);
  });

  it.each([
    [1, "1×"],
    [1.5, "1.5×"],
    [2, "2×"],
    [0.5, "0.5×"],
  ])("shows %s as %s", (speed, label) => {
    renderBar({ speed });
    expect(speedButton()).toHaveTextContent(label);
    expect(speedButton()).toHaveAccessibleName(`Playback speed ${label}`);
  });

  it.each([
    [1, 1.5],
    [1.5, 2],
    [2, 0.5],
    [0.5, 1],
  ])("from %s a click asks for %s", (speed, next) => {
    const props = renderBar({ speed });
    fireEvent.click(speedButton());
    expect(props.onSpeedChange).toHaveBeenCalledExactlyOnceWith(next);
  });

  it("names the next speed in its tooltip", () => {
    renderBar({ speed: 2 });
    expect(speedButton()).toHaveAttribute("title", "Playback speed: click for 0.5×");
  });

  it("stays enabled while the playhead is on a slide or the bar is playing", () => {
    renderBar({ playing: true, splitDisabled: true });
    expect(speedButton()).toBeEnabled();
  });
});

describe("TransportBar — split and delete (moved from the title bar)", () => {
  it("fire their callbacks", () => {
    const props = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Split here" }));
    expect(props.onSplit).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Delete segment" }));
    expect(props.onDeleteSelected).toHaveBeenCalledOnce();
  });

  it("keep their disabled states, and a disabled button fires nothing", () => {
    const props = renderBar({ splitDisabled: true, deleteDisabled: true });
    const split = screen.getByRole("button", { name: "Split here" });
    const del = screen.getByRole("button", { name: "Delete segment" });
    expect(split).toBeDisabled();
    expect(del).toBeDisabled();
    fireEvent.click(split);
    fireEvent.click(del);
    expect(props.onSplit).not.toHaveBeenCalled();
    expect(props.onDeleteSelected).not.toHaveBeenCalled();
  });

  it("keep their shortcut hints in the tooltip", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Split here" })).toHaveAttribute(
      "title",
      "Split here (S)",
    );
    expect(screen.getByRole("button", { name: "Delete segment" })).toHaveAttribute(
      "title",
      "Delete segment (⌫)",
    );
  });

  it("print the Windows key name for delete when the bridge reports win32", () => {
    const api = window.electronAPI as { platform: string };
    const original = api.platform;
    api.platform = "win32";
    try {
      renderBar();
      expect(screen.getByRole("button", { name: "Delete segment" })).toHaveAttribute(
        "title",
        "Delete segment (Del)",
      );
    } finally {
      api.platform = original;
    }
  });
});

describe("TransportBar — rewind and forward", () => {
  it("skip 5 s", () => {
    const props = renderBar({ timelineTime: 9 });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(14);
    fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(4);
  });

  it("clamp to the ends of the timeline", () => {
    const props = renderBar({ timelineTime: 2 });
    fireEvent.click(screen.getByRole("button", { name: "Rewind" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(0);
    fireEvent.click(screen.getByRole("button", { name: "Forward" }));
    expect(props.onSeek).toHaveBeenLastCalledWith(7);
  });

  it("with Shift, jump to the next and the previous cut", () => {
    // Cuts are at 0, 10 and 15 (the end).
    const props = renderBar({ timelineTime: 4 });
    fireEvent.click(screen.getByRole("button", { name: "Forward" }), { shiftKey: true });
    expect(props.onSeek).toHaveBeenLastCalledWith(10);
    fireEvent.click(screen.getByRole("button", { name: "Rewind" }), { shiftKey: true });
    expect(props.onSeek).toHaveBeenLastCalledWith(0);
  });

  it("explain Shift in their tooltips", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Rewind" }).getAttribute("title")).toMatch(/Shift/);
    expect(screen.getByRole("button", { name: "Forward" }).getAttribute("title")).toMatch(/Shift/);
  });
});
