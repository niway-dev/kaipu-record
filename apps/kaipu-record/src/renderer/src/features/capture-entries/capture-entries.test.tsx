import { fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import { uiArea } from "@renderer/lib/ui-area";
import { CaptureEntries } from "./capture-entries";
import { useCaptureEntryActions } from "./use-capture-entry-actions";

const SHORTCUTS = {
  startRecording: "⇧⌘2",
  bringToFront: "⌃⌘O",
  captureScreenshot: "⇧⌘1",
  captureWindow: "⌃⌘W",
  captureInstant: "⌃⌘X",
};

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  shortcuts: defaultShortcutsFor("darwin"),
};

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

/** Main answers these settings; returns the two selector requests. */
function givenSettings(patch: Partial<AppSettings>) {
  const requestCaptureScreenshot = vi.fn();
  const requestRecordSelector = vi.fn();
  window.electronAPI = {
    ...realApi,
    requestCaptureScreenshot,
    requestRecordSelector,
    getSettings: async () => ({ ...BASE_SETTINGS, ...patch }),
  };
  return { requestCaptureScreenshot, requestRecordSelector };
}

function renderEntries(
  variant: "card" | "row",
  props: Partial<React.ComponentProps<typeof CaptureEntries>> = {},
) {
  const onScreenshot = vi.fn();
  const onRecording = vi.fn();
  render(
    <CaptureEntries
      variant={variant}
      shortcuts={SHORTCUTS}
      screenshotLastUsed="Frame"
      recordingLastUsed="Frame · Free"
      onScreenshot={onScreenshot}
      onRecording={onRecording}
      {...props}
    />,
  );
  return { onScreenshot, onRecording };
}

describe("CaptureEntries, card variant", () => {
  it("renders two buttons with title, description, keycap and the last used line", () => {
    renderEntries("card");
    const screenshot = screen.getByRole("button", { name: /^Screenshot/ });
    const recording = screen.getByRole("button", { name: /^Recording/ });
    expect(screenshot).toHaveTextContent("Pick an area, then annotate or copy it.");
    expect(screenshot).toHaveTextContent("⇧⌘1");
    expect(screenshot).toHaveTextContent("Last used · Frame");
    expect(recording).toHaveTextContent("Pick an area, then record with sound and camera.");
    expect(recording).toHaveTextContent("⇧⌘2");
    expect(recording).toHaveTextContent("Last used · Frame · Free");
  });

  it("calls the matching handler when a whole card is clicked", () => {
    const { onScreenshot, onRecording } = renderEntries("card");
    fireEvent.click(screen.getByRole("button", { name: /^Recording/ }));
    expect(onRecording).toHaveBeenCalledOnce();
    expect(onScreenshot).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: /^Screenshot/ }));
    expect(onScreenshot).toHaveBeenCalledOnce();
  });

  it("shows the Instant line as text with a keycap, not as a button", () => {
    renderEntries("card");
    expect(screen.getByText("⌃⌘X")).toBeInTheDocument();
    expect(screen.getByText("Instant")).toBeInTheDocument();
    expect(
      screen.getByText("captures the screen under the cursor at once, without the selector."),
    ).toBeVisible();
    expect(screen.getAllByRole("button")).toHaveLength(2);
  });

  it("hides a keycap and a last used line it was not given", () => {
    renderEntries("card", { shortcuts: null, screenshotLastUsed: undefined });
    const screenshot = screen.getByRole("button", { name: /^Screenshot/ });
    expect(screenshot).not.toHaveTextContent("⇧⌘1");
    expect(screenshot).not.toHaveTextContent("Last used");
    expect(screen.queryByText("⌃⌘X")).toBeNull();
  });

  it("puts the catalog areas on the cards and the Instant line", () => {
    renderEntries("card", {
      screenshotUi: uiArea("record.screenshotCard"),
      recordingUi: uiArea("record.recordingCard"),
      instantUi: uiArea("record.instantLine"),
    });
    expect(screen.getByRole("button", { name: /^Screenshot/ })).toHaveAttribute(
      "data-ui-area",
      "record.screenshotCard",
    );
    expect(screen.getByRole("button", { name: /^Recording/ })).toHaveAttribute(
      "data-ui-area",
      "record.recordingCard",
    );
    expect(screen.getByText("Instant").closest("[data-ui-area]")).toHaveAttribute(
      "data-ui-area",
      "record.instantLine",
    );
  });
});

describe("CaptureEntries, row variant", () => {
  it("renders compact rows with a keycap and no description or last used line", () => {
    renderEntries("row");
    const screenshot = screen.getByRole("button", { name: /^Screenshot/ });
    const recording = screen.getByRole("button", { name: /^Recording/ });
    expect(screenshot).toHaveTextContent("⇧⌘1");
    expect(recording).toHaveTextContent("⇧⌘2");
    expect(screen.queryByText("Pick an area, then annotate or copy it.")).toBeNull();
    expect(screen.queryByText(/Last used/)).toBeNull();
  });

  it("calls the matching handler when a row is clicked", () => {
    const { onScreenshot, onRecording } = renderEntries("row");
    fireEvent.click(screen.getByRole("button", { name: /^Screenshot/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Recording/ }));
    expect(onScreenshot).toHaveBeenCalledOnce();
    expect(onRecording).toHaveBeenCalledOnce();
  });

  it("shows the short Instant text with its keycap", () => {
    renderEntries("row");
    expect(screen.getByText("Instant, whole screen")).toBeInTheDocument();
    expect(screen.getByText("⌃⌘X")).toBeInTheDocument();
    expect(
      screen.queryByText("captures the screen under the cursor at once, without the selector."),
    ).toBeNull();
  });
});

describe("useCaptureEntryActions", () => {
  it("reads the last used modes, with the Frame aspect for a recording", async () => {
    givenSettings({
      screenshotMode: "screen",
      recordingMode: "frame",
      recordingArea: { "7": { x: 0, y: 0, width: 1280, height: 720, ratio: "16:9" } },
    });
    const { result } = renderHook(() => useCaptureEntryActions());
    await waitFor(() => expect(result.current.screenshotLastUsed).toBe("Screen"));
    await waitFor(() => expect(result.current.recordingLastUsed).toBe("Frame · 16:9"));
  });

  it("says Free for a Frame area without a ratio, and only the mode for Screen", async () => {
    givenSettings({
      recordingMode: "frame",
      recordingArea: { "7": { x: 0, y: 0, width: 800, height: 600, ratio: "free" } },
    });
    const free = renderHook(() => useCaptureEntryActions());
    await waitFor(() => expect(free.result.current.recordingLastUsed).toBe("Frame · Free"));
    free.unmount();

    givenSettings({ recordingMode: "screen" });
    const screenMode = renderHook(() => useCaptureEntryActions());
    await waitFor(() => expect(screenMode.result.current.recordingLastUsed).toBe("Screen"));
  });

  it("names only the mode for a Frame recording without a saved area", async () => {
    givenSettings({ recordingMode: "frame" });
    const { result } = renderHook(() => useCaptureEntryActions());
    await waitFor(() => expect(result.current.recordingLastUsed).toBe("Frame"));
  });

  it("leaves both modes to main: the stored ones open, whatever this window has loaded", async () => {
    const { requestCaptureScreenshot, requestRecordSelector } = givenSettings({
      screenshotMode: "screen",
    });
    const { result } = renderHook(() => useCaptureEntryActions());
    await waitFor(() => expect(result.current.screenshotLastUsed).toBe("Screen"));
    result.current.openScreenshot();
    result.current.openRecording();
    expect(requestCaptureScreenshot.mock.calls).toEqual([[]]);
    expect(requestRecordSelector.mock.calls).toEqual([[]]);
  });
});
