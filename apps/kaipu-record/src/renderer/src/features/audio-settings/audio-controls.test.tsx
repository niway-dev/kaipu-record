import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exclusive } from "@renderer/features/settings-controls/use-settings-disclosure";
import type { Microphone } from "@renderer/features/recording/types";
import {
  MicPanelDrawer,
  MicToggleSplit,
  SystemAudioPanelDrawer,
  SystemAudioToggleSplit,
  useAudioControl,
  type MicDevices,
} from "./audio-controls";
import { useAudioSettings } from "./use-audio-settings";

const BUILT_IN: Microphone = { deviceId: "a", label: "MacBook Pro Microphone" };
const USB: Microphone = { deviceId: "b", label: "Blue Yeti USB Microphone" };

const original = { ...window.electronAPI };
const track = { stop: vi.fn() };
const getUserMedia = vi.fn(async (_constraints: MediaStreamConstraints) => {
  return { getTracks: () => [track] } as unknown as MediaStream;
});
const originalMedia = navigator.mediaDevices;

class FakeAudioContext {
  createAnalyser = () => ({
    fftSize: 0,
    getByteTimeDomainData: (data: Uint8Array) => data.fill(128),
  });
  createMediaStreamSource = () => ({ connect: vi.fn() });
  close = async () => {};
}

beforeEach(() => {
  track.stop.mockClear();
  getUserMedia.mockClear();
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("AudioContext", FakeAudioContext);
});

afterEach(() => {
  Object.assign(window.electronAPI, original);
  Object.defineProperty(navigator, "mediaDevices", { value: originalMedia, configurable: true });
  vi.unstubAllGlobals();
});

/** The Record page's shape: both tiles and their wide drawers over one store. */
function PageHarness({
  micOn = true,
  isRecording = false,
  unavailable = false,
  onToggle = () => {},
  mics = devices,
}: {
  micOn?: boolean;
  isRecording?: boolean;
  unavailable?: boolean;
  onToggle?: () => void;
  mics?: MicDevices;
}): React.JSX.Element {
  const store = useAudioSettings();
  const [mic, audio] = exclusive([useAudioControl(store), useAudioControl(store)]);
  return (
    <div>
      <MicToggleSplit control={mic} on={micOn} onToggle={onToggle} />
      <SystemAudioToggleSplit control={audio} on onToggle={() => {}} unavailable={unavailable} />
      <MicPanelDrawer variant="page" control={mic} on={micOn} isRecording={isRecording} {...mics} />
      <SystemAudioPanelDrawer variant="page" control={audio} micOn={micOn} />
    </div>
  );
}

const devices = {
  microphones: [BUILT_IN, USB],
  selectedMicrophone: BUILT_IN,
  onSelectMicrophone: () => {},
};

describe("Mic drawer (Record page, page variant)", () => {
  it("opens a drawer with focus on the selected device, and Esc returns focus to the chevron", async () => {
    render(<PageHarness />);
    const chevron = screen.getByRole("button", { name: "Microphone settings" });
    await userEvent.click(chevron);

    const drawer = screen.getByRole("region", { name: "Microphone settings" });
    expect(chevron).toHaveAttribute("aria-controls", drawer.id);
    expect(screen.getByRole("radio", { name: /MacBook Pro Microphone/ })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
  });

  it("lays out in two columns in the page variant and stays single-column in the panel", async () => {
    const { unmount } = render(<PageHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    expect(
      screen.getByRole("region", { name: "Microphone settings" }).querySelector("[data-columns]"),
    ).not.toBeNull();
    unmount();
    render(<PanelHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    expect(
      screen.getByRole("region", { name: "Microphone settings" }).querySelector("[data-columns]"),
    ).toBeNull();
  });

  it("toggles the mic from the body, not from the chevron", async () => {
    const onToggle = vi.fn();
    render(<PageHarness micOn={false} onToggle={onToggle} />);
    await userEvent.click(screen.getByRole("button", { name: /Mic/, pressed: false }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("chooses a device through the setup's selection", async () => {
    const onSelectMicrophone = vi.fn();
    render(<PageHarness mics={{ ...devices, onSelectMicrophone }} />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    await userEvent.click(screen.getByRole("radio", { name: /Blue Yeti/ }));
    expect(onSelectMicrophone).toHaveBeenCalledWith(USB);
  });

  it("persists the whole audio object, spreading the saved value", async () => {
    const saved = await original.getSettings();
    window.electronAPI.getSettings = async () => ({
      ...saved,
      audio: {
        micLevel: 100,
        noiseSuppression: false,
        systemAudioVolume: 40,
        duckSystemAudioWhileTalking: true,
      },
    });
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<PageHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    await waitFor(() =>
      expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false"),
    );
    screen.getByRole("slider").focus();
    await userEvent.keyboard("{ArrowRight}");
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        audio: {
          micLevel: 105,
          noiseSuppression: false,
          systemAudioVolume: 40,
          duckSystemAudioWhileTalking: true,
        },
      }),
    );
  });

  it("with no microphones, focus still moves into the drawer and Esc closes it", async () => {
    render(
      <PageHarness
        mics={{ microphones: [], selectedMicrophone: null, onSelectMicrophone: () => {} }}
      />,
    );
    const chevron = screen.getByRole("button", { name: "Microphone settings" });
    await userEvent.click(chevron);
    expect(screen.getByRole("radiogroup", { name: "Input" })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
  });

  describe("the pre-take meter", () => {
    it("opens the selected device only while the drawer is open, and releases it on close", async () => {
      render(<PageHarness />);
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getUserMedia).not.toHaveBeenCalled();

      await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
      await waitFor(() =>
        expect(getUserMedia).toHaveBeenCalledWith({
          audio: { deviceId: { exact: "a" }, noiseSuppression: true },
        }),
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    });

    it("closes the drawer and releases the device when the window loses focus", async () => {
      render(<PageHarness />);
      await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
      act(() => {
        fireEvent.blur(window);
      });
      expect(screen.queryByRole("region")).not.toBeInTheDocument();
      await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    });

    it("does not open the device while the mic is off", async () => {
      render(<PageHarness micOn={false} />);
      await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(getUserMedia).not.toHaveBeenCalled();
    });

    it("reads the engine's bars during a take instead of opening the device again", async () => {
      const unsubscribe = vi.fn();
      let push: (levels: number[]) => void = () => {};
      window.electronAPI.subscribeMicLevels = (callback) => {
        push = callback;
        return unsubscribe;
      };
      render(<PageHarness isRecording />);
      await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
      act(() => push([1, 1, 1, 1, 1]));
      const meter = screen.getByRole("img", { name: "Input level meter" });
      await waitFor(() => expect(meter.querySelector("span")).toHaveStyle({ height: "100%" }));
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(screen.getByText("Live")).toBeInTheDocument();
      // Closed, the meter is gone and so is the subscription.
      await userEvent.keyboard("{Escape}");
      expect(unsubscribe).toHaveBeenCalled();
    });
  });
});

describe("one audio store per window", () => {
  it("a Mic change and an Audio change in the same window both reach the saved object", async () => {
    const updateSettings = vi.fn(async (_patch: unknown) => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<PageHarness />);
    await new Promise((resolve) => setTimeout(resolve, 0));

    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    const micSlider = screen.getByRole("slider");
    micSlider.focus();
    fireEvent.keyDown(micSlider, { key: "ArrowRight" });
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    const volume = screen.getByRole("slider");
    volume.focus();
    fireEvent.keyDown(volume, { key: "ArrowLeft" });

    await waitFor(() =>
      expect(updateSettings).toHaveBeenLastCalledWith({
        audio: expect.objectContaining({ micLevel: 105, systemAudioVolume: 95 }),
      }),
    );
  });
});

describe("Audio drawer (Record page, page variant)", () => {
  it("opens under the Audio tile and persists the volume", async () => {
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<PageHarness />);
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("region", { name: "System audio settings" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "All sound" })).toHaveFocus();
    // Let the saved value land before the change, as a person would.
    await new Promise((resolve) => setTimeout(resolve, 0));
    screen.getByRole("slider").focus();
    fireEvent.keyDown(screen.getByRole("slider"), { key: "ArrowLeft" });
    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({
        audio: expect.objectContaining({ systemAudioVolume: 95 }),
      }),
    );
  });

  it("keeps the unavailable tile disabled but its settings reachable", async () => {
    render(<PageHarness unavailable />);
    expect(screen.getByTitle("System audio isn't available for this recording")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("region")).toBeInTheDocument();
  });

  it("disables ducking while the mic is off", async () => {
    render(<PageHarness micOn={false} />);
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("switch")).toHaveAttribute("aria-disabled", "true");
  });
});

function PanelHarness(): React.JSX.Element {
  const store = useAudioSettings();
  const [mic, audio] = exclusive([useAudioControl(store), useAudioControl(store)]);
  return (
    <div>
      <MicToggleSplit compact control={mic} on onToggle={() => {}} />
      <SystemAudioToggleSplit compact control={audio} on onToggle={() => {}} />
      <MicPanelDrawer control={mic} on isRecording={false} {...devices} />
      <SystemAudioPanelDrawer control={audio} micOn />
    </div>
  );
}

describe("drawers (capture panel)", () => {
  it("expands inline and closes on Esc with focus back on the chevron", async () => {
    render(<PanelHarness />);
    const chevron = screen.getByRole("button", { name: "Microphone settings" });
    await userEvent.click(chevron);
    expect(screen.getByRole("region", { name: "Microphone settings" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /MacBook/ })).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("region")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
  });

  it("keeps one drawer open at a time", async () => {
    render(<PanelHarness />);
    await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.queryByRole("region", { name: "Microphone settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("region", { name: "System audio settings" })).toBeInTheDocument();
  });
});
