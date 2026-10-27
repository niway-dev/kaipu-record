import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { exclusive } from "@renderer/features/settings-controls/use-settings-disclosure";
import type { Microphone } from "@renderer/features/recording/types";
import {
  MicControlWithPopover,
  MicPanelDrawer,
  MicToggleSplit,
  SystemAudioControlWithPopover,
  SystemAudioPanelDrawer,
  SystemAudioToggleSplit,
  useAudioControl,
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

type MicProps = Omit<ComponentProps<typeof MicControlWithPopover>, "store">;
type SystemProps = Omit<ComponentProps<typeof SystemAudioControlWithPopover>, "store">;

/** A tile with its own store; the shared-store case is `RecordRow` below. */
function MicWithStore(props: MicProps): React.JSX.Element {
  return <MicControlWithPopover store={useAudioSettings()} {...props} />;
}
function SystemWithStore(props: SystemProps): React.JSX.Element {
  return <SystemAudioControlWithPopover store={useAudioSettings()} {...props} />;
}
/** The Record page's shape: both tiles over one store. */
function RecordRow(): React.JSX.Element {
  const store = useAudioSettings();
  return (
    <div>
      <MicControlWithPopover
        store={store}
        on
        onToggle={() => {}}
        isRecording={false}
        {...devices}
      />
      <SystemAudioControlWithPopover store={store} on onToggle={() => {}} micOn />
    </div>
  );
}

const devices = {
  microphones: [BUILT_IN, USB],
  selectedMicrophone: BUILT_IN,
  onSelectMicrophone: () => {},
};

describe("MicControlWithPopover (Record page)", () => {
  it("opens a dialog with focus on the selected device, and Esc returns focus to the chevron", async () => {
    render(<MicWithStore on onToggle={() => {}} isRecording={false} {...devices} />);
    const chevron = screen.getByRole("button", { name: "Microphone settings" });
    await userEvent.click(chevron);

    const dialog = screen.getByRole("dialog", { name: "Microphone settings" });
    expect(chevron).toHaveAttribute("aria-controls", dialog.id);
    expect(screen.getByRole("radio", { name: /MacBook Pro Microphone/ })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(chevron).toHaveFocus();
  });

  it("toggles the mic from the body, not from the chevron", async () => {
    const onToggle = vi.fn();
    render(<MicWithStore on={false} onToggle={onToggle} isRecording={false} {...devices} />);
    await userEvent.click(screen.getByRole("button", { name: /Mic/, pressed: false }));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("chooses a device through the setup's selection", async () => {
    const onSelectMicrophone = vi.fn();
    render(
      <MicWithStore
        on
        onToggle={() => {}}
        isRecording={false}
        {...devices}
        onSelectMicrophone={onSelectMicrophone}
      />,
    );
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
    render(<MicWithStore on onToggle={() => {}} isRecording={false} {...devices} />);
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

  describe("the pre-take meter", () => {
    it("opens the selected device only while the popover is open, and releases it on close", async () => {
      render(<MicWithStore on onToggle={() => {}} isRecording={false} {...devices} />);
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

    it("closes the popover and releases the device when the window loses focus", async () => {
      render(<MicWithStore on onToggle={() => {}} isRecording={false} {...devices} />);
      await userEvent.click(screen.getByRole("button", { name: "Microphone settings" }));
      await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
      act(() => {
        fireEvent.blur(window);
      });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await waitFor(() => expect(track.stop).toHaveBeenCalledOnce());
    });

    it("does not open the device while the mic is off", async () => {
      render(<MicWithStore on={false} onToggle={() => {}} isRecording={false} {...devices} />);
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
      render(<MicWithStore on onToggle={() => {}} isRecording {...devices} />);
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
    render(<RecordRow />);
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

describe("SystemAudioControlWithPopover (Record page)", () => {
  it("opens under the Audio tile and persists the volume", async () => {
    const updateSettings = vi.fn(async () => ({}) as never);
    window.electronAPI.updateSettings = updateSettings;
    render(<SystemWithStore on onToggle={() => {}} micOn />);
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("dialog", { name: "System audio settings" })).toBeInTheDocument();
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
    render(<SystemWithStore on onToggle={() => {}} micOn unavailable />);
    expect(screen.getByTitle("System audio isn't available for this recording")).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "System audio settings" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("disables ducking while the mic is off", async () => {
    render(<SystemWithStore on onToggle={() => {}} micOn={false} />);
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
