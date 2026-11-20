import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exclusive } from "@renderer/features/settings-controls/use-settings-disclosure";
import type { Microphone } from "@renderer/features/recording/types";
import {
  MicPanelPopover,
  MicToggleSplit,
  SystemAudioPanelPopover,
  SystemAudioToggleSplit,
  useAudioControl,
} from "./audio-controls";
import { useAudioSettings } from "./use-audio-settings";

const BUILT_IN: Microphone = { deviceId: "a", label: "MacBook Pro Microphone" };
const YETI: Microphone = { deviceId: "b", label: "Yeti Nano" };

const originalMedia = navigator.mediaDevices;
beforeEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: undefined, configurable: true });
});
afterEach(() => {
  Object.defineProperty(navigator, "mediaDevices", { value: originalMedia, configurable: true });
});

/** The Capture page's setup row: the two audio cards and their panels, over one store. */
function CardHarness({
  micOn = true,
  audioOn = true,
  isRecording = false,
  unavailable = false,
  selected = YETI as Microphone | null,
  microphones = [BUILT_IN, YETI],
  onToggleMic = () => {},
  onToggleAudio = () => {},
}: {
  micOn?: boolean;
  audioOn?: boolean;
  isRecording?: boolean;
  unavailable?: boolean;
  selected?: Microphone | null;
  microphones?: Microphone[];
  onToggleMic?: () => void;
  onToggleAudio?: () => void;
}): React.JSX.Element {
  const store = useAudioSettings();
  const [mic, audio] = exclusive([useAudioControl(store), useAudioControl(store)]);
  return (
    <div>
      <MicToggleSplit
        card
        control={mic}
        on={micOn}
        onToggle={onToggleMic}
        selectedMicrophone={selected}
        microphones={microphones}
      />
      <SystemAudioToggleSplit
        card
        control={audio}
        on={audioOn}
        onToggle={onToggleAudio}
        unavailable={unavailable}
      />
      <MicPanelPopover
        control={mic}
        on={micOn}
        isRecording={isRecording}
        microphones={[BUILT_IN, YETI]}
        selectedMicrophone={selected}
        onSelectMicrophone={() => {}}
      />
      <SystemAudioPanelPopover control={audio} micOn={micOn} />
    </div>
  );
}

describe("Microphone and System audio cards", () => {
  it("names the selected microphone, or says none was found", () => {
    const { rerender } = render(<CardHarness />);
    expect(screen.getByText("Microphone")).toBeInTheDocument();
    expect(screen.getByText("Yeti Nano")).toBeInTheDocument();
    rerender(<CardHarness selected={null} microphones={[]} />);
    expect(screen.getByText("No microphones found")).toBeInTheDocument();
  });

  it("says none was found, not the saved name, once the last microphone is unplugged", () => {
    render(<CardHarness selected={YETI} microphones={[]} />);
    expect(screen.getByText("No microphones found")).toBeInTheDocument();
    expect(screen.queryByText("Yeti Nano")).not.toBeInTheDocument();
  });

  it("does not say none was found while devices exist but none is selected yet", () => {
    render(<CardHarness selected={null} />);
    expect(screen.queryByText("No microphones found")).not.toBeInTheDocument();
    expect(screen.queryByText("Yeti Nano")).not.toBeInTheDocument();
  });

  it("says All sound for the system audio card", () => {
    render(<CardHarness />);
    expect(screen.getByText("System audio")).toBeInTheDocument();
    expect(screen.getByText("All sound")).toBeInTheDocument();
  });

  it("flips the microphone and the system audio from their own switches", async () => {
    const onToggleMic = vi.fn();
    const onToggleAudio = vi.fn();
    render(
      <CardHarness
        micOn={false}
        audioOn={false}
        onToggleMic={onToggleMic}
        onToggleAudio={onToggleAudio}
      />,
    );
    const mic = screen.getByRole("switch", { name: "Microphone" });
    expect(mic).toHaveAttribute("aria-checked", "false");
    await userEvent.click(mic);
    expect(onToggleMic).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole("switch", { name: "System audio" }));
    expect(onToggleAudio).toHaveBeenCalledOnce();
  });

  it("disables only the left zone of the unavailable system audio card; its panel stays reachable", async () => {
    const reason = "System audio isn't available for this recording";
    render(<CardHarness unavailable />);
    expect(screen.getByRole("switch", { name: "System audio" })).toBeDisabled();
    expect(screen.getByRole("switch", { name: "System audio" })).toHaveAttribute("title", reason);
    const device = screen.getByRole("button", { name: /^System audio settings/ });
    expect(device).toBeEnabled();
    await userEvent.click(device);
    expect(screen.getByRole("dialog", { name: "System audio settings" })).toBeInTheDocument();
  });

  it("opens one panel at a time from the chevrons", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^Microphone settings/ }));
    expect(screen.getByRole("dialog", { name: "Microphone settings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^System audio settings/ }));
    expect(screen.queryByRole("dialog", { name: "Microphone settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("dialog", { name: "System audio settings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^System audio settings/ }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("the popovers", () => {
  it("microphone: the devices, the level and the noise switch, with no section labels", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^Microphone settings/ }));
    const panel = screen.getByRole("dialog", { name: "Microphone settings" });
    expect(within(panel).queryByText("Sound")).not.toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: /Yeti Nano/ })).toBeInTheDocument();
    expect(within(panel).getByRole("slider", { name: "Input level" })).toBeInTheDocument();
    expect(
      within(panel).getByRole("switch", { name: "Reduce background noise" }),
    ).toBeInTheDocument();
  });

  it("microphone, idle: no header, since the setup card already names the microphone", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^Microphone settings/ }));
    const panel = screen.getByRole("dialog", { name: "Microphone settings" });
    expect(within(panel).queryByText("Microphone")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Live")).not.toBeInTheDocument();
  });

  it("microphone, recording: only the Live tag shows, with no panel title", async () => {
    render(<CardHarness isRecording />);
    await userEvent.click(screen.getByRole("button", { name: /^Microphone settings/ }));
    const panel = screen.getByRole("dialog", { name: "Microphone settings" });
    expect(within(panel).getByText("Live")).toBeInTheDocument();
    expect(within(panel).queryByText("Microphone")).not.toBeInTheDocument();
  });

  it("system audio: ducking and volume, and no One app option", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: /^System audio settings/ }));
    const panel = screen.getByRole("dialog", { name: "System audio settings" });
    expect(within(panel).queryByText("What to capture")).not.toBeInTheDocument();
    expect(within(panel).queryByRole("radio")).not.toBeInTheDocument();
    expect(within(panel).queryByText(/One app/)).not.toBeInTheDocument();
    expect(
      within(panel).getByRole("switch", { name: "Lower it while I talk" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("slider", { name: "Volume in the recording" }),
    ).toBeInTheDocument();
  });
});
