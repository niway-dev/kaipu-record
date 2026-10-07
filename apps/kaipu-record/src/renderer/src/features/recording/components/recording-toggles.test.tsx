import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RecordingToggles } from "./recording-toggles";

const baseProps = {
  isMicrophoneEnabled: true,
  isSystemAudioEnabled: false,
  isCameraEnabled: false,
  onToggleMicrophone: vi.fn(),
  onToggleSystemAudio: vi.fn(),
  onToggleCamera: vi.fn(),
};

describe("RecordingToggles", () => {
  it("shows text labels in the full variant and hides them when compact", () => {
    const { rerender } = render(<RecordingToggles {...baseProps} variant="full" />);
    expect(screen.getByText("Mic")).toBeInTheDocument();
    expect(screen.getByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("Camera")).toBeInTheDocument();

    rerender(<RecordingToggles {...baseProps} variant="compact" />);
    expect(screen.queryByText("Mic")).not.toBeInTheDocument();
  });

  it("fires the matching toggle callback", async () => {
    const onToggleMicrophone = vi.fn();
    render(<RecordingToggles {...baseProps} onToggleMicrophone={onToggleMicrophone} />);
    await userEvent.click(screen.getAllByRole("button")[0]);
    expect(onToggleMicrophone).toHaveBeenCalledOnce();
  });

  it("disables the system-audio toggle with a tooltip when loopback is unavailable", async () => {
    const onToggleSystemAudio = vi.fn();
    render(
      <RecordingToggles
        {...baseProps}
        isSystemAudioUnavailable
        onToggleSystemAudio={onToggleSystemAudio}
      />,
    );
    const audio = screen.getAllByRole("button")[1];
    expect(audio).toBeDisabled();
    expect(audio).toHaveAttribute("title", "System audio isn't available for this recording");
    await userEvent.click(audio);
    expect(onToggleSystemAudio).not.toHaveBeenCalled();
    // The other two stay live.
    expect(screen.getAllByRole("button")[0]).toBeEnabled();
    expect(screen.getAllByRole("button")[2]).toBeEnabled();
  });

  it("keeps system audio enabled by default", () => {
    render(<RecordingToggles {...baseProps} />);
    expect(screen.getAllByRole("button")[1]).toBeEnabled();
    expect(screen.getAllByRole("button")[1]).not.toHaveAttribute("title");
  });
});
