import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlBar } from "./control-bar";

const baseTick = {
  elapsedSeconds: 257,
  levels: [0.2, 0.5, 0.8, 0.4, 0.1],
  status: "recording" as const,
};

describe("ControlBar", () => {
  it("renders the mono timer from elapsed seconds", () => {
    render(<ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={vi.fn()} />);
    expect(screen.getByText("00:04:17")).toBeInTheDocument();
  });

  it("shows pause while recording and resume + Paused while paused", () => {
    const { rerender } = render(
      <ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={vi.fn()} />,
    );
    expect(screen.getByRole("button", { name: /pause/i })).toBeInTheDocument();
    rerender(
      <ControlBar
        tick={{ ...baseTick, status: "paused" }}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /resume/i })).toBeInTheDocument();
    expect(screen.getByText(/paused/i)).toBeInTheDocument();
  });

  it("fires the stop handler", async () => {
    const onStop = vi.fn();
    render(<ControlBar tick={baseTick} onPause={vi.fn()} onResume={vi.fn()} onStop={onStop} />);
    screen.getByRole("button", { name: /stop/i }).click();
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("shows a Saving state with no controls while finalizing", () => {
    render(
      <ControlBar
        tick={{ ...baseTick, status: "saving" }}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
      />,
    );
    expect(screen.getByText(/saving/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /stop/i })).not.toBeInTheDocument();
  });
});
