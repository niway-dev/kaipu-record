import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { CaptureModeButtons } from "./capture-mode-buttons";

const shortcuts = {
  startRecording: "⌃⌘C",
  stopRecording: "⌃⌘S",
  bringToFront: "⌃⌘O",
  captureScreenshot: "⌃⌘X",
  captureScreen: "⌃⇧⌘X",
  captureFrame: "⌃⇧⌘F",
  toggleMicrophone: "⌃⌘M",
  toggleSystemAudio: "⌃⌘A",
  toggleCamera: "⌃⌘K",
};

const realApi = window.electronAPI;
// `platform` is readonly on the bridge type; the stub in test/setup.ts is a plain object.
const setPlatform = (platform: string): void => {
  (window.electronAPI as { platform: string }).platform = platform;
};

afterEach(() => {
  window.electronAPI = realApi;
  setPlatform("darwin");
  vi.restoreAllMocks();
});

/** Main serves `modes` and has `current` stored; returns the settings writer spy. */
function given(modes: CaptureMode[], current: CaptureMode = "area") {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    shortcuts: defaultShortcutsFor("darwin"),
    screenshotMode: current,
  };
  const updateSettings = vi.fn(async (patch: Partial<AppSettings>) => {
    settings = { ...settings, ...patch };
    return settings;
  });
  window.electronAPI = {
    ...realApi,
    screenshotSupportedModes: async () => modes,
    getSettings: async () => settings,
    updateSettings,
  };
  return updateSettings;
}

const ALL: CaptureMode[] = ["area", "screen", "frame"];

describe("CaptureModeButtons — page hero", () => {
  it("captures with the current mode from the primary button, showing the generic shortcut", async () => {
    given(ALL, "frame");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    const primary = await screen.findByRole("button", { name: /^Capture · Frame/ });
    expect(primary).toHaveTextContent("⌃⌘X");
    expect(screen.getByRole("button", { name: /^Frame/ })).toHaveTextContent("Current");
    fireEvent.click(primary);
    expect(onCapture).toHaveBeenCalledWith("frame");
  });

  it("a card click only selects its mode; the primary button then captures with it", async () => {
    const updateSettings = given(ALL, "area");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByRole("button", { name: /^Capture · Area/ });
    const card = screen.getByRole("button", { name: /^Screen/ });
    expect(card).toHaveTextContent("⌃⇧⌘X");
    expect(card).toHaveTextContent("Use Screen");
    expect(screen.getByText("Pick a mode. Capture with the button or ⌃⌘X.")).toBeInTheDocument();
    fireEvent.click(card);
    expect(updateSettings).toHaveBeenCalledWith({ screenshotMode: "screen" });
    expect(onCapture).not.toHaveBeenCalled();
    const primary = await screen.findByRole("button", { name: /^Capture · Screen/ });
    expect(primary).toBeEnabled();
    fireEvent.click(primary);
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith("screen");
  });

  it("keyboard activation of a card (Enter, Space) behaves like a click", async () => {
    const updateSettings = given(ALL, "area");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByRole("button", { name: /^Capture · Area/ });
    // A native button turns Enter/Space into a click; user-event does the same.
    const user = userEvent.setup();
    const card = screen.getByRole("button", { name: /^Frame/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(updateSettings).toHaveBeenLastCalledWith({ screenshotMode: "frame" });
    const screenCard = screen.getByRole("button", { name: /^Screen/ });
    screenCard.focus();
    await user.keyboard(" ");
    expect(updateSettings).toHaveBeenLastCalledWith({ screenshotMode: "screen" });
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("a disabled card neither changes the mode nor captures, and says why", async () => {
    const updateSettings = given(["area", "screen"], "area");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    const frame = screen.getByRole("button", { name: /^Frame/ });
    await waitFor(() => expect(frame).toBeDisabled());
    expect(frame).toHaveTextContent("Not available on this platform");
    expect(frame).not.toHaveTextContent("⌃⇧⌘F");
    fireEvent.click(frame);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("falls back to Area when the current mode is unavailable, and says so", async () => {
    setPlatform("win32");
    given(["area", "screen"], "frame");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    const primary = await screen.findByRole("button", { name: /^Capture · Area/ });
    expect(
      screen.getByText("Frame isn’t available on Windows yet, so Capture uses Area."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Frame/ })).toHaveTextContent("Coming to Windows");
    fireEvent.click(primary);
    expect(onCapture).toHaveBeenCalledWith("area");
  });

  it("pauses everything during a recording and offers to stop it", async () => {
    given(ALL, "area");
    const onCapture = vi.fn();
    const onStopRecording = vi.fn();
    render(
      <CaptureModeButtons
        variant="page"
        onCapture={onCapture}
        shortcuts={shortcuts}
        recording={{ elapsedSeconds: 134 }}
        onStopRecording={onStopRecording}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recording in progress · 00:02:14. Screenshots are paused until you stop.",
    );
    expect(screen.getByText("Capture is off while you record.")).toBeInTheDocument();
    // The hook the recording dim (opacity, no pointer events) is styled on.
    expect(screen.getByRole("status").closest("section")).toHaveAttribute("data-busy", "true");
    for (const name of [/^Capture · Area/, /^Area/, /^Screen/, /^Frame/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStopRecording).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("disables every mode when main cannot be asked", async () => {
    window.electronAPI = {
      ...realApi,
      screenshotSupportedModes: async () => {
        throw new Error("no bridge");
      },
    };
    render(<CaptureModeButtons variant="page" onCapture={vi.fn()} shortcuts={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Area/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /^Capture · Area/ })).toBeDisabled();
  });
});

describe("CaptureModeButtons — tray panel", () => {
  it("shows the current-mode button, three rows and the hint", async () => {
    given(ALL, "frame");
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={shortcuts} />);
    expect(await screen.findByRole("button", { name: /^Capture · Frame/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Screen/ })).toHaveTextContent("⌃⇧⌘X");
    // The generic shortcut belongs to the current mode; Area has none of its own.
    expect(screen.getByRole("button", { name: /^Frame/ })).toHaveTextContent("⌃⌘X");
    expect(screen.getByRole("button", { name: /^Area/ })).not.toHaveTextContent("⌘");
    expect(screen.getByLabelText("Current")).toBeInTheDocument();
    expect(screen.getByText("Click a mode to make it your default.")).toBeInTheDocument();
  });

  it("a row click only selects its mode and does not capture", async () => {
    const updateSettings = given(ALL, "area");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="panel" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByRole("button", { name: /^Capture · Area/ });
    fireEvent.click(screen.getByRole("button", { name: /^Frame/ }));
    expect(updateSettings).toHaveBeenCalledWith({ screenshotMode: "frame" });
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Capture · Frame/ }));
    expect(onCapture).toHaveBeenCalledWith("frame");
  });

  it("says Coming to Windows on a Windows machine", async () => {
    setPlatform("win32");
    given([]);
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={shortcuts} />);
    const area = screen.getByRole("button", { name: /^Area/ });
    await waitFor(() => expect(area).toBeDisabled());
    expect(area).toHaveTextContent("Coming to Windows");
  });

  it("shows the compact recording banner and greys the button", () => {
    given(ALL);
    render(
      <CaptureModeButtons
        variant="panel"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
        recording={{ elapsedSeconds: 134 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recording · 00:02:14 — screenshots paused",
    );
    expect(screen.getByRole("button", { name: /^Capture · Area/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Screen/ })).toBeDisabled();
  });
});
