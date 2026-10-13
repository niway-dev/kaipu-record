import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RECORDING_SAVED_CARD_MS, RecordingSavedCard } from "./recording-saved-card";

function renderCard(overrides: Partial<Parameters<typeof RecordingSavedCard>[0]> = {}) {
  const props = {
    durationSeconds: 78,
    sizeBytes: 119_000_000,
    dimensions: { width: 2560, height: 1440 },
    githubEstimateBytes: 9_200_000,
    onShare: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<RecordingSavedCard {...props} />);
  return props;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("RecordingSavedCard", () => {
  it("offers a light copy with the GitHub estimate on the before/after bar", () => {
    renderCard();
    expect(screen.getByText("Recording saved")).toBeInTheDocument();
    expect(screen.getByText("1:18 · 2560×1440 · 119 MB")).toBeInTheDocument();
    expect(screen.getByText("~9.2 MB for GitHub")).toBeInTheDocument();
    expect(screen.getByText(/a copy that's 92% lighter/)).toBeInTheDocument();
  });

  it("words it without numbers until the file is read", () => {
    renderCard({ githubEstimateBytes: null, dimensions: null });
    expect(screen.getByText("1:18 · 119 MB")).toBeInTheDocument();
    expect(screen.getByText(/a lighter copy for GitHub/)).toBeInTheDocument();
  });

  it("Share a light copy opens Share (and closes the card)", () => {
    const props = renderCard();
    fireEvent.click(screen.getByRole("button", { name: "Share a light copy" }));
    expect(props.onShare).toHaveBeenCalledOnce();
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("hides itself after 8 s, but not while the pointer is on it", () => {
    const props = renderCard();
    const card = screen.getByRole("region", { name: "Recording saved" });
    fireEvent.mouseEnter(card);
    act(() => vi.advanceTimersByTime(RECORDING_SAVED_CARD_MS * 2));
    expect(props.onDismiss).not.toHaveBeenCalled();
    fireEvent.mouseLeave(card);
    act(() => vi.advanceTimersByTime(RECORDING_SAVED_CARD_MS));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });
});
