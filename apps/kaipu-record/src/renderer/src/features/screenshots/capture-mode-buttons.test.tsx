import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { CaptureModeButtons } from "./capture-mode-buttons";

const shortcuts = {
  startRecording: "⌃⌘C",
  stopRecording: "⌃⌘S",
  bringToFront: "⌃⌘O",
  captureScreenshot: "⌃⌘X",
  captureScreen: "⌃⇧⌘X",
  captureFrame: "⌃⇧⌘F",
  captureWindow: "⌃⌘W",
  toggleMicrophone: "⌃⌘M",
  toggleSystemAudio: "⌃⌘A",
  toggleCamera: "⌃⌘K",
};

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
  vi.restoreAllMocks();
});

/** Main serves `modes` and has `current` stored; returns the settings writer spy. */
function given(modes: CaptureMode[], current: CaptureMode = "frame") {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, screenshotMode: current };
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

const ALL: CaptureMode[] = ["frame", "window", "screen"];

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
    const updateSettings = given(ALL, "frame");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByRole("button", { name: /^Capture · Frame/ });
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
    const updateSettings = given(ALL, "screen");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByRole("button", { name: /^Capture · Screen/ });
    // A native button turns Enter/Space into a click; user-event does the same.
    const user = userEvent.setup();
    const card = screen.getByRole("button", { name: /^Frame/ });
    card.focus();
    await user.keyboard("{Enter}");
    expect(updateSettings).toHaveBeenLastCalledWith({ screenshotMode: "frame" });
    const windowCard = screen.getByRole("button", { name: /^Window/ });
    windowCard.focus();
    await user.keyboard(" ");
    expect(updateSettings).toHaveBeenLastCalledWith({ screenshotMode: "window" });
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("a disabled card neither changes the mode nor captures, and says why", async () => {
    const updateSettings = given(["frame", "screen"], "frame");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    const windowCard = screen.getByRole("button", { name: /^Window/ });
    await waitFor(() => expect(windowCard).toBeDisabled());
    expect(windowCard).toHaveTextContent("Not available on this platform");
    expect(windowCard).not.toHaveTextContent("⌃⌘W");
    fireEvent.click(windowCard);
    expect(updateSettings).not.toHaveBeenCalled();
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("falls back to Frame when the current mode is unavailable, and says so", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    given(["frame", "screen"], "window");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    const primary = await screen.findByRole("button", { name: /^Capture · Frame/ });
    expect(
      screen.getByText("Window isn’t available on Windows yet, so Capture uses Frame."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Window/ })).toHaveTextContent("Coming to Windows");
    fireEvent.click(primary);
    expect(onCapture).toHaveBeenCalledWith("frame");
  });

  it("pauses everything during a recording and offers to stop it", async () => {
    given(ALL, "frame");
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
    for (const name of [/^Capture · Frame/, /^Window/, /^Screen/, /^Frame/]) {
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
    await waitFor(() => expect(screen.getByRole("button", { name: /^Window/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /^Capture · Frame/ })).toBeDisabled();
  });
});

describe("CaptureModeButtons — tray panel", () => {
  it("shows the current-mode button, three rows and the hint", async () => {
    given(ALL, "frame");
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={shortcuts} />);
    expect(await screen.findByRole("button", { name: /^Capture · Frame/ })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Screen/ })).toHaveTextContent("⌃⇧⌘X");
    // The generic shortcut belongs to the current mode; the others show their own.
    expect(screen.getByRole("button", { name: /^Frame/ })).toHaveTextContent("⌃⌘X");
    expect(screen.getByRole("button", { name: /^Window/ })).toHaveTextContent("⌃⌘W");
    expect(screen.getByLabelText("Current")).toBeInTheDocument();
    expect(screen.getByText("Click a mode to make it your default.")).toBeInTheDocument();
  });

  it("a row click only selects its mode and does not capture", async () => {
    const updateSettings = given(ALL, "frame");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="panel" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByRole("button", { name: /^Capture · Frame/ });
    fireEvent.click(screen.getByRole("button", { name: /^Screen/ }));
    expect(updateSettings).toHaveBeenCalledWith({ screenshotMode: "screen" });
    expect(onCapture).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole("button", { name: /^Capture · Screen/ }));
    expect(onCapture).toHaveBeenCalledWith("screen");
  });

  it("says Coming to Windows on a Windows machine", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
    );
    given([]);
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={shortcuts} />);
    const frame = screen.getByRole("button", { name: /^Frame/ });
    await waitFor(() => expect(frame).toBeDisabled());
    expect(frame).toHaveTextContent("Coming to Windows");
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
    expect(screen.getByRole("button", { name: /^Capture · Frame/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Screen/ })).toBeDisabled();
  });
});
