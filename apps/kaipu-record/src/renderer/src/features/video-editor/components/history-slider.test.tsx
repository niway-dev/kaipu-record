import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistorySlider } from "./history-slider";

function setup() {
  const handlers = { onBegin: vi.fn(), onLive: vi.fn(), onEnd: vi.fn(), onCommit: vi.fn() };
  render(
    <HistorySlider
      label="Level"
      value={2}
      min={1}
      max={4}
      step={0.1}
      format={(v) => `${v}×`}
      {...handlers}
    />,
  );
  return { handlers, input: screen.getByRole("slider") };
}

describe("HistorySlider", () => {
  it("a pointer gesture is begin → live → end", () => {
    const { handlers, input } = setup();
    fireEvent.pointerDown(input, { pointerId: 1 });
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.pointerUp(input, { pointerId: 1 });
    expect(handlers.onBegin).toHaveBeenCalledTimes(1);
    expect(handlers.onLive).toHaveBeenCalledWith(2.5);
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onCommit).not.toHaveBeenCalled();
  });

  it("a change without a pointer (keyboard) is a commit", () => {
    const { handlers, input } = setup();
    fireEvent.change(input, { target: { value: "2.1" } });
    expect(handlers.onCommit).toHaveBeenCalledWith(2.1);
    expect(handlers.onBegin).not.toHaveBeenCalled();
  });

  it("shows the formatted value", () => {
    setup();
    expect(screen.getByText("2×")).toBeInTheDocument();
  });

  it("names the control with the label alone and describes it with the note", () => {
    render(
      <HistorySlider
        label="Smoothness"
        value={70}
        min={0}
        max={100}
        step={1}
        note="Higher means the camera eases in longer."
        onBegin={vi.fn()}
        onLive={vi.fn()}
        onEnd={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    // The accessible name must not absorb the live value — otherwise every arrow-key
    // step re-announces the control instead of just the new value.
    const input = screen.getByRole("slider", { name: "Smoothness" });
    const note = screen.getByText("Higher means the camera eases in longer.");
    expect(input.getAttribute("aria-describedby")).toBe(note.id);
    expect(note.tagName).toBe("P");
  });
});
