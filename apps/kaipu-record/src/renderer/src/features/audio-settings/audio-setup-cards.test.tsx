import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exclusive } from "@renderer/features/settings-controls/use-settings-disclosure";
import type { Microphone } from "@renderer/features/recording/types";
import {
  MicPanelDrawer,
  MicToggleSplit,
  SystemAudioPanelDrawer,
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
      <MicPanelDrawer
        variant="page"
        control={mic}
        on={micOn}
        isRecording={isRecording}
        microphones={[BUILT_IN, YETI]}
        selectedMicrophone={selected}
        onSelectMicrophone={() => {}}
      />
      <SystemAudioPanelDrawer variant="page" control={audio} micOn={micOn} />
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

  it("keeps the unavailable system audio switch disabled and its panel reachable", async () => {
    render(<CardHarness unavailable />);
    expect(screen.getByTitle("System audio isn't available for this recording")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("region", { name: "System audio settings" })).toBeInTheDocument();
  });

  it("opens one panel at a time from the chevrons", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    expect(screen.getByRole("region", { name: "Microphone settings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.queryByRole("region", { name: "Microphone settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System audio settings" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
  });
});

describe("the two-column panels", () => {
  it("microphone: INPUT with the devices, SOUND with the level and the noise switch", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    const panel = screen.getByRole("region", { name: "Microphone settings" });
    expect(within(panel).getByText("Input", { selector: "span" })).toBeInTheDocument();
    expect(within(panel).getByText("Sound")).toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: /Yeti Nano/ })).toBeInTheDocument();
    expect(within(panel).getByRole("slider", { name: "Input level" })).toBeInTheDocument();
    expect(
      within(panel).getByRole("switch", { name: "Reduce background noise" }),
    ).toBeInTheDocument();
  });

  it("microphone, idle: no header, since the setup card already names the microphone", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    const panel = screen.getByRole("region", { name: "Microphone settings" });
    expect(within(panel).queryByText("Microphone")).not.toBeInTheDocument();
    expect(within(panel).queryByText("Live")).not.toBeInTheDocument();
  });

  it("microphone, recording: only the Live tag shows, with no panel title", async () => {
    render(<CardHarness isRecording />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    const panel = screen.getByRole("region", { name: "Microphone settings" });
    expect(within(panel).getByText("Live")).toBeInTheDocument();
    expect(within(panel).queryByText("Microphone")).not.toBeInTheDocument();
  });

  it("system audio: WHAT TO CAPTURE with the choices, MIX with ducking and volume", async () => {
    render(<CardHarness />);
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    const panel = screen.getByRole("region", { name: "System audio settings" });
    expect(within(panel).getByText("What to capture")).toBeInTheDocument();
    expect(within(panel).getByText("Mix")).toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: "All sound" })).toBeInTheDocument();
    expect(within(panel).getByRole("radio", { name: /One app/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(
      within(panel).getByRole("switch", { name: "Lower it while I talk" }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("slider", { name: "Volume in the recording" }),
    ).toBeInTheDocument();
  });
});
