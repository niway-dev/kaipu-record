import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CaptureMode } from "@shared/types/screenshot-capture";
import { CaptureModeButtons } from "./capture-mode-buttons";

const shortcuts = {
  startRecording: "⌃⌘C",
  stopRecording: "⌃⌘S",
  bringToFront: "⌃⌘O",
  captureScreenshot: "⌃⌘X",
  captureScreen: "⌃⇧⌘X",
  captureFrame: "⌃⌘F",
  toggleMicrophone: "⌃⌘M",
  toggleSystemAudio: "⌃⌘A",
  toggleCamera: "⌃⌘K",
};

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

function supporting(modes: CaptureMode[]): void {
  window.electronAPI = { ...realApi, screenshotSupportedModes: async () => modes };
}

describe("CaptureModeButtons", () => {
  it("renders Area, Screen and Frame, each showing its shortcut", async () => {
    supporting(["area", "screen", "frame"]);
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={shortcuts} />);
    const area = screen.getByRole("button", { name: /^Area/ });
    const display = screen.getByRole("button", { name: /^Screen/ });
    const frame = screen.getByRole("button", { name: /^Frame/ });
    expect(area).toHaveTextContent("⌃⌘X");
    expect(display).toHaveTextContent("⌃⇧⌘X");
    expect(frame).toHaveTextContent("⌃⌘F");
    await waitFor(() => expect(area).toBeEnabled());
  });

  it("calls onCapture with the clicked mode", async () => {
    supporting(["area", "screen", "frame"]);
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="page" onCapture={onCapture} shortcuts={shortcuts} />);
    fireEvent.click(screen.getByRole("button", { name: /^Frame/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Area/ }));
    expect(onCapture.mock.calls).toEqual([["frame"], ["area"]]);
  });

  it("keeps an unsupported mode visible but disabled, saying why instead of its shortcut", async () => {
    supporting(["area"]);
    const onCapture = vi.fn();
    render(<CaptureModeButtons variant="panel" onCapture={onCapture} shortcuts={shortcuts} />);
    const display = screen.getByRole("button", { name: /^Screen/ });
    await waitFor(() => expect(display).toBeDisabled());
    expect(display).toHaveTextContent("Not available on this platform");
    expect(display).not.toHaveTextContent("⌃⇧⌘X");
    expect(screen.getByRole("button", { name: /^Frame/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Area/ })).toBeEnabled();
    fireEvent.click(display);
    expect(onCapture).not.toHaveBeenCalled();
  });

  it("says Coming to Windows on a Windows machine", async () => {
    supporting([]);
    const agent = vi.spyOn(window.navigator, "userAgent", "get");
    agent.mockReturnValue("Mozilla/5.0 (Windows NT 10.0; Win64; x64)");
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={shortcuts} />);
    const area = screen.getByRole("button", { name: /^Area/ });
    await waitFor(() => expect(area).toBeDisabled());
    expect(area).toHaveTextContent("Coming to Windows");
    agent.mockRestore();
  });

  it("disables every mode when main cannot be asked", async () => {
    window.electronAPI = {
      ...realApi,
      screenshotSupportedModes: async () => {
        throw new Error("no bridge");
      },
    };
    render(<CaptureModeButtons variant="panel" onCapture={vi.fn()} shortcuts={null} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /^Area/ })).toBeDisabled());
  });
});
