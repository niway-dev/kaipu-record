import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ControlBar } from "./control-bar";

const baseTick = {
  elapsedSeconds: 257,
  levels: [0.2, 0.5, 0.8, 0.4, 0.1],
  status: "recording" as const,
};

describe("ControlBar", () => {
  it("names what is recorded: the ratio of an area, else the mode", () => {
    const { rerender } = render(
      <ControlBar
        tick={baseTick}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        modeChip={{ mode: "frame", ratio: "16:9" }}
      />,
    );
    expect(screen.getByTestId("control-bar-mode")).toHaveTextContent("16:9");
    rerender(
      <ControlBar
        tick={baseTick}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        modeChip={{ mode: "screen", ratio: null }}
      />,
    );
    expect(screen.getByTestId("control-bar-mode")).toHaveTextContent("Screen");
  });

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

  it("shows a neutral Starting state while the take acquires: no timer, no pause, Stop usable", () => {
    const onStop = vi.fn();
    render(
      <ControlBar
        tick={{ ...baseTick, status: "starting" }}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={onStop}
        modeChip={{ mode: "screen", ratio: null }}
      />,
    );
    expect(screen.getByText(/starting/i)).toBeInTheDocument();
    expect(screen.queryByText(/saving/i)).not.toBeInTheDocument();
    expect(screen.queryByText("00:04:17")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /pause/i })).not.toBeInTheDocument();
    // Stop cancels the pending start (the recorder's "starting" branch).
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onStop).toHaveBeenCalledOnce();
  });

  it("keeps all three toggles visible and reports their actual state", () => {
    const inputs = {
      microphone: true,
      systemAudio: false,
      camera: false,
      loaded: true,
      onMicrophoneToggle: vi.fn(),
      onSystemAudioToggle: vi.fn(),
      onCameraToggle: vi.fn(),
    };
    const { rerender } = render(
      <ControlBar
        tick={baseTick}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        inputs={inputs}
      />,
    );
    expect(screen.getByRole("button", { name: "Mic" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Audio" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Camera" }));
    expect(inputs.onCameraToggle).toHaveBeenCalledOnce();
    rerender(
      <ControlBar
        tick={{ ...baseTick, status: "paused" }}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        inputs={{ ...inputs, camera: true }}
      />,
    );
    expect(screen.getByRole("button", { name: "Camera" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Mic" }));
    fireEvent.click(screen.getByRole("button", { name: "Audio" }));
    expect(inputs.onMicrophoneToggle).toHaveBeenCalledOnce();
    expect(inputs.onSystemAudioToggle).toHaveBeenCalledOnce();
  });

  it("disables unavailable loopback instead of promising audio it cannot record", () => {
    const onSystemAudioToggle = vi.fn();
    render(
      <ControlBar
        tick={{ ...baseTick, systemAudioAvailable: false }}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onStop={vi.fn()}
        inputs={{
          microphone: true,
          systemAudio: false,
          camera: false,
          loaded: true,
          onMicrophoneToggle: vi.fn(),
          onSystemAudioToggle,
          onCameraToggle: vi.fn(),
        }}
      />,
    );
    const audio = screen.getByRole("button", { name: "Audio" });
    expect(audio).toBeDisabled();
    fireEvent.click(audio);
    expect(onSystemAudioToggle).not.toHaveBeenCalled();
  });

  it("captures only when offered, and removes capture during saving or starting", () => {
    const onScreenshot = vi.fn();
    const props = { onPause: vi.fn(), onResume: vi.fn(), onStop: vi.fn(), onScreenshot };
    const { rerender } = render(<ControlBar tick={baseTick} {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Take screenshot" }));
    expect(onScreenshot).toHaveBeenCalledOnce();
    for (const status of ["starting", "saving"] as const) {
      rerender(<ControlBar tick={{ ...baseTick, status }} {...props} />);
      expect(screen.queryByRole("button", { name: "Take screenshot" })).not.toBeInTheDocument();
    }
  });
});
