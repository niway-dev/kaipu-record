import { useRef } from "react";
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
  const firstRef = useRef<HTMLElement | null>(null);
  return (
    <SystemAudioSettingsContent
      audio={audio}
      onChange={onChange}
      micOn={micOn}
      firstRef={firstRef}
    />
  );
}

describe("SystemAudioSettingsContent", () => {
  it("captures All sound, and One app is disabled with its reason", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "What to capture" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All sound" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    const oneApp = screen.getByRole("radio", { name: "One app, Not available yet" });
    expect(oneApp).toHaveAttribute("aria-disabled", "true");
    expect(oneApp).toHaveAttribute("title", "Not available yet");
    expect(screen.getByText(/Not available yet/, { selector: "p" })).toBeInTheDocument();
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
