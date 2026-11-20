import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "@shared/audio-settings";
import { SystemAudioSettingsContent } from "./system-audio-settings-content";

function Harness({
  micOn = true,
  audio = DEFAULT_AUDIO_SETTINGS,
  onChange = vi.fn(),
}: {
  micOn?: boolean;
  audio?: AudioSettings;
  onChange?: (patch: Partial<AudioSettings>) => void;
}): React.JSX.Element {
  return <SystemAudioSettingsContent audio={audio} onChange={onChange} micOn={micOn} />;
}

describe("SystemAudioSettingsContent", () => {
  it("has no capture choice: One app is gone, and the card already says All sound", () => {
    render(<Harness />);
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.queryByText(/One app/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not available yet/)).not.toBeInTheDocument();
  });

  it("writes the volume from the slider, 0 to 100", async () => {
    const onChange = vi.fn();
    render(
      <Harness audio={{ ...DEFAULT_AUDIO_SETTINGS, systemAudioVolume: 60 }} onChange={onChange} />,
    );
    const slider = screen.getByRole("slider", { name: "Volume in the recording" });
    expect(slider).toHaveAttribute("aria-valuemax", "100");
    expect(slider).toHaveAttribute("aria-valuetext", "60%");
    slider.focus();
    await userEvent.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith({ systemAudioVolume: 100 });
  });

  it("writes the ducking switch when the microphone is on", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByText("Keeps your voice on top")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("switch", { name: "Lower it while I talk" }));
    expect(onChange).toHaveBeenCalledWith({ duckSystemAudioWhileTalking: true });
  });

  it("disables ducking with its reason while the microphone is off", async () => {
    const onChange = vi.fn();
    render(<Harness micOn={false} onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Lower it while I talk" });
    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByText("Turn on the microphone to use this")).toBeInTheDocument();
    await userEvent.click(toggle);
    expect(onChange).not.toHaveBeenCalled();
  });
});
