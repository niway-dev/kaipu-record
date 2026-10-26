import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { CaptureModeButtons } from "./capture-mode-buttons";

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  shortcuts: defaultShortcutsFor("darwin"),
};

const shortcuts = {
  startRecording: "⌃⌘C",
  stopRecording: "⌃⌘S",
  bringToFront: "⌃⌘O",
  captureScreenshot: "⌃⌘X",
  captureScreen: "⌃⇧⌘X",
  captureFrame: "⌃⇧⌘F",
  captureWindow: "⌃⌘W",
  recordArea: "⌃⇧⌘R",
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
  let settings: AppSettings = { ...BASE_SETTINGS, screenshotMode: current };
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
  it("renders one Capture button with the generic shortcut and the hero sentence", async () => {
    given(ALL, "frame");
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="page"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
      />,
    );
    const primary = await screen.findByRole("button", { name: /^Capture/ });
    expect(screen.getAllByRole("button", { name: /^Capture/ })).toHaveLength(1);
    expect(primary).toHaveTextContent("⌃⌘X");
    expect(
      screen.getByText(
        "Opens the selector in your last mode. Switch modes there, or pick one below to jump straight in.",
      ),
    ).toBeInTheDocument();
  });

  it("captures with the current mode from the Capture button", async () => {
    given(ALL, "screen");
    const onCapture = vi.fn();
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="page"
        onCapture={onCapture}
        shortcuts={shortcuts}
      />,
    );
    fireEvent.click(await screen.findByRole("button", { name: /^Capture/ }));
    expect(onCapture).toHaveBeenCalledWith("screen");
  });

  it("shows LAST USED and three chips with their shortcuts; the current one is highlighted", async () => {
    given(ALL, "window");
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="page"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
      />,
    );
    await screen.findByRole("button", { name: /^Capture/ });
    expect(screen.getByText("Last used")).toBeInTheDocument();
    const frame = screen.getByRole("button", { name: /^Frame/ });
    const win = screen.getByRole("button", { name: /^Window/ });
    const screenChip = screen.getByRole("button", { name: /^Screen/ });
    expect(frame).toHaveTextContent("⌃⇧⌘F");
    expect(win).toHaveTextContent("⌃⌘W");
    expect(screenChip).toHaveTextContent("⌃⇧⌘X");
    expect(win).toHaveAttribute("data-current", "true");
    expect(frame).not.toHaveAttribute("data-current");
    expect(screenChip).not.toHaveAttribute("data-current");
  });

  it("a chip click captures in that mode and never writes settings", async () => {
    const updateSettings = given(ALL, "frame");
    const onCapture = vi.fn();
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="page"
        onCapture={onCapture}
        shortcuts={shortcuts}
      />,
    );
    await screen.findByRole("button", { name: /^Capture/ });
    fireEvent.click(screen.getByRole("button", { name: /^Screen/ }));
    expect(onCapture).toHaveBeenCalledTimes(1);
    expect(onCapture).toHaveBeenCalledWith("screen");
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("disables the button and the chips during a recording and shows the banner", async () => {
    given(ALL, "frame");
    const onCapture = vi.fn();
    const onStopRecording = vi.fn();
    render(
      <CaptureModeButtons
        enabledModes={ALL}
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
    expect(screen.getByRole("status").closest("section")).toHaveAttribute("data-busy", "true");
    for (const name of [/^Capture/, /^Frame/, /^Window/, /^Screen/]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    fireEvent.click(screen.getByRole("button", { name: "Stop recording" }));
    expect(onStopRecording).toHaveBeenCalledTimes(1);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("renders nothing disabled when the platform serves all three modes, Windows included", async () => {
    given(ALL, "frame");
    // The platform comes from the bridge, never from the user agent.
    window.electronAPI = { ...window.electronAPI, platform: "win32" };
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="page"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
      />,
    );
    await screen.findByRole("button", { name: /^Capture/ });
    await waitFor(() => expect(screen.getByRole("button", { name: /^Window/ })).toBeEnabled());
    for (const button of screen.getAllByRole("button")) expect(button).toBeEnabled();
    expect(screen.queryByText(/Not available/)).not.toBeInTheDocument();
  });

  it("disables the chips with the generic label when the platform serves nothing", async () => {
    given([], "frame");
    const onCapture = vi.fn();
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="page"
        onCapture={onCapture}
        shortcuts={shortcuts}
      />,
    );
    const win = screen.getByRole("button", { name: /^Window/ });
    await waitFor(() => expect(win).toBeDisabled());
    expect(win).toHaveTextContent("Not available on this platform");
    expect(win).not.toHaveTextContent("⌃⌘W");
    expect(screen.getByRole("button", { name: /^Capture/ })).toBeDisabled();
    fireEvent.click(win);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("disables everything when main cannot be asked", async () => {
    window.electronAPI = {
      ...realApi,
      screenshotSupportedModes: async () => {
        throw new Error("no bridge");
      },
    };
    render(
      <CaptureModeButtons enabledModes={ALL} variant="page" onCapture={vi.fn()} shortcuts={null} />,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /^Window/ })).toBeDisabled());
    expect(screen.getByRole("button", { name: /^Capture/ })).toBeDisabled();
  });
});

describe("CaptureModeButtons — tray panel", () => {
  it("shows the Capture button, compact chips without shortcuts and the Last used line", async () => {
    given(ALL, "window");
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="panel"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
      />,
    );
    const primary = await screen.findByRole("button", { name: /^Capture/ });
    expect(primary).toHaveTextContent("⌃⌘X");
    for (const name of [/^Frame/, /^Window/, /^Screen/]) {
      const chip = screen.getByRole("button", { name });
      expect(chip).toBeEnabled();
      expect(chip.querySelector("kbd")).toBeNull();
    }
    expect(screen.getByRole("button", { name: /^Window/ })).toHaveAttribute("data-current", "true");
    expect(screen.getByText("Last used: Window. Switch inside the selector.")).toBeInTheDocument();
  });

  it("a chip click captures in that mode and never writes settings", async () => {
    const updateSettings = given(ALL, "frame");
    const onCapture = vi.fn();
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="panel"
        onCapture={onCapture}
        shortcuts={shortcuts}
      />,
    );
    await screen.findByRole("button", { name: /^Capture/ });
    fireEvent.click(screen.getByRole("button", { name: /^Window/ }));
    expect(onCapture.mock.calls).toEqual([["window"]]);
    expect(updateSettings).not.toHaveBeenCalled();
  });

  it("disables the chips when the platform serves nothing", async () => {
    given([]);
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="panel"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
      />,
    );
    const frame = screen.getByRole("button", { name: /^Frame/ });
    await waitFor(() => expect(frame).toBeDisabled());
    expect(screen.getByText("Not available on this platform")).toBeInTheDocument();
  });

  it("shows the compact recording banner and disables the button and chips", () => {
    given(ALL);
    render(
      <CaptureModeButtons
        enabledModes={ALL}
        variant="panel"
        onCapture={vi.fn()}
        shortcuts={shortcuts}
        recording={{ elapsedSeconds: 134 }}
      />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(
      "Recording · 00:02:14 — screenshots paused",
    );
    expect(screen.getByRole("button", { name: /^Capture/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Screen/ })).toBeDisabled();
  });
});

describe("CaptureModeButtons — Window mode disabled (the flag as shipped)", () => {
  it.each(["page", "panel"] as const)(
    "shows two chips, Frame and Screen, on the %s",
    async (variant) => {
      given(["frame", "screen"]);
      render(<CaptureModeButtons variant={variant} onCapture={vi.fn()} shortcuts={shortcuts} />);
      await screen.findByRole("button", { name: /^Frame/ });
      expect(screen.getByRole("button", { name: /^Screen/ })).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /^Window/ })).not.toBeInTheDocument();
    },
  );

  it("falls back to Frame when the stored mode is window", async () => {
    given(["frame", "screen"], "window");
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    await screen.findByText(/Last used/);
    fireEvent.click(screen.getByRole("button", { name: /^Capture/ }));
    expect(onCapture).toHaveBeenCalledWith("frame");
  });
});
