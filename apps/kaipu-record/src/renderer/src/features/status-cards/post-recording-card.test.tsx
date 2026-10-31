import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PostRecordingCard } from "./post-recording-card";

function renderCard(overrides: Partial<Parameters<typeof PostRecordingCard>[0]> = {}) {
  const props = {
    durationSeconds: 182,
    dimensions: { width: 1916, height: 1048 },
    sizeBytes: 119_000_000,
    onPick: vi.fn(),
    onEditFirst: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<PostRecordingCard {...props} />);
  return props;
}

describe("PostRecordingCard (NIW2-584)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("says the video is ready, with its numbers, the master tag and the question", () => {
    renderCard();
    expect(screen.getByRole("region", { name: "Your video is ready" })).toBeVisible();
    expect(screen.getByText("3:02 · 1916 × 1048 · 119 MB")).toBeVisible();
    expect(screen.getByText("Master · full quality")).toBeVisible();
    expect(
      screen.getByText("Where do you want to send it? We'll shape a copy for that place."),
    ).toBeVisible();
    expect(
      screen.getByText("Saved at full quality · you can always come back to this"),
    ).toBeVisible();
  });

  it("leaves the dimensions out until the file is read", () => {
    renderCard({ dimensions: null });
    expect(screen.getByText("3:02 · 119 MB")).toBeVisible();
  });

  it("each chip picks its destination; More places picks none", () => {
    const props = renderCard();
    const picks: Array<[string, string | null]> = [
      ["Prepare a copy for YouTube", "youtube"],
      ["Prepare a copy for TikTok", "vertical"],
      ["Prepare a copy for GitHub", "github"],
      ["More places", null],
    ];
    for (const [name, destination] of picks) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(props.onPick).toHaveBeenLastCalledWith(destination);
    }
    expect(props.onPick).toHaveBeenCalledTimes(picks.length);
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("Edit first edits; ✕ closes the card; no Open in the app, which is already on the recording", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Edit first" }));
    expect(props.onEditFirst).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Open" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("Open opens the recording when the card floats outside the app", () => {
    const onOpen = vi.fn();
    const props = renderCard({ onOpen });
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledOnce();
    expect(props.onDismiss).not.toHaveBeenCalled();
  });

  it("no Edit first when the recording cannot open in the editor", () => {
    renderCard({ onEditFirst: undefined, onOpen: vi.fn() });
    expect(screen.queryByRole("button", { name: "Edit first" })).toBeNull();
    expect(screen.getByRole("button", { name: "Open" })).toBeVisible();
  });

  it("never hides itself: it waits for the user", () => {
    vi.useFakeTimers();
    const props = renderCard();
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(props.onDismiss).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Your video is ready" })).toBeVisible();
  });
});
