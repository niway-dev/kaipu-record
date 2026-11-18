import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import type { RecordingSettings } from "@shared/types/ipc";
import { STUB_SETTINGS } from "../../test/stub-settings";
import { installSettingsIpc, type SettingsIpc } from "../../test/settings-ipc";
import { useAudioSettings } from "../audio-settings/use-audio-settings";
import { useCameraSettings } from "../camera-settings/use-camera-settings";
import { useRecordingMode } from "../recording/hooks/use-recording-mode";
import { useScreenshotMode } from "../screenshots/use-screenshot-mode";
import {
  useOverlayToggles,
  type RecordingTogglesApi,
} from "../screenshots/overlay/use-overlay-toggles";
import { ShortcutsStep } from "../onboarding/steps/shortcuts-step";
import { useShareUsagePreference } from "../onboarding/use-share-usage-preference";
import { CountdownSettings } from "../../pages/settings/countdown-settings";
import { DiagnosticsSettings } from "../../pages/settings/diagnostics-settings";
import { ScreenshotAfterCaptureSettings } from "../../pages/settings/screenshot-after-capture-settings";
import { BEHAVIOUR_TEST, SETTINGS_CONSUMERS } from "./settings-consumers";

/**
 * Each consumer in the map that says `behaviour: "here"` is shown to follow main's broadcast:
 * the test changes the consumer's key in a fake main process, broadcasts it, and asserts what
 * the consumer returns or renders now. A consumer that stopped following the store (or never
 * did) fails its own case.
 *
 * The map drives this file. A `"here"` entry without a case below fails
 * "has a behaviour case"; a case with no entry fails "has no orphan case". The consumers
 * whose behaviour an existing test already shows point at that test in the map instead, and
 * `settings-consumers.test.ts` checks the file exists and names the key.
 */

const BASE = STUB_SETTINGS as unknown as AppSettings;
const withPatch = (patch: Partial<AppSettings>): AppSettings => ({ ...BASE, ...patch });

beforeAll(() => {
  // The camera hooks list devices; jsdom has no `mediaDevices`.
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: async () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
});

type Case = () => Promise<void>;

/** Starts a fake main holding `initial`; the case broadcasts from it. */
const main = (initial: AppSettings = BASE): SettingsIpc => installSettingsIpc(initial);

const CASES: Record<string, Case> = {
  "features/recording/hooks/use-recording-mode.ts": async () => {
    const ipc = main(withPatch({ recordingMode: "screen" }));
    const { result } = renderHook(() => useRecordingMode(null));
    await waitFor(() => expect(result.current.mode).toBe("screen"));

    act(() =>
      ipc.broadcast(
        withPatch({
          recordingMode: "frame",
          recordingArea: { "1": { x: 10, y: 20, width: 640, height: 360 } },
        }),
      ),
    );

    expect(result.current.mode).toBe("frame");
    expect(result.current.area).toMatchObject({ width: 640, height: 360 });
  },

  "features/screenshots/use-screenshot-mode.ts": async () => {
    const ipc = main(withPatch({ screenshotMode: "frame" }));
    const { result } = renderHook(() => useScreenshotMode());
    await waitFor(() => expect(result.current.mode).toBe("frame"));

    act(() => ipc.broadcast(withPatch({ screenshotMode: "screen" })));

    expect(result.current.mode).toBe("screen");
  },

  "features/audio-settings/use-audio-settings.ts": async () => {
    const ipc = main();
    const { result } = renderHook(() => useAudioSettings());
    await waitFor(() => expect(result.current.audio.micLevel).toBe(100));

    act(() => ipc.broadcast(withPatch({ audio: { ...BASE.audio, micLevel: 40 } })));

    expect(result.current.audio.micLevel).toBe(40);
  },

  "features/camera-settings/use-camera-settings.ts": async () => {
    const ipc = main();
    const { result } = renderHook(() => useCameraSettings());
    await waitFor(() => expect(result.current.bubble.size).toBe(240));

    act(() => ipc.broadcast(withPatch({ cameraBubble: { ...BASE.cameraBubble, size: 320 } })));

    expect(result.current.bubble.size).toBe(320);
  },

  "features/onboarding/steps/shortcuts-step.tsx": async () => {
    const ipc = main();
    render(<ShortcutsStep tried={new Set()} />);
    const keys = (): string | null =>
      document
        .querySelector('[data-shortcut="startRecording"] [aria-label]')
        ?.getAttribute("aria-label") ?? null;
    await waitFor(() => expect(keys()).toBeTruthy());
    const before = keys();

    act(() =>
      ipc.broadcast(
        withPatch({ shortcuts: { ...BASE.shortcuts, startRecording: "Command+Control+G" } }),
      ),
    );

    expect(keys()).not.toBe(before);
    expect(keys()).toContain("G");
  },

  "features/onboarding/use-share-usage-preference.ts": async () => {
    const ipc = main(withPatch({ diagnosticsEnabled: true }));
    const { result } = renderHook(() => useShareUsagePreference());
    await waitFor(() => expect(result.current.enabled).toBe(true));

    act(() => ipc.broadcast(withPatch({ diagnosticsEnabled: false })));

    expect(result.current.enabled).toBe(false);
  },

  // Read once: the overlay window lives for one capture, so it takes the bubble's look when it
  // opens and keeps it.
  "features/screenshots/overlay/use-overlay-toggles.ts": async () => {
    main(withPatch({ cameraBubble: { ...BASE.cameraBubble, size: 333, shape: "square" } }));
    const off = {
      isMicrophoneEnabled: false,
      isSystemAudioEnabled: false,
      isCameraEnabled: false,
    } as RecordingSettings;
    const api = {
      getRecordingSettings: async () => off,
      updateRecordingSettings: vi.fn(),
      onRecordingSettingsChanged: () => () => {},
    } as unknown as RecordingTogglesApi;
    const { result } = renderHook(() => useOverlayToggles(api));

    await waitFor(() => expect(result.current.cameraBubble.size).toBe(333));
    expect(result.current.cameraBubble.shape).toBe("square");
  },

  "pages/settings/countdown-settings.tsx": async () => {
    const ipc = main(withPatch({ recordingCountdownSeconds: 3 }));
    render(<CountdownSettings />);
    await waitFor(() => expect(screen.getByRole("radio", { name: "3 s" })).toBeChecked());

    act(() => ipc.broadcast(withPatch({ recordingCountdownSeconds: 5 })));

    expect(screen.getByRole("radio", { name: "5 s" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "3 s" })).not.toBeChecked();
  },

  "pages/settings/diagnostics-settings.tsx": async () => {
    const ipc = main(withPatch({ diagnosticsEnabled: true }));
    render(<DiagnosticsSettings />);
    const toggle = await screen.findByRole("switch");
    await waitFor(() => expect(toggle).toBeChecked());

    act(() => ipc.broadcast(withPatch({ diagnosticsEnabled: false })));

    expect(toggle).not.toBeChecked();
  },

  "pages/settings/screenshot-after-capture-settings.tsx": async () => {
    const ipc = main(withPatch({ screenshotAfterCapture: "preview" }));
    render(<ScreenshotAfterCaptureSettings />);
    const select = screen.getByRole("combobox", { name: "After capturing" });
    await waitFor(() => expect(select).toHaveTextContent("Show preview"));

    act(() => ipc.broadcast(withPatch({ screenshotAfterCapture: "editor" })));

    expect(select).toHaveTextContent("Open editor");
  },
};

const here = SETTINGS_CONSUMERS.filter((entry) => entry.behaviour === "here");

describe("every settings consumer follows a change of its keys", () => {
  it("the map says where its behaviour test is", () => {
    expect(BEHAVIOUR_TEST).toBe("features/settings/settings-consumers.behaviour.test.tsx");
    expect(here.length).toBeGreaterThan(5);
  });

  it("has a behaviour case for every map entry that says here", () => {
    expect(here.map((entry) => entry.file).filter((file) => !CASES[file])).toEqual([]);
  });

  it("has no orphan case: each case is a map entry that says here", () => {
    const listed = new Set(here.map((entry) => entry.file));
    expect(Object.keys(CASES).filter((file) => !listed.has(file))).toEqual([]);
  });

  it.each(here.map((entry) => entry.file))("%s", async (file) => {
    await CASES[file]!();
  });
});
