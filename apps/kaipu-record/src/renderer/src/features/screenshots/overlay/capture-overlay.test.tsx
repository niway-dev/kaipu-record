import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_SETTINGS, type AppSettings, type RecordingSettings } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import {
  CAPTURE_MODES,
  type CaptureRect,
  type OverlayState,
} from "@shared/types/screenshot-capture";
import {
  BEFORE_SEND_TIMEOUT_MS,
  CaptureOverlay,
  HIDDEN_ACK_FALLBACK_MS,
  type CaptureOverlayApi,
} from "./capture-overlay";
import type { OverlayQuery } from "./overlay-query";
import { toolbarPlacement, toolbarWidth } from "./selection-chrome";

const BASE_SETTINGS: AppSettings = {
  ...DEFAULT_SETTINGS,
  shortcuts: defaultShortcutsFor("darwin"),
};

// A 1600×1000 display whose work area loses a 25 px menu bar at the top.
const BOUNDS = { x: 0, y: 0, width: 1600, height: 1000 };
const WORK = { x: 0, y: 25, width: 1600, height: 975 };

function query(ui: OverlayQuery["ui"], overrides: Partial<OverlayQuery> = {}): OverlayQuery {
  return {
    displayId: 42,
    ui,
    index: 2,
    count: 3,
    bounds: BOUNDS,
    work: WORK,
    ids: [7, 42, 9],
    frame: null,
    internal: false,
    intent: "capture",
    ...overrides,
  };
}

/** Main's first state message, as it reaches an overlay: the frame is on display 42. */
const FRAME_ON_42: OverlayState = {
  mode: "frame",
  hoverDisplayId: null,
  frameDisplayId: 42,
  windows: null,
};

/** Main's first state message for a Screen pick. */
const SCREEN: OverlayState = {
  mode: "screen",
  hoverDisplayId: null,
  frameDisplayId: null,
  windows: null,
};

function fakeApi(
  frames: Record<string, CaptureRect> = {},
  initialState: OverlayState | null = FRAME_ON_42,
  areas: Record<string, CaptureRect> = {},
) {
  let settings: AppSettings = { ...BASE_SETTINGS, screenshotFrame: frames, recordingArea: areas };
  let state: OverlayState = initialState ?? {
    mode: "frame",
    hoverDisplayId: null,
    frameDisplayId: null,
    windows: null,
  };
  let stateListener: ((state: OverlayState) => void) | null = null;
  let recording: RecordingSettings = {
    selectedSource: null,
    selectedMicrophone: null,
    isMicrophoneEnabled: true,
    isSystemAudioEnabled: false,
    isCameraEnabled: false,
    area: null,
  };
  let recordingListener: ((settings: RecordingSettings) => void) | null = null;
  let ackListener: (() => void) | null = null;
  const api = {
    captureOverlay: {
      answer: vi.fn(),
      hover: vi.fn(),
      chooseFrameDisplay: vi.fn(),
      setMode: vi.fn(),
      setIntent: vi.fn(),
      onState: vi.fn((cb: (state: OverlayState) => void) => {
        stateListener = cb;
        if (initialState) cb(state);
        return () => {
          stateListener = null;
        };
      }),
      onHiddenAckRequest: vi.fn((cb: () => void) => {
        ackListener = cb;
        return () => {
          ackListener = null;
        };
      }),
      hiddenAck: vi.fn(),
    },
    getSettings: vi.fn(async () => settings),
    updateSettings: vi.fn(async (patch: Partial<AppSettings>) => {
      settings = { ...settings, ...patch };
      return settings;
    }),
    getRecordingSettings: vi.fn(async () => recording),
    updateRecordingSettings: vi.fn((patch: Partial<RecordingSettings>) => {
      recording = { ...recording, ...patch };
    }),
    onRecordingSettingsChanged: vi.fn((cb: (settings: RecordingSettings) => void) => {
      recordingListener = cb;
      return () => {
        recordingListener = null;
      };
    }),
  } satisfies CaptureOverlayApi;
  return {
    api,
    pushRecording: (patch: Partial<RecordingSettings>) =>
      act(() => {
        recording = { ...recording, ...patch };
        recordingListener?.(recording);
      }),
    answer: api.captureOverlay.answer,
    setMode: api.captureOverlay.setMode,
    setIntent: api.captureOverlay.setIntent,
    chooseFrameDisplay: api.captureOverlay.chooseFrameDisplay,
    pushState: (patch: Partial<OverlayState>) =>
      act(() => {
        state = { ...state, ...patch };
        stateListener?.(state);
      }),
    requestHiddenAck: () => ackListener?.(),
  };
}

const press = (key: string, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(window, { key, ...init });
};

function frameGeometry(): CaptureRect {
  const style = screen.getByTestId("capture-frame").style;
  return {
    x: parseFloat(style.left),
    y: parseFloat(style.top),
    width: parseFloat(style.width),
    height: parseFloat(style.height),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CaptureOverlay", () => {
  it("cancels on Esc, and a second Esc does not send a second answer", () => {
    const { api, answer } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

    press("Escape");
    press("Escape");

    expect(answer).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledWith({ kind: "cancelled" });
  });

  it("acks a hide request only after the next animation frame", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      frames.push(cb);
      return frames.length;
    });
    const { api, requestHiddenAck } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

    requestHiddenAck();
    expect(api.captureOverlay.hiddenAck).not.toHaveBeenCalled();

    frames.forEach((cb) => cb(0));
    expect(api.captureOverlay.hiddenAck).toHaveBeenCalledOnce();
  });

  it("acks after a short timer when the hidden window never runs a frame, and only once", () => {
    vi.useFakeTimers();
    try {
      const frames: FrameRequestCallback[] = [];
      vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
        frames.push(cb);
        return frames.length;
      });
      const { api, requestHiddenAck } = fakeApi({}, SCREEN);
      render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

      requestHiddenAck();
      vi.advanceTimersByTime(HIDDEN_ACK_FALLBACK_MS - 1);
      expect(api.captureOverlay.hiddenAck).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);
      expect(api.captureOverlay.hiddenAck).toHaveBeenCalledOnce();

      // A frame that does arrive late does not ack a second time.
      frames.forEach((cb) => cb(0));
      expect(api.captureOverlay.hiddenAck).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("display label", () => {
  it.each(["frame", "window", "screen"] as const)("names the display on the %s overlay", (ui) => {
    const { api } = fakeApi({}, null);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query(ui)} api={api} />);
    // The Screen card names it too; the corner label is on every overlay.
    expect(screen.getAllByText("Display 2").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ScreenCard", () => {
  const renderScreen = (overrides: Partial<OverlayQuery> = {}, platform?: "mac" | "other") => {
    const fake = fakeApi({}, SCREEN);
    const utils = render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", overrides)}
        api={fake.api}
        platform={platform}
      />,
    );
    return { ...fake, sheet: screen.getByTestId("screen-card-sheet"), ...utils };
  };

  it("names this display: number, title, DIP size and kind", () => {
    renderScreen();
    const card = screen.getByTestId("screen-card");
    expect(within(card).getByText("2")).toBeInTheDocument();
    expect(within(card).getByText("Display 2")).toBeInTheDocument();
    expect(within(card).getByText("1600 × 1000 · External")).toBeInTheDocument();
    cleanup();

    renderScreen({ internal: true });
    expect(screen.getByText("1600 × 1000 · Built-in")).toBeInTheDocument();
  });

  it("offers Capture · n, Copy, Record and the mode row", () => {
    renderScreen();
    const capture = screen.getByRole("button", { name: "Capture this display · 2" });
    expect(capture).toHaveTextContent("Capture · 2");
    expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Screen (3)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Record" })).toBeEnabled();
  });

  it("answers capture from Capture · n and copy from Copy", () => {
    const { answer } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "copy",
      displayId: 42,
    });
  });

  it("answers this display on a click anywhere on it", () => {
    const { answer, sheet } = renderScreen();
    fireEvent.click(sheet);
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 42,
    });
  });

  it("Record answers record for this display, without capturing it", () => {
    const { answer } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "display", action: "record", displayId: 42 }),
    );
  });

  it("Enter captures the hovered display, from whichever overlay has the keyboard", () => {
    const { answer, pushState } = renderScreen({ displayId: 7, index: 1 });
    pushState({ hoverDisplayId: 9 });

    press("Enter");

    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 9,
    });
  });

  it("Enter captures this display when none is hovered", () => {
    const { answer } = renderScreen();
    press("Enter");
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ action: "capture", displayId: 42 }),
    );
  });

  it("⌘C copies on macOS and Ctrl+C elsewhere; the other modifier does nothing", () => {
    const mac = renderScreen({}, "mac");
    press("c", { ctrlKey: true });
    expect(mac.answer).not.toHaveBeenCalled();
    press("c", { metaKey: true });
    expect(mac.answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "display", action: "copy", displayId: 42 }),
    );
    cleanup();

    const other = renderScreen({}, "other");
    press("c", { metaKey: true });
    expect(other.answer).not.toHaveBeenCalled();
    press("C", { ctrlKey: true });
    expect(other.answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "display", action: "copy", displayId: 42 }),
    );
  });

  it("a digit switches the mode instead of capturing a display", () => {
    const { answer, setMode } = renderScreen();

    press("1");

    expect(answer).not.toHaveBeenCalled();
    expect(setMode).toHaveBeenCalledExactlyOnceWith("frame");
  });

  it("switches mode from the card's mode row without capturing", () => {
    const { answer, setMode } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Window (2)" }));
    expect(setMode).toHaveBeenCalledExactlyOnceWith("window");
    expect(answer).not.toHaveBeenCalled();
    expect(screen.getByTestId("window-picker")).toBeInTheDocument();
  });

  it("reports hover once and highlights only when main says this display is hovered", () => {
    const { api, pushState, sheet } = renderScreen();

    fireEvent.pointerEnter(sheet);
    fireEvent.pointerMove(sheet);
    fireEvent.pointerMove(sheet);
    expect(api.captureOverlay.hover).toHaveBeenCalledExactlyOnceWith(42);

    // Hover alone does not highlight: main's broadcast decides.
    expect(sheet).toHaveAttribute("data-highlighted", "false");
    pushState({ hoverDisplayId: 42 });
    expect(sheet).toHaveAttribute("data-highlighted", "true");
    pushState({ hoverDisplayId: 7 });
    expect(sheet).toHaveAttribute("data-highlighted", "false");

    fireEvent.pointerLeave(sheet);
    expect(api.captureOverlay.hover).toHaveBeenLastCalledWith(null);
  });

  it("re-reports this display when main's state was cleared by another window's late leave", () => {
    const { api, pushState, sheet } = renderScreen();

    fireEvent.pointerEnter(sheet);
    pushState({ hoverDisplayId: 42 });
    // Another display's "left" reached main after our "entered".
    pushState({ hoverDisplayId: null });
    fireEvent.pointerMove(sheet);

    expect(api.captureOverlay.hover.mock.calls).toEqual([[42], [42]]);
  });
});

describe("FrameBox", () => {
  it("attaches one toolbar under the frame, centred: switch, modes, Capture, Copy, Record, Cancel", async () => {
    const { api } = fakeApi({ "42": { x: 400, y: 120, width: 400, height: 300 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const bar = screen.getByTestId("selection-toolbar");
    const buttons = within(bar).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Screenshot (P)",
      "Video (V)",
      "Frame (1)",
      "Window (2)",
      "Screen (3)",
      "Capture",
      "Copy",
      "Record",
      "Cancel",
    ]);
    expect(within(bar).getByRole("button", { name: "Frame (1)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(bar).getByRole("button", { name: "Window (2)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(bar).getByRole("button", { name: "Record" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "title",
      "Cancel · Esc",
    );
    // 10 DIP under the bottom edge (120 + 300), centred on the frame (x = 600).
    const width = toolbarWidth(3, false);
    expect(bar).toHaveAttribute("data-side", "below");
    expect(bar.style.left).toBe(`${600 - width / 2}px`);
    expect(bar.style.top).toBe("430px");
  });

  it("prints the mode names only on a selection wide enough for them", async () => {
    const wide = { x: 100, y: 120, width: 1200, height: 300 };
    const { api } = fakeApi({ "42": wide });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    expect(within(screen.getByTestId("selection-toolbar")).getByText("Frame")).toBeInTheDocument();
  });
});

describe("the dim", () => {
  const css = readFileSync(
    "src/renderer/src/features/screenshots/overlay/capture-overlay.module.css",
    "utf8",
  );
  const rule = (selector: string): string =>
    css.match(new RegExp(`^${selector.replace(".", "\\.")} \\{[^}]*\\}`, "m"))?.[0] ?? "";

  it("clears the Frame sheet and lets the frame box carry the whole dim", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    const { container } = render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />,
    );
    const box = await screen.findByTestId("capture-frame");
    expect((container.firstElementChild as HTMLElement).className).toContain("clear");
    expect(box.className).toContain("frameBox");
    // Inside the box is clear; outside is dimmed once, by the box's shadow.
    expect(rule(".clear")).toContain("rgba(0, 0, 0, 0.01)");
    expect(rule(".frameBox")).toContain("0 0 0 9999px rgba(0, 0, 0, 0.45)");
    expect(rule(".sheet")).toContain("rgba(0, 0, 0, 0.25)");
  });
});

describe("toolbarPlacement", () => {
  const area = { x: 0, y: 25, width: 1600, height: 975 };
  const width = 600;

  it("sits 10 DIP below the selection, centred on it", () => {
    const selection = { x: 100, y: 120, width: 400, height: 300 };
    expect(toolbarPlacement(selection, area, width)).toEqual({
      side: "below",
      left: 300 - width / 2,
      top: 430,
    });
  });

  it("flips above the selection near the work area's bottom edge", () => {
    const selection = { x: 100, y: 600, width: 400, height: 380 };
    // 10 DIP gap plus the 44 DIP toolbar, above y = 600: it never covers the selection.
    expect(toolbarPlacement(selection, area, width)).toMatchObject({ side: "above", top: 546 });
  });

  it("goes inside the bottom edge when neither side has room", () => {
    const selection = { x: 0, y: 25, width: 1600, height: 975 };
    // Bottom edge at 1000: 10 DIP of padding above it, the toolbar's 44 DIP height.
    expect(toolbarPlacement(selection, area, width)).toEqual({
      side: "inside",
      left: 500,
      top: 946,
    });
  });

  it("is clamped to the work area at the right and left edges", () => {
    const right = { x: 1400, y: 120, width: 200, height: 300 };
    expect(toolbarPlacement(right, area, width).left).toBe(1600 - width);
    const left = { x: 0, y: 120, width: 100, height: 300 };
    expect(toolbarPlacement(left, area, width).left).toBe(0);
  });
});

describe("FrameBox (chrome and keys)", () => {
  it("answers copy from the Copy button and from ⌘C, capture from Capture", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const copy = fakeApi({ "42": remembered });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={copy.api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    await waitFor(() =>
      expect(copy.answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
        mode: "frame",
        action: "copy",
        displayId: 42,
        rect: remembered,
      }),
    );
    cleanup();

    const key = fakeApi({ "42": remembered });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={key.api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    press("c", { metaKey: true });
    await waitFor(() =>
      expect(key.answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "copy", rect: remembered }),
      ),
    );
  });

  it("Ctrl+C copies on Windows, without the bar being hovered", async () => {
    const { api, answer } = fakeApi();
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={api}
        platform="other"
      />,
    );
    await screen.findByTestId("capture-frame");
    press("c", { ctrlKey: true });
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "copy" }),
      ),
    );
  });

  it("Record on the frame answers record with the frame", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const { api, answer } = fakeApi({ "42": remembered });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "record", rect: remembered }),
      ),
    );
  });

  it("the pill's Cancel answers cancelled", async () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
  });

  it("pressing the chrome does not start a frame drag", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const { api } = fakeApi({ "42": remembered });
    const { container } = render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />,
    );
    await screen.findByTestId("capture-frame");
    const sheet = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(screen.getByTestId("selection-toolbar"), {
      button: 0,
      clientX: 900,
      clientY: 700,
    });
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 800 });

    expect(frameGeometry()).toEqual(remembered);
  });

  it("opens on the remembered frame and answers it, display-relative, on Enter", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const other = { x: 0, y: 0, width: 50, height: 50 };
    const { api, answer } = fakeApi({ "42": remembered, "7": other });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual(remembered);
    expect(screen.getByText("400 × 300")).toBeInTheDocument();

    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
        mode: "frame",
        action: "capture",
        displayId: 42,
        rect: remembered,
      }),
    );
    // Persisted for this display, the other display's frame kept, before answering.
    expect(api.updateSettings).toHaveBeenCalledWith({
      screenshotFrame: { "42": remembered, "7": other },
    });
    expect(api.updateSettings.mock.invocationCallOrder[0]).toBeLessThan(
      answer.mock.invocationCallOrder[0]!,
    );
  });

  it("re-clamps a remembered frame that no longer fits the work area", async () => {
    // Remembered on a bigger resolution: it now hangs off the bottom-right corner.
    const { api } = fakeApi({ "42": { x: 1500, y: 900, width: 800, height: 600 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual({ x: 800, y: 400, width: 800, height: 600 });
  });

  it("shrinks a remembered frame larger than the work area to fit it", async () => {
    const { api } = fakeApi({ "42": { x: 0, y: 0, width: 2400, height: 1200 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual({ x: 0, y: 25, width: 1600, height: 975 });
  });

  it("opens on a centered box of 60 % of the work area when nothing is remembered", async () => {
    const { api } = fakeApi();
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    // Work area 1600 × 975 at y = 25 (the menu bar): 960 × 585, centred in it.
    expect(frameGeometry()).toEqual({ x: 320, y: 220, width: 960, height: 585 });
  });

  it("moves with a body drag and answers the moved frame from the Capture button", async () => {
    const { api, answer } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    const { container } = render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />,
    );
    await screen.findByTestId("capture-frame");
    const sheet = container.firstElementChild as HTMLElement;

    fireEvent.pointerDown(sheet, { button: 0, clientX: 300, clientY: 270 });
    fireEvent.pointerMove(sheet, { clientX: 350, clientY: 290 });
    fireEvent.pointerUp(sheet, { clientX: 350, clientY: 290 });
    expect(frameGeometry()).toEqual({ x: 150, y: 140, width: 400, height: 300 });

    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
        mode: "frame",
        action: "capture",
        displayId: 42,
        rect: { x: 150, y: 140, width: 400, height: 300 },
      }),
    );
  });

  it("resizes from a corner handle, never past the work area", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    const { container } = render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />,
    );
    await screen.findByTestId("capture-frame");
    const sheet = container.firstElementChild as HTMLElement;

    // The north-west corner, dragged above the menu bar: the top edge stops at y = 25.
    fireEvent.pointerDown(sheet, { button: 0, clientX: 101, clientY: 121 });
    fireEvent.pointerMove(sheet, { clientX: 60, clientY: 0 });
    fireEvent.pointerUp(sheet, { clientX: 60, clientY: 0 });
    expect(frameGeometry()).toEqual({ x: 60, y: 25, width: 440, height: 395 });
  });

  it("sends one answer when Esc follows Enter: the pending persist does not block Esc", async () => {
    const { api, answer } = fakeApi();
    let finishPersist = (): void => {};
    api.updateSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPersist = () => resolve(BASE_SETTINGS);
        }),
    );
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    press("Enter");
    await waitFor(() => expect(api.updateSettings).toHaveBeenCalled());
    expect(answer).not.toHaveBeenCalled(); // not answered while the frame is persisting
    press("Escape");
    expect(answer).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenLastCalledWith({ kind: "cancelled" });

    finishPersist(); // the persist ends after the cancel: it must not send a second answer
    press("Enter");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(answer).toHaveBeenCalledOnce();
  });

  it("answers once the persist is done, and a second Enter meanwhile is ignored", async () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    press("Enter");
    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalled());
    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]![0]).toMatchObject({ kind: "rect" });
    expect(api.updateSettings).toHaveBeenCalledOnce();
  });

  it("sends the answer after the persist timeout when remembering the frame never resolves", async () => {
    const { api, answer } = fakeApi();
    api.updateSettings.mockImplementationOnce(() => new Promise(() => {}));
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    vi.useFakeTimers();
    try {
      press("Enter");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(BEFORE_SEND_TIMEOUT_MS - 1);
      });
      expect(answer).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(answer).toHaveBeenCalledOnce();
      expect(answer.mock.calls[0]![0]).toMatchObject({ kind: "rect" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("still answers when remembering the frame fails", async () => {
    const { api, answer } = fakeApi();
    api.updateSettings.mockRejectedValueOnce(new Error("disk full"));
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
  });
});

describe("Frame on several displays", () => {
  it("offers 'Click to move the frame here' on a display without the frame, and a click asks main", () => {
    const { api, chooseFrameDisplay, answer } = fakeApi({}, { ...FRAME_ON_42, frameDisplayId: 7 });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    expect(screen.queryByTestId("capture-frame")).toBeNull();
    fireEvent.click(screen.getByText("Click to move the frame here"));

    expect(chooseFrameDisplay).toHaveBeenCalledExactlyOnceWith(42);
    expect(answer).not.toHaveBeenCalled();
  });

  it("moves the frame from the hint with Enter or Space, as a button", () => {
    const { api, chooseFrameDisplay } = fakeApi({}, { ...FRAME_ON_42, frameDisplayId: 7 });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    const hint = screen.getByRole("button", { name: "Click to move the frame here" });

    fireEvent.keyDown(hint, { key: "Enter" });
    fireEvent.keyDown(hint, { key: " " });
    fireEvent.keyDown(hint, { key: "a" });

    expect(chooseFrameDisplay).toHaveBeenCalledTimes(2);
    expect(chooseFrameDisplay).toHaveBeenCalledWith(42);
  });

  it("renders from the query's frame display before any state arrives", async () => {
    const own = fakeApi({}, null);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { frame: 42 })}
        api={own.api}
      />,
    );
    await screen.findByTestId("capture-frame");
    cleanup();

    const other = fakeApi({}, null);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { frame: 7 })}
        api={other.api}
      />,
    );
    expect(screen.getByText("Click to move the frame here")).toBeTruthy();
    expect(screen.queryByTestId("capture-frame")).toBeNull();
  });

  it("shows only the dim sheet until main says where the frame is", () => {
    const { api } = fakeApi({}, { ...FRAME_ON_42, frameDisplayId: null });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    expect(screen.queryByTestId("capture-frame")).toBeNull();
    expect(screen.queryByText("Click to move the frame here")).toBeNull();
  });

  it("renders the frame on its own display with that display's remembered geometry", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const { api } = fakeApi({ "42": remembered, "7": { x: 0, y: 25, width: 50, height: 50 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual(remembered);
    expect(screen.queryByText("Click to move the frame here")).toBeNull();
  });

  it("moves the frame between two overlays when main changes frameDisplayId", async () => {
    const remembered7 = { x: 10, y: 30, width: 200, height: 100 };
    const a = fakeApi({ "7": remembered7 }, { ...FRAME_ON_42, frameDisplayId: 7 });
    const b = fakeApi({ "7": remembered7 }, { ...FRAME_ON_42, frameDisplayId: 7 });
    render(
      <>
        <div data-testid="overlay-7">
          <CaptureOverlay
            enabledModes={CAPTURE_MODES}
            query={query("frame", { displayId: 7 })}
            api={a.api}
          />
        </div>
        <div data-testid="overlay-42">
          <CaptureOverlay
            enabledModes={CAPTURE_MODES}
            query={query("frame", { displayId: 42 })}
            api={b.api}
          />
        </div>
      </>,
    );
    const inside = (id: string) => within(screen.getByTestId(id));
    await waitFor(() => expect(inside("overlay-7").getByTestId("capture-frame")).toBeTruthy());
    expect(inside("overlay-42").queryByTestId("capture-frame")).toBeNull();
    expect(inside("overlay-42").getByText("Click to move the frame here")).toBeTruthy();

    a.pushState({ frameDisplayId: 42 });
    b.pushState({ frameDisplayId: 42 });

    await waitFor(() => expect(inside("overlay-42").getByTestId("capture-frame")).toBeTruthy());
    expect(inside("overlay-7").queryByTestId("capture-frame")).toBeNull();
    expect(inside("overlay-7").getByText("Click to move the frame here")).toBeTruthy();
    // Moving away persisted nothing.
    expect(a.api.updateSettings).not.toHaveBeenCalled();
    expect(b.api.updateSettings).not.toHaveBeenCalled();
  });

  function renderTwo() {
    const active = fakeApi();
    const idle = fakeApi({}, FRAME_ON_42);
    render(
      <>
        <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={active.api} />
        <CaptureOverlay
          enabledModes={CAPTURE_MODES}
          query={query("frame", { displayId: 7, index: 1 })}
          api={idle.api}
        />
      </>,
    );
    return { active, idle };
  }

  it("answers from the active overlay on Enter; the hint overlay does not", async () => {
    const { active, idle } = renderTwo();
    await screen.findByTestId("capture-frame");

    press("Enter");

    await waitFor(() => expect(active.answer).toHaveBeenCalledOnce());
    expect(active.answer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "rect", displayId: 42 }),
    );
    expect(idle.answer).not.toHaveBeenCalled();
  });

  it("cancels once from each overlay on Esc, the frame's and the hint's", async () => {
    const { active, idle } = renderTwo();
    await screen.findByTestId("capture-frame");

    press("Escape");
    press("Escape");

    expect(active.answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
    expect(idle.answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
  });
});

describe("FrameBox drawing on the dim sheet", () => {
  const REMEMBERED = { x: 100, y: 120, width: 400, height: 300 };

  async function setup(frames: Record<string, CaptureRect> = { "42": REMEMBERED }) {
    const fake = fakeApi(frames);
    const { container } = render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={fake.api} />,
    );
    await screen.findByTestId("capture-frame");
    return { ...fake, sheet: container.firstElementChild as HTMLElement };
  }

  it("a drag that starts outside the box draws a new one, and the release keeps it", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
    expect(frameGeometry()).toEqual({ x: 800, y: 600, width: 200, height: 150 });
    expect(screen.getByText("200 × 150")).toBeInTheDocument();
    fireEvent.pointerUp(sheet, { clientX: 1000, clientY: 750 });

    expect(frameGeometry()).toEqual({ x: 800, y: 600, width: 200, height: 150 });
  });

  it("draws in any direction: dragging up and to the left normalises the corners", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 1000, clientY: 750 });
    fireEvent.pointerMove(sheet, { clientX: 800, clientY: 600 });
    fireEvent.pointerUp(sheet, { clientX: 800, clientY: 600 });

    expect(frameGeometry()).toEqual({ x: 800, y: 600, width: 200, height: 150 });
  });

  it("keeps the drawn box inside the work area (never under the menu bar)", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 900, clientY: 0 });
    fireEvent.pointerUp(sheet, { clientX: 900, clientY: 0 });

    expect(frameGeometry()).toEqual({ x: 800, y: 25, width: 100, height: 575 });
  });

  it("answers the drawn box on Enter, and remembers it for this display", async () => {
    const { sheet, answer, api } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
    fireEvent.pointerUp(sheet, { clientX: 1000, clientY: 750 });
    press("Enter");

    const drawn = { x: 800, y: 600, width: 200, height: 150 };
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
        mode: "frame",
        action: "capture",
        displayId: 42,
        rect: drawn,
      }),
    );
    expect(api.updateSettings).toHaveBeenCalledWith({ screenshotFrame: { "42": drawn } });
  });

  it("a click on the sheet that barely moves keeps the box it found", async () => {
    const { sheet, answer } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 802, clientY: 598 });
    fireEvent.pointerUp(sheet, { clientX: 802, clientY: 598 });

    expect(frameGeometry()).toEqual(REMEMBERED);
    expect(answer).not.toHaveBeenCalled();
  });

  it("still moves from the body and resizes from a handle (a press on the box does not draw)", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 300, clientY: 270 });
    fireEvent.pointerMove(sheet, { clientX: 350, clientY: 290 });
    fireEvent.pointerUp(sheet, { clientX: 350, clientY: 290 });
    expect(frameGeometry()).toEqual({ x: 150, y: 140, width: 400, height: 300 });
  });

  it("ignores a press from a button other than the primary one", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 2, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
    expect(frameGeometry()).toEqual(REMEMBERED);
  });

  it.each(["1", "x"])(
    "the %s key mid-drag ends the drag: the half-drawn box is gone and the pointer no longer draws",
    async (key) => {
      const { sheet, answer } = await setup();

      fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
      fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
      expect(frameGeometry()).toEqual({ x: 800, y: 600, width: 200, height: 150 });

      press(key);
      expect(frameGeometry()).toEqual(REMEMBERED);

      fireEvent.pointerMove(sheet, { clientX: 1200, clientY: 800 });
      fireEvent.pointerUp(sheet, { clientX: 1200, clientY: 800 });
      expect(frameGeometry()).toEqual(REMEMBERED);
      expect(answer).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["2", "window"],
    ["3", "screen"],
  ] as const)(
    "the %s key mid-drag switches to %s, and no half-drawn box survives the round trip",
    async (key, mode) => {
      const { sheet, answer, setMode, api } = await setup();

      fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
      fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
      press(key);

      expect(setMode).toHaveBeenCalledExactlyOnceWith(mode);
      expect(screen.queryByTestId("capture-frame")).toBeNull();
      expect(answer).not.toHaveBeenCalled();

      press("1"); // back to Frame: the remembered box, not the half-drawn one
      expect(setMode).toHaveBeenLastCalledWith("frame");
      await screen.findByTestId("capture-frame");
      expect(frameGeometry()).toEqual(REMEMBERED);
      expect(api.updateSettings).not.toHaveBeenCalled();
    },
  );

  it("a key mid-move also ends the move and restores the box", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 300, clientY: 270 });
    fireEvent.pointerMove(sheet, { clientX: 350, clientY: 290 });
    press("x");
    fireEvent.pointerMove(sheet, { clientX: 500, clientY: 400 });

    expect(frameGeometry()).toEqual(REMEMBERED);
  });

  it("Enter mid-drag ends the drag first, then answers the box as drawn so far", async () => {
    const { sheet, answer } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
    press("Enter");
    // The pointer keeps moving after the drag ended: it must not change what was answered.
    fireEvent.pointerMove(sheet, { clientX: 1300, clientY: 900 });

    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
    expect(answer).toHaveBeenCalledWith({
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 42,
      rect: { x: 800, y: 600, width: 200, height: 150 },
    });
  });

  it("a modifier key alone (the start of a shortcut) does not end the drag", async () => {
    const { sheet } = await setup();

    fireEvent.pointerDown(sheet, { button: 0, clientX: 800, clientY: 600 });
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 750 });
    press("Meta");
    fireEvent.pointerMove(sheet, { clientX: 1100, clientY: 800 });

    expect(frameGeometry()).toEqual({ x: 800, y: 600, width: 300, height: 200 });
  });
});

describe("switching mode inside the overlay", () => {
  it.each([
    ["frame", FRAME_ON_42],
    ["window", { ...SCREEN, mode: "window", windows: [] }],
    ["screen", SCREEN],
  ] as const)("keys 1–3 switch the mode from %s and tell main", async (ui, state) => {
    const { api, setMode } = fakeApi({}, state as OverlayState);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query(ui)} api={api} />);
    if (ui === "frame") await screen.findByTestId("capture-frame");

    for (const key of ["1", "2", "3"]) press(key);

    // Pressed in turn: each key that names a mode not on screen switches to it, else nothing.
    const expected = {
      frame: ["window", "screen"],
      window: ["frame", "window", "screen"],
      screen: ["frame", "window", "screen"],
    };
    expect(setMode.mock.calls.map(([mode]) => mode)).toEqual(expected[ui]);
  });

  it("re-renders at once in the new mode, before main answers", () => {
    const { api, setMode } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

    press("2");

    expect(setMode).toHaveBeenCalledExactlyOnceWith("window");
    expect(screen.getByTestId("window-picker")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Finding windows…");
  });

  it("follows main's broadcast when another overlay switched the mode", () => {
    const { api, pushState, setMode } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

    pushState({ mode: "window", windows: [] });

    expect(screen.getByTestId("window-picker")).toBeInTheDocument();
    expect(setMode).not.toHaveBeenCalled();
  });

  it("a broadcast sent before main saw the switch does not flip the mode back", () => {
    const { api, pushState, setMode } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

    press("2");
    expect(setMode).toHaveBeenCalledExactlyOnceWith("window");
    // A hover broadcast main sent while it was still in Screen lands after the switch.
    pushState({ mode: "screen", hoverDisplayId: 42 });
    expect(screen.getByTestId("window-picker")).toBeInTheDocument();
    expect(screen.queryByTestId("screen-card")).toBeNull();

    // Main confirms Window; from then on its broadcasts lead again.
    pushState({ mode: "window", windows: [] });
    expect(screen.getByTestId("window-picker")).toBeInTheDocument();
    pushState({ mode: "screen" }); // another overlay switched to Screen
    expect(screen.getByTestId("screen-card")).toBeInTheDocument();
  });

  it("ignores a digit with a modifier, and a digit after the pick was answered", () => {
    const { api, setMode } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);

    press("1", { metaKey: true });
    press("2", { ctrlKey: true });
    press("1", { altKey: true });
    expect(setMode).not.toHaveBeenCalled();

    press("Escape");
    press("1");
    expect(setMode).not.toHaveBeenCalled();
  });

  it("the pill switches the mode on a click", async () => {
    const { api, setMode } = fakeApi();
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    fireEvent.click(screen.getByRole("button", { name: "Screen (3)" }));

    expect(setMode).toHaveBeenCalledExactlyOnceWith("screen");
    expect(screen.getByTestId("screen-card")).toBeInTheDocument();
  });

  it.each([
    ["frame", FRAME_ON_42],
    ["window", { ...SCREEN, mode: "window", windows: [] }],
    ["screen", SCREEN],
  ] as const)("Esc cancels in %s", (ui, state) => {
    const { api, answer } = fakeApi({}, state as OverlayState);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query(ui)} api={api} />);
    press("Escape");
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
  });
});

describe("hint pill", () => {
  it("reads 'Enter to capture' in Frame, with the platform's copy key", () => {
    const { api } = fakeApi();
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={api}
        platform="mac"
      />,
    );
    expect(screen.getByTestId("hint-pill")).toHaveTextContent(
      "Enter to capture · ⌘C to copy · 1–3 switch mode · Esc to cancel",
    );
  });

  it("reads 'Click or Enter to capture' outside Frame, Ctrl+C off macOS", () => {
    const { api } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen")}
        api={api}
        platform="other"
      />,
    );
    expect(screen.getByTestId("hint-pill")).toHaveTextContent(
      "Click or Enter to capture · Ctrl+C to copy · 1–3 switch mode · Esc to cancel",
    );
  });
});

describe("WindowPicker", () => {
  // Display-relative DIP, front first: the editor sits on top of the browser.
  const editor = {
    id: "11",
    title: "Editor",
    ownerName: "Kaipu Record",
    displayId: 42,
    rect: { x: 100, y: 100, width: 600, height: 400 },
    fullSize: { width: 600, height: 400 },
  };
  const browser = {
    id: "22",
    title: "Docs",
    ownerName: "Safari",
    displayId: 42,
    rect: { x: 0, y: 25, width: 1200, height: 800 },
    fullSize: { width: 1200, height: 800 },
  };
  const elsewhere = {
    id: "33",
    title: "Terminal",
    ownerName: "Terminal",
    displayId: 7,
    rect: { x: 0, y: 25, width: 1600, height: 975 },
    fullSize: { width: 1600, height: 975 },
  };
  const WINDOWS: OverlayState = {
    ...SCREEN,
    mode: "window",
    windows: [editor, browser, elsewhere],
  };

  function renderPicker(state: OverlayState = WINDOWS, platform?: "mac" | "other") {
    const fake = fakeApi({}, state);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("window")}
        api={fake.api}
        platform={platform}
      />,
    );
    return { ...fake, sheet: screen.getByTestId("window-picker") };
  }
  const highlighted = () => screen.queryByTestId("window-highlight");

  it("says 'Finding windows…' until the list arrives", () => {
    const { pushState } = renderPicker({ ...WINDOWS, windows: null });
    expect(screen.getByRole("status")).toHaveTextContent("Finding windows…");

    pushState({ windows: [editor] });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("says 'No windows on this display' when the list has none here", () => {
    renderPicker({ ...WINDOWS, windows: [elsewhere] });
    expect(screen.getByRole("status")).toHaveTextContent("No windows on this display");
  });

  it("highlights the front-most window under the pointer, with its title and size", () => {
    const { sheet } = renderPicker();

    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 }); // both: the editor is in front
    expect(highlighted()).toHaveAttribute("data-window-id", "11");
    expect(screen.getByText("Kaipu Record — Editor · 600 × 400")).toBeInTheDocument();
    expect(screen.getByTestId("selection-toolbar")).toBeInTheDocument();

    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 700 }); // only the browser
    expect(highlighted()).toHaveAttribute("data-window-id", "22");

    fireEvent.pointerMove(sheet, { clientX: 1400, clientY: 900 }); // nothing on this display
    expect(highlighted()).toBeNull();
  });

  it("keeps the highlight while the pointer crosses the 10 DIP gap to the action bar", () => {
    const { sheet } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });

    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 505 }); // just under the editor

    expect(highlighted()).toHaveAttribute("data-window-id", "11");
  });

  it("a click answers the window under the click", () => {
    const { sheet, answer } = renderPicker();

    fireEvent.click(sheet, { clientX: 300, clientY: 300 });

    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "window",
      mode: "window",
      action: "capture",
      displayId: 42,
      windowId: "11",
      rect: editor.rect,
    });
  });

  it("a click where no window is answers nothing", () => {
    const { sheet, answer } = renderPicker();
    fireEvent.click(sheet, { clientX: 1400, clientY: 900 });
    expect(answer).not.toHaveBeenCalled();
  });

  it("never picks another display's window", () => {
    const { sheet, answer } = renderPicker({ ...WINDOWS, windows: [elsewhere] });
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });
    fireEvent.click(sheet, { clientX: 300, clientY: 300 });
    expect(highlighted()).toBeNull();
    expect(answer).not.toHaveBeenCalled();
  });

  it("Enter captures and ⌘C copies the highlighted window; with none, they answer nothing", () => {
    const { sheet, answer } = renderPicker(WINDOWS, "mac");
    press("Enter");
    press("c", { metaKey: true });
    expect(answer).not.toHaveBeenCalled();

    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 700 });
    press("c", { metaKey: true });
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "window",
      mode: "window",
      action: "copy",
      displayId: 42,
      windowId: "22",
      rect: browser.rect,
    });
  });

  it("Enter captures the highlighted window", () => {
    const { sheet, answer } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });
    press("Enter");
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "window", action: "capture", windowId: "11" }),
    );
  });

  it("Copy in the action bar answers copy; a window cannot be recorded from here", () => {
    const { sheet, answer } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });

    expect(screen.getByRole("button", { name: "Record" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Record" }));
    expect(answer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "window", action: "copy", windowId: "11" }),
    );
  });

  it("tells main the pointer is on this display, so this overlay gets the keyboard", () => {
    const { sheet, api } = renderPicker();

    fireEvent.pointerEnter(sheet, { clientX: 300, clientY: 300 });
    fireEvent.pointerMove(sheet, { clientX: 310, clientY: 300 });
    fireEvent.pointerMove(sheet, { clientX: 320, clientY: 300 });

    // One message, not one per move.
    expect(api.captureOverlay.hover).toHaveBeenCalledExactlyOnceWith(42);
  });

  it("highlights the window under the pointer as soon as the list lands, without a move", () => {
    const { pushState, answer } = renderPicker({ ...WINDOWS, windows: null });
    expect(highlighted()).toBeNull();

    // Main reads the pointer (global DIP) when the list lands; this display starts at (0, 0).
    pushState({ windows: [editor, browser], cursor: { x: 300, y: 300 } });

    expect(highlighted()).toHaveAttribute("data-window-id", "11");
    press("Enter");
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "window", action: "capture", windowId: "11" }),
    );
  });

  it("maps main's global pointer into this display, and stops following it once the pointer moves here", () => {
    const offset = query("window", { bounds: { x: 1600, y: 0, width: 1600, height: 1000 } });
    const fake = fakeApi({}, { ...WINDOWS, windows: null });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={offset} api={fake.api} />);
    const sheet = screen.getByTestId("window-picker");

    // (300, 300) global is on the display left of this one: nothing here.
    fake.pushState({ windows: [editor, browser], cursor: { x: 300, y: 300 } });
    expect(highlighted()).toBeNull();

    // Global (1900, 300) is (300, 300) on this display: the editor.
    fake.pushState({ cursor: { x: 1900, y: 300 } });
    expect(highlighted()).toHaveAttribute("data-window-id", "11");

    // The pointer moved here: local tracking decides, a later broadcast does not override it.
    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 700 });
    fake.pushState({ cursor: { x: 1900, y: 300 } });
    expect(highlighted()).toHaveAttribute("data-window-id", "22");
  });

  it("drops the highlight when a new list no longer holds that window", () => {
    const { sheet, pushState } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });
    expect(highlighted()).toHaveAttribute("data-window-id", "11");

    pushState({ windows: [browser] });

    expect(highlighted()).toBeNull();
  });
});

describe("Window mode disabled (the flag as shipped)", () => {
  it("offers Frame and Screen on the toolbar, badges 1 and 2", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const buttons = within(screen.getByTestId("selection-toolbar")).getAllByRole("button");
    expect(buttons.map((button) => button.getAttribute("aria-label"))).toEqual([
      "Screenshot (P)",
      "Video (V)",
      "Frame (1)",
      "Screen (2)",
      "Capture",
      "Copy",
      "Record",
      "Cancel",
    ]);
  });

  it("offers Frame and Screen on the Screen card's row", () => {
    const { api } = fakeApi({}, SCREEN);
    render(<CaptureOverlay query={query("screen")} api={api} />);
    const row = screen.getByRole("group", { name: "Capture mode" });
    expect(within(row).getAllByRole("button")).toHaveLength(2);
    expect(within(row).queryByRole("button", { name: /Window/ })).not.toBeInTheDocument();
  });

  it("says 1–2 switch mode in the hint", () => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query("frame")} api={api} platform="mac" />);
    expect(screen.getByTestId("hint-pill")).toHaveTextContent(
      "Enter to capture · ⌘C to copy · 1–2 switch mode · Esc to cancel",
    );
  });

  it("switches with keys 1 and 2, and key 3 does nothing", () => {
    const { api, setMode } = fakeApi({}, SCREEN);
    render(<CaptureOverlay query={query("screen")} api={api} />);

    press("3");
    expect(setMode).not.toHaveBeenCalled();
    expect(screen.getByTestId("screen-card")).toBeInTheDocument();

    press("2"); // already Screen: no-op
    expect(setMode).not.toHaveBeenCalled();
    press("1");
    expect(setMode).toHaveBeenCalledExactlyOnceWith("frame");
  });
});

describe("CaptureOverlay — opened to record (ADR 0030)", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };
  const frame = { x: 300, y: 300, width: 500, height: 400 };

  it("starts from the remembered recording area, not the screenshot frame", async () => {
    const { api } = fakeApi({ "42": frame }, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
      />,
    );
    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual(area);
  });

  it("Enter starts recording the area and remembers it, with its ratio, as the recording area", async () => {
    const { api, answer } = fakeApi({ "42": frame }, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
      />,
    );
    await screen.findByTestId("capture-frame");

    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
        mode: "frame",
        action: "record",
        displayId: 42,
        rect: area,
        // The answer carries the ratio too, so main stores it with the take.
        ratio: "free",
      }),
    );
    expect(api.updateSettings).toHaveBeenCalledWith({
      recordingArea: { "42": { ...area, ratio: "free" } },
    });
    expect(api.updateSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenshotFrame: expect.anything() }),
    );
  });

  it("R records the area too; the record chrome replaces the screenshot toolbar", async () => {
    const { api, answer } = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    expect(screen.queryByTestId("selection-toolbar")).toBeNull();
    expect(screen.queryByRole("button", { name: /Use selection/ })).toBeNull();
    expect(screen.getByTestId("start-pill")).toBeEnabled();
    expect(screen.getByTestId("record-widget")).toBeInTheDocument();
    expect(screen.getByTestId("ratio-bar")).toBeInTheDocument();

    press("r");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "record", rect: area }),
      ),
    );
  });

  it("an area under the minimum cannot be recorded", async () => {
    const tiny = { x: 100, y: 120, width: 40, height: 300 };
    const { api, answer } = fakeApi({}, FRAME_ON_42, { "42": tiny });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("start-pill")).toBeDisabled();

    press("Enter");
    press("r");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(answer).not.toHaveBeenCalled();
  });

  it("a screenshot overlay offers an enabled Record next to Capture and Copy", async () => {
    const { api, answer } = fakeApi({ "42": frame });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const record = within(screen.getByTestId("selection-toolbar")).getByRole("button", {
      name: /^Record/,
    });
    expect(record).toBeEnabled();

    fireEvent.click(record);
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "record", rect: frame }),
      ),
    );
    // Recording from a screenshot overlay remembers nothing in the screenshot frame memory.
    expect(api.updateSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ screenshotFrame: expect.anything() }),
    );
  });

  it("the Screen card records the display, and in the record intent a click selects it", async () => {
    const { api, answer } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={api}
      />,
    );
    const card = await screen.findByTestId("screen-card");
    fireEvent.click(within(card).getByRole("button", { name: /^Record/ }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "record",
      displayId: 42,
    });
  });

  it("in the record intent, a click on the display records it", async () => {
    const { api, answer } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={api}
      />,
    );
    fireEvent.click(await screen.findByTestId("screen-card-sheet"));
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "record",
      displayId: 42,
    });
  });
});

describe("CaptureOverlay — the Window picker opened to record", () => {
  it("Enter does not take a screenshot of the hovered window", async () => {
    const { api, answer, pushState } = fakeApi(
      {},
      { mode: "window", hoverDisplayId: null, frameDisplayId: null, windows: null },
    );
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("window", { intent: "record" })}
        api={api}
      />,
    );
    pushState({
      windows: [
        {
          id: "11",
          title: "Editor",
          ownerName: "Kaipu",
          displayId: 42,
          rect: { x: 100, y: 100, width: 600, height: 400 },
          fullSize: { width: 600, height: 400 },
        },
      ],
      cursor: { x: 300, y: 300 },
    });
    fireEvent.pointerMove(await screen.findByTestId("window-picker"), {
      clientX: 300,
      clientY: 300,
    });
    press("Enter");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("CaptureOverlay — record chrome (design Kaipu Record Modes)", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  function renderRecord(
    areas: Record<string, CaptureRect & { ratio?: string }> = { "42": area },
    overrides: Partial<OverlayQuery> = {},
  ) {
    const fake = fakeApi({}, FRAME_ON_42, areas as Record<string, CaptureRect>);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record", scaleFactor: 2, ...overrides })}
        api={fake.api}
        platform="mac"
      />,
    );
    return fake;
  }

  it("prints the box's size in device pixels next to the ratio chips", async () => {
    renderRecord();
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("ratio-size")).toHaveTextContent("1280 × 720");
    const bar = screen.getByTestId("ratio-bar");
    const chips = within(bar).getAllByRole("button");
    expect(chips.map((chip) => chip.textContent)).toEqual(["Free", "16:9", "9:16", "1:1"]);
    expect(within(bar).getByRole("button", { name: "Free" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("a ratio chip reshapes the box around its centre and is remembered with the area", async () => {
    const { answer, api } = renderRecord({ "42": { ...area, height: 300 } });
    await screen.findByTestId("capture-frame");
    fireEvent.click(screen.getByRole("button", { name: "1:1" }));
    const box = frameGeometry();
    expect(box.width).toBe(box.height);
    expect(box.x + box.width / 2).toBe(420);

    fireEvent.click(screen.getByTestId("start-pill"));
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "record", rect: box }),
      ),
    );
    expect(api.updateSettings).toHaveBeenCalledWith({
      recordingArea: { "42": { ...box, ratio: "1:1" } },
    });
  });

  it("opens with the remembered ratio locked, and a corner drag keeps it", async () => {
    renderRecord({ "42": { ...area, ratio: "16:9" } });
    await screen.findByTestId("capture-frame");
    expect(screen.getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "true");
    const sheet = screen.getByTestId("capture-frame").parentElement!;
    // Grab the bottom-right corner (740, 480) and pull it right.
    fireEvent.pointerDown(sheet, { button: 0, clientX: 740, clientY: 480, pointerId: 1 });
    fireEvent.pointerMove(sheet, { clientX: 1060, clientY: 500, pointerId: 1 });
    fireEvent.pointerUp(sheet, { pointerId: 1 });
    expect(frameGeometry()).toEqual({ x: 100, y: 120, width: 960, height: 540 });
  });

  it("after P the frame resizes freely; V locks the remembered ratio again", async () => {
    renderRecord({ "42": { ...area, ratio: "16:9" } });
    await screen.findByTestId("capture-frame");
    press("p");
    const sheet = screen.getByTestId("capture-frame").parentElement!;
    fireEvent.pointerDown(sheet, { button: 0, clientX: 740, clientY: 480, pointerId: 1 });
    fireEvent.pointerMove(sheet, { clientX: 1060, clientY: 900, pointerId: 1 });
    fireEvent.pointerUp(sheet, { pointerId: 1 });
    // Free: width and height follow the pointer independently.
    expect(frameGeometry()).toEqual({ x: 100, y: 120, width: 960, height: 780 });

    press("v");
    expect(screen.getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "true");
    // The free box is refit to the restored ratio at once, before any further drag.
    const box = frameGeometry();
    expect(Math.abs(box.width / box.height - 16 / 9)).toBeLessThan(0.01);
    fireEvent.pointerDown(sheet, {
      button: 0,
      clientX: box.x + box.width,
      clientY: box.y + box.height,
      pointerId: 2,
    });
    fireEvent.pointerMove(sheet, { clientX: box.x + 640, clientY: box.y + 100, pointerId: 2 });
    fireEvent.pointerUp(sheet, { pointerId: 2 });
    const locked = frameGeometry();
    expect(Math.abs(locked.width / locked.height - 16 / 9)).toBeLessThan(0.01);
  });

  it("the widget offers the modes, then Mic, System audio and Camera, then Cancel", async () => {
    const { api } = renderRecord();
    await screen.findByTestId("capture-frame");
    const widget = screen.getByTestId("record-widget");
    expect(widget).toHaveAttribute("data-side", "right");
    const labels = within(widget)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual([
      "Screenshot (P)",
      "Video (V)",
      "Frame (1)",
      "Window (2)",
      "Screen (3)",
      "Microphone",
      "System audio",
      "Camera",
      "Cancel",
    ]);
    // Main's settings: the microphone is on, system audio is off.
    await waitFor(() =>
      expect(within(widget).getByRole("button", { name: "Microphone" })).toHaveAttribute(
        "aria-pressed",
        "true",
      ),
    );
    fireEvent.click(within(widget).getByRole("button", { name: "System audio" }));
    expect(api.updateRecordingSettings).toHaveBeenCalledExactlyOnceWith({
      isSystemAudioEnabled: true,
    });
    expect(within(widget).getByRole("button", { name: "System audio" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("a camera blocked in the OS reads locked on the widget and cannot be turned on", async () => {
    const fake = fakeApi({}, FRAME_ON_42, { "42": area });
    const api = { ...fake.api, getCameraAccessStatus: vi.fn(async () => "blocked" as const) };
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record", scaleFactor: 2 })}
        api={api}
        platform="mac"
      />,
    );
    const widget = await screen.findByTestId("record-widget");
    const camera = await within(widget).findByRole("button", { name: "Camera, blocked" });
    expect(camera).toHaveAttribute("aria-disabled", "true");
    expect(camera).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(camera);
    expect(fake.api.updateRecordingSettings).not.toHaveBeenCalled();
  });

  it("sizes the camera placeholder from the bubble setting", async () => {
    const fake = fakeApi({}, FRAME_ON_42, { "42": area });
    const settings = await fake.api.getSettings();
    const api = {
      ...fake.api,
      getSettings: vi.fn(async () => ({
        ...settings,
        cameraBubble: { ...settings.cameraBubble, size: 160, shape: "rounded" as const },
      })),
    };
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record", scaleFactor: 2 })}
        api={api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    fake.pushRecording({ isCameraEnabled: true });
    await waitFor(() => expect(screen.getByTestId("camera-preview").style.width).toBe("160px"));
    expect(screen.getByTestId("camera-preview")).toHaveAttribute("data-shape", "rounded");
  });

  it("shows where the camera bubble will be while the camera is on", async () => {
    const { pushRecording } = renderRecord();
    await screen.findByTestId("capture-frame");
    expect(screen.queryByTestId("camera-preview")).toBeNull();
    pushRecording({ isCameraEnabled: true });
    const preview = screen.getByTestId("camera-preview");
    // Bottom-left inside the box, 56 DIP in (window margin + pad), default 240 DIP:
    // (100 + 56, 480 - 56 - 240).
    expect(preview.style.left).toBe("156px");
    expect(preview.style.top).toBe("184px");
  });

  it("Cancel on the widget cancels, like Esc", async () => {
    const { answer } = renderRecord();
    await screen.findByTestId("capture-frame");
    fireEvent.click(
      within(screen.getByTestId("record-widget")).getByRole("button", { name: "Cancel" }),
    );
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
  });

  it("the hint names the record keys", async () => {
    renderRecord();
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("hint-pill")).toHaveTextContent(
      "Drag the box or its handles · 1–3 switch mode · ↵ start · Esc cancel",
    );
  });
});

describe("CaptureOverlay — the intent is shared across displays", () => {
  it("V on the overlay that has the frame asks main to switch every overlay", async () => {
    const first = fakeApi({ "42": { x: 100, y: 120, width: 640, height: 360 } });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={first.api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    press("v");
    expect(first.setIntent).toHaveBeenCalledExactlyOnceWith("record");
  });

  it("the other display's overlay, opened to capture, records once main broadcasts the switch", async () => {
    // Display 7 shows the Screen card; display 42 (another window) pressed V.
    const other = fakeApi(
      {},
      { mode: "screen", hoverDisplayId: 7, frameDisplayId: null, windows: null },
    );
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { displayId: 7 })}
        api={other.api}
        platform="mac"
      />,
    );
    expect(screen.queryByText(/Record this display/)).toBeNull();
    other.pushState({ intent: "record" });
    expect(await screen.findByText(/Record this display/)).toBeInTheDocument();
    // A click there now records, not screenshots.
    fireEvent.click(screen.getByText(/Record this display/));
    await waitFor(() =>
      expect(other.answer).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "display", action: "record", displayId: 7 }),
      ),
    );
  });
});

describe("CaptureOverlay — the Capture | Record switch", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  it("P and V switch the confirm actions and keep the box and the mode", async () => {
    const { api, answer, setMode } = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("start-pill")).toBeInTheDocument();

    press("p");
    // Screenshot actions now: Capture (Enter) and Copy; the record chrome is gone.
    const bar = screen.getByTestId("selection-toolbar");
    expect(within(bar).getByRole("button", { name: "Capture" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Copy" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Screenshot (P)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("start-pill")).toBeNull();
    expect(frameGeometry()).toEqual(area);
    expect(setMode).not.toHaveBeenCalled();

    press("v");
    expect(screen.getByTestId("start-pill")).toBeInTheDocument();
    expect(frameGeometry()).toEqual(area);

    press("p");
    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "capture", rect: area }),
      ),
    );
  });

  it("a click on the switch turns a screenshot overlay into a recording one", async () => {
    const { api, answer } = fakeApi({ "42": area });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    fireEvent.click(screen.getByRole("button", { name: "Video (V)" }));
    expect(screen.queryByTestId("selection-toolbar")).toBeNull();
    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "record", rect: area }),
      ),
    );
  });

  it("the Screen card carries the switch and, opened to record, Record this display and the inputs", async () => {
    const { api, answer } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={api}
      />,
    );
    const card = await screen.findByTestId("screen-card");
    expect(within(card).getByTestId("intent-switch")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Mic" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "System" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Cam" })).toBeInTheDocument();
    expect(screen.getByTestId("hint-pill")).toHaveTextContent(
      "Each display shows its own card · Esc cancel",
    );

    fireEvent.click(within(card).getByRole("button", { name: "Screenshot (P)" }));
    expect(within(card).queryByRole("button", { name: "Mic" })).toBeNull();
    expect(within(card).getByRole("button", { name: /Capture this display/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Video (V)" }));
    fireEvent.click(within(card).getByRole("button", { name: "Record this display" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "record",
      displayId: 42,
    });
  });
});
