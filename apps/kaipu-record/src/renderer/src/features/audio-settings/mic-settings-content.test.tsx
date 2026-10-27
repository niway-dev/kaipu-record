import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DEFAULT_AUDIO_SETTINGS, type AudioSettings } from "@shared/audio-settings";
import type { Microphone } from "@renderer/features/recording/types";
import { MicSettingsContent } from "./mic-settings-content";

const BUILT_IN: Microphone = { deviceId: "a", label: "MacBook Pro Microphone" };
const USB: Microphone = { deviceId: "b", label: "Blue Yeti USB Microphone" };
const AIRPODS: Microphone = { deviceId: "c", label: "AirPods Pro" };

function Harness({
  microphones = [BUILT_IN, USB, AIRPODS],
  initial = BUILT_IN,
  isRecording = false,
  onSelect = vi.fn(),
  onChange = vi.fn(),
  audio = DEFAULT_AUDIO_SETTINGS,
}: {
  microphones?: Microphone[];
  initial?: Microphone | null;
  isRecording?: boolean;
  onSelect?: (mic: Microphone) => void;
  onChange?: (patch: Partial<AudioSettings>) => void;
  audio?: AudioSettings;
}): React.JSX.Element {
  const [selected, setSelected] = useState(initial);
  const firstRef = useRef<HTMLElement | null>(null);
  return (
    <MicSettingsContent
      microphones={microphones}
      selected={selected}
      onSelect={(mic) => {
        onSelect(mic);
        setSelected(mic);
      }}
      audio={audio}
      onChange={onChange}
      isRecording={isRecording}
      levels={Array.from({ length: 14 }, () => 0.5)}
      firstRef={firstRef}
    />
  );
}

describe("MicSettingsContent", () => {
  it("lists the devices as radios with their type, the selected one with the meter", () => {
    render(<Harness />);
    expect(screen.getByRole("radiogroup", { name: "Input" })).toBeInTheDocument();
    const selected = screen.getByRole("radio", { name: /MacBook Pro Microphone/ });
    expect(selected).toHaveAttribute("aria-checked", "true");
    expect(selected).toHaveTextContent("BUILT-IN");
    expect(screen.getByRole("radio", { name: /Blue Yeti/ })).toHaveTextContent("USB");
    expect(screen.getByRole("radio", { name: /AirPods/ })).toHaveTextContent("BLUETOOTH");
    expect(screen.getAllByRole("img", { name: "Input level meter" })).toHaveLength(1);
    expect(selected.querySelectorAll("[style*='height']")).toHaveLength(14);
  });

  it("moves the selection with the arrows, with a roving tab stop", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    const first = screen.getByRole("radio", { name: /MacBook/ });
    expect(first).toHaveAttribute("tabindex", "0");
    expect(screen.getByRole("radio", { name: /Blue Yeti/ })).toHaveAttribute("tabindex", "-1");
    first.focus();
    await userEvent.keyboard("{ArrowDown}");
    expect(onSelect).toHaveBeenLastCalledWith(USB);
    expect(screen.getByRole("radio", { name: /Blue Yeti/ })).toHaveFocus();
    await userEvent.keyboard("{ArrowUp}{ArrowUp}");
    expect(onSelect).toHaveBeenLastCalledWith(AIRPODS);
  });

  it("selects a device by clicking it", async () => {
    const onSelect = vi.fn();
    render(<Harness onSelect={onSelect} />);
    await userEvent.click(screen.getByRole("radio", { name: /AirPods/ }));
    expect(onSelect).toHaveBeenCalledWith(AIRPODS);
  });

  it("shows the level as a slider and writes a change", async () => {
    const onChange = vi.fn();
    render(<Harness audio={{ ...DEFAULT_AUDIO_SETTINGS, micLevel: 70 }} onChange={onChange} />);
    const slider = screen.getByRole("slider", { name: "Input level" });
    expect(slider).toHaveAttribute("aria-valuetext", "70%");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith({ micLevel: 75 });
  });

  it("writes the noise switch", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const toggle = screen.getByRole("switch", { name: "Reduce background noise" });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await userEvent.click(toggle);
    expect(onChange).toHaveBeenCalledWith({ noiseSuppression: false });
  });

  it("has no live badge or note before a take", () => {
    render(<Harness />);
    expect(screen.queryByText("Live")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  describe("during a take", () => {
    it("shows LIVE and the note, and locks the device list", async () => {
      const onSelect = vi.fn();
      render(<Harness isRecording onSelect={onSelect} />);
      expect(screen.getByText("Live")).toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent(
        "Level and noise apply live. Switching the device is locked until you stop.",
      );
      const other = screen.getByRole("radio", { name: /Blue Yeti/ });
      expect(other).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(other);
      expect(onSelect).not.toHaveBeenCalled();
      screen.getByRole("radio", { name: /MacBook/ }).focus();
      await userEvent.keyboard("{ArrowDown}");
      expect(onSelect).not.toHaveBeenCalled();
    });

    it("keeps level and noise editable", async () => {
      const onChange = vi.fn();
      render(<Harness isRecording onChange={onChange} />);
      await userEvent.click(screen.getByRole("switch"));
      expect(onChange).toHaveBeenCalledWith({ noiseSuppression: false });
    });

    it("keeps an unplugged selected device in the list, greyed, as Disconnected", () => {
      render(<Harness isRecording microphones={[USB]} initial={BUILT_IN} />);
      const row = screen.getByRole("radio", { name: /MacBook Pro Microphone/ });
      expect(row).toHaveAttribute("aria-checked", "true");
      expect(row).toHaveAttribute("aria-disabled", "true");
      expect(row).toHaveTextContent("Disconnected");
      expect(screen.queryByRole("img", { name: "Input level meter" })).not.toBeInTheDocument();
    });
  });

  it("says so when there are no devices", () => {
    render(<Harness microphones={[]} initial={null} />);
    expect(screen.getByText("No microphones found")).toBeInTheDocument();
  });
});
