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

// The widget's device chevrons enumerate devices through these hooks, which need
// `navigator.mediaDevices` (absent in jsdom). Tests choose the devices through `devices`.
const devices = vi.hoisted(() => ({
  microphones: [] as { deviceId: string; label: string }[],
  cameras: [] as { deviceId: string; label: string }[],
}));
vi.mock("@renderer/features/recording/hooks/use-microphones", () => ({
  useMicrophones: () => devices.microphones,
}));
vi.mock("@renderer/features/camera-settings/use-camera-settings", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@renderer/features/camera-settings/use-camera-settings")
  >()),
  useCameras: () => devices.cameras,
}));

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
  // The countdown is 0 here unless a test asks: most record tests are about what is sent,
  // not about the 3 s wait (those tests pass `recordingCountdownSeconds: 3`).
  extra: Partial<AppSettings> = {},
) {
  let settings: AppSettings = {
    ...BASE_SETTINGS,
    screenshotFrame: frames,
    recordingArea: areas,
    recordingCountdownSeconds: 0,
    ...extra,
  };
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
  // The toggles and the device menus each subscribe, as in the app.
  const recordingListeners = new Set<(settings: RecordingSettings) => void>();
  let ackListener: (() => void) | null = null;
  const api = {
    captureOverlay: {
      answer: vi.fn(),
      hover: vi.fn(),
      chooseFrameDisplay: vi.fn(),
      setMode: vi.fn(),
      setIntent: vi.fn(),
      setCounting: vi.fn(),
      openRecordSettings: vi.fn(),
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
      requestState: vi.fn(),
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
      recordingListeners.add(cb);
      return () => {
        recordingListeners.delete(cb);
      };
    }),
  } satisfies CaptureOverlayApi;
  return {
    api,
    pushRecording: (patch: Partial<RecordingSettings>) =>
      act(() => {
        recording = { ...recording, ...patch };
        recordingListeners.forEach((listener) => listener(recording));
      }),
    answer: api.captureOverlay.answer,
    setMode: api.captureOverlay.setMode,
    setIntent: api.captureOverlay.setIntent,
    setCounting: api.captureOverlay.setCounting,
    openRecordSettings: api.captureOverlay.openRecordSettings,
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

/** Let pending promises (settings reads, the persist before an answer) settle; real or fake timers. */
const flush = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });

/** Advance fake timers by `ms` and settle what that unblocked. */
const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await flush();
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
  vi.useRealTimers();
  vi.restoreAllMocks();
  devices.microphones = [];
  devices.cameras = [];
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

describe("a spare (loaded ahead of its pick)", () => {
  it("paints nothing until main's first state arrives", () => {
    const { api, pushState } = fakeApi({}, null);
    const { container } = render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { spare: true })}
        api={api}
      />,
    );
    expect(container).toBeEmptyDOMElement();

    pushState({ mode: "screen", frameDisplayId: null });
    expect(container).not.toBeEmptyDOMElement();
    expect(screen.getByTestId("capture-widget")).toBeInTheDocument();
  });

  it("asks main for the state once it listens, so a state sent before that is not lost", () => {
    const { api } = fakeApi({}, null);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { spare: true })}
        api={api}
      />,
    );
    expect(api.captureOverlay.requestState).toHaveBeenCalledOnce();
    expect(api.captureOverlay.onState.mock.invocationCallOrder[0]).toBeLessThan(
      api.captureOverlay.requestState.mock.invocationCallOrder[0]!,
    );
  });

  it("takes the mode and the frame display from the state, not from the loaded query", () => {
    const { api, pushState } = fakeApi({}, null);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { spare: true })}
        api={api}
      />,
    );
    pushState({ mode: "frame", frameDisplayId: 42 });
    expect(screen.queryByText("Click to move the frame here")).toBeNull();

    // The same window is then reused by a pick whose frame is on another display.
    pushState({ mode: "frame", frameDisplayId: 7 });
    expect(screen.getByText("Click to move the frame here")).toBeInTheDocument();
  });

  it("opens with the intent main sends, for the remembered area too", async () => {
    const { api, pushState } = fakeApi({}, null, {
      "42": { x: 10, y: 10, width: 300, height: 200 },
    });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { spare: true })}
        api={api}
      />,
    );
    pushState({ mode: "frame", frameDisplayId: 42, intent: "record" });
    await waitFor(() => expect(screen.getByTestId("capture-frame")).toBeInTheDocument());
    expect(frameGeometry()).toMatchObject({ width: 300, height: 200 });
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

  it("is a slim badge plus the widget docked at the bottom: Capture, Copy to clipboard, the mode row, no Record", () => {
    renderScreen();
    // The badge carries no buttons any more: every action lives on the widget.
    expect(within(screen.getByTestId("screen-card")).queryAllByRole("button")).toHaveLength(0);
    const widget = screen.getByRole("toolbar", { name: "Capture options" });
    expect(widget).toBe(screen.getByTestId("capture-widget"));
    expect(widget).toHaveAttribute("data-edge", "bottom");
    expect(within(widget).getByRole("button", { name: "Capture" })).toBeInTheDocument();
    expect(within(widget).getByRole("button", { name: "Copy to clipboard" })).toBeInTheDocument();
    expect(within(widget).getByRole("button", { name: "Screen (3)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(widget).queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
  });

  it("answers capture from Capture and copy from Copy to clipboard, once each (the press stays on the widget)", () => {
    const { answer, api } = renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "copy",
      displayId: 42,
    });
    cleanup();

    const second = renderScreen();
    fireEvent.click(
      within(screen.getByTestId("capture-widget")).getByRole("button", { name: "Capture" }),
    );
    expect(second.answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "capture",
      displayId: 42,
    });
    expect(api.captureOverlay.answer).toHaveBeenCalledOnce();
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
  it("shows one widget in screenshot intent: Capture as, Area, Ratio, then Copy, Cancel, Capture", async () => {
    const { api } = fakeApi({ "42": { x: 400, y: 120, width: 400, height: 300 } });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    const widget = screen.getByRole("toolbar", { name: "Capture options" });
    expect(screen.getAllByTestId("capture-widget")).toHaveLength(1);
    expect(widget).toHaveAttribute("data-intent", "capture");
    const buttons = within(widget).getAllByRole("button");
    // Buttons without an aria-label read their text, which ends with the key badge.
    expect(
      buttons.map((button) => button.getAttribute("aria-label") ?? button.textContent),
    ).toEqual([
      "ScreenshotP",
      "RecordingV",
      "Frame (1)",
      "Window (2)",
      "Screen (3)",
      "Free",
      "16:9",
      "9:16",
      "1:1",
      "Copy to clipboard⌘C",
      "CancelEsc",
      "Capture",
    ]);
    expect(within(widget).getByRole("button", { name: "Frame (1)" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(widget).getByRole("button", { name: "Window (2)" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(within(widget).getByRole("button", { name: "Screenshot" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(within(widget).queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
    expect(within(widget).getByRole("button", { name: "Cancel" })).toHaveAttribute(
      "title",
      "Cancel · Esc",
    );
  });

  it("docks the widget at the bottom for a mid-screen box and at the top for one reaching the bottom band", async () => {
    const mid = fakeApi({ "42": { x: 400, y: 120, width: 400, height: 300 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={mid.api} />);
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("capture-widget")).toHaveAttribute("data-edge", "bottom");
    cleanup();

    const low = fakeApi({ "42": { x: 400, y: 600, width: 400, height: 380 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={low.api} />);
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("capture-widget")).toHaveAttribute("data-edge", "top");
  });

  it("reads the box's size in device pixels in the size readout", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { scaleFactor: 2 })}
        api={api}
      />,
    );
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("size-readout")).toHaveTextContent("800 × 600 px");
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
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
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

  it("the widget's Cancel answers cancelled", async () => {
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

    fireEvent.pointerDown(screen.getByTestId("capture-widget"), {
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
    expect(screen.getByTestId("size-readout")).toHaveTextContent("400 × 300");

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

describe("widget hints (successor of the hint pill)", () => {
  it("Frame: the hints line names the box, the switches and the go keys; nothing is pinned elsewhere", async () => {
    const { api } = fakeApi();
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame")}
        api={api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    const hints = screen.getByTestId("widget-hints");
    // The badges (kbd) sit flush against their words in the text content.
    expect(hints).toHaveTextContent(/Box\s*drag the box or its handles/);
    expect(hints).toHaveTextContent(/Switch\s*123\s*area\s*PV\s*intent/);
    expect(hints).toHaveTextContent(/Go\s*↵\s*start\s*Esc\s*cancel/);
    // The old pill is gone, and a screenshot overlay has no R or "More settings".
    expect(screen.queryByTestId("hint-pill")).toBeNull();
    expect(hints).not.toHaveTextContent(/record/);
    expect(within(hints).queryByRole("button", { name: "More settings" })).toBeNull();
  });

  it("Screen: no box hint, and Copy to clipboard prints Ctrl+C off macOS", () => {
    const { api } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen")}
        api={api}
        platform="other"
      />,
    );
    expect(screen.getByTestId("widget-hints")).not.toHaveTextContent("drag the box");
    expect(screen.getByRole("button", { name: "Copy to clipboard" })).toHaveTextContent("Ctrl+C");
  });

  it("the copy key on the button follows the platform: ⌘C on macOS", () => {
    const { api } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen")}
        api={api}
        platform="mac"
      />,
    );
    expect(screen.getByRole("button", { name: "Copy to clipboard" })).toHaveTextContent("⌘C");
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
    expect(screen.getByTestId("capture-widget")).toBeInTheDocument();

    fireEvent.pointerMove(sheet, { clientX: 1000, clientY: 700 }); // only the browser
    expect(highlighted()).toHaveAttribute("data-window-id", "22");

    fireEvent.pointerMove(sheet, { clientX: 1400, clientY: 900 }); // nothing on this display
    expect(highlighted()).toBeNull();
  });

  it("keeps the highlight while the pointer is on the widget, even over another window", () => {
    const { sheet } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });

    // (1000, 700) is inside the browser only; on the sheet it would take the highlight.
    fireEvent.pointerMove(screen.getByTestId("capture-widget"), { clientX: 1000, clientY: 700 });

    expect(highlighted()).toHaveAttribute("data-window-id", "11");
  });

  it("shows the widget before any window is hovered, and its actions answer nothing until one is", () => {
    const { answer } = renderPicker();

    expect(screen.getByTestId("capture-widget")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Capture" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));

    expect(answer).not.toHaveBeenCalled();
  });

  it("Capture on the widget answers the hovered window, once", () => {
    const { sheet, answer } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });

    fireEvent.click(screen.getByRole("button", { name: "Capture" }));

    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "window", action: "capture", windowId: "11" }),
    );
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

  it("Copy to clipboard on the widget answers copy; a screenshot picker has no Record", () => {
    const { sheet, answer } = renderPicker();
    fireEvent.pointerMove(sheet, { clientX: 300, clientY: 300 });

    expect(screen.queryByRole("button", { name: "Record" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy to clipboard" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "window", action: "copy", windowId: "11" }),
    );
  });

  it("opened to record, the widget still draws Record (disabled: a window cannot be recorded)", () => {
    const fake = fakeApi({}, WINDOWS);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("window", { intent: "record" })}
        api={fake.api}
      />,
    );
    fireEvent.pointerMove(screen.getByTestId("window-picker"), { clientX: 300, clientY: 300 });
    const widget = screen.getByTestId("capture-widget");
    expect(within(widget).getByRole("button", { name: "Record" })).toBeDisabled();
    expect(within(widget).queryByRole("button", { name: "Capture" })).not.toBeInTheDocument();
    // Enter and the click on the widget's Record do nothing either.
    fireEvent.click(within(widget).getByRole("button", { name: "Record" }));
    press("Enter");
    expect(fake.answer).not.toHaveBeenCalled();
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
  it("offers Frame and Screen as keys 1 and 2, and a disabled Window segment marked soon", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const widget = screen.getByTestId("capture-widget");
    const area = within(widget).getByRole("group", { name: "Capture mode" });
    expect(
      within(area)
        .getAllByRole("button")
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Frame (1)", "Screen (2)", "Window · soon"]);
    const soon = within(widget).getByTestId("window-soon");
    expect(soon).toBeDisabled();
    expect(soon).toHaveTextContent("Window");
    expect(soon).toHaveTextContent("soon");
  });

  it("clicking the Window segment does nothing", async () => {
    const { api, setMode } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    fireEvent.click(screen.getByTestId("window-soon"));
    expect(setMode).not.toHaveBeenCalled();
  });

  it("offers Frame and Screen, and the soon Window, on the Screen mode's widget too", () => {
    const { api } = fakeApi({}, SCREEN);
    render(<CaptureOverlay query={query("screen")} api={api} />);
    const row = screen.getByRole("group", { name: "Capture mode" });
    // Frame, Screen and the disabled Window placeholder.
    expect(within(row).getAllByRole("button")).toHaveLength(3);
    expect(within(row).queryByRole("button", { name: "Window (2)" })).not.toBeInTheDocument();
    expect(within(row).getByTestId("window-soon")).toBeDisabled();
  });

  it("offers no soon Window segment when Window mode is on offer", () => {
    const { api } = fakeApi({}, SCREEN);
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={api} />);
    expect(screen.queryByTestId("window-soon")).toBeNull();
    expect(screen.getByRole("button", { name: "Window (2)" })).toBeEnabled();
  });

  it("says 1 2 switch the area in the hints, and 3 is not a key", async () => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query("frame")} api={api} platform="mac" />);
    await screen.findByTestId("capture-frame");
    expect(screen.getByTestId("widget-hints")).toHaveTextContent(
      /Switch\s*12\s*area\s*PV\s*intent/,
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

  it("R records the area too; the record row replaces the screenshot row on the same widget", async () => {
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
    expect(screen.queryByRole("button", { name: /Use selection/ })).toBeNull();
    // One widget, whatever the intent: its record row has Record, no Capture and no Copy.
    const widget = screen.getByTestId("capture-widget");
    expect(screen.getAllByTestId("capture-widget")).toHaveLength(1);
    expect(widget).toHaveAttribute("data-intent", "record");
    expect(within(widget).getByRole("button", { name: "Record" })).toBeEnabled();
    expect(within(widget).queryByRole("button", { name: "Capture" })).toBeNull();
    expect(within(widget).queryByRole("button", { name: "Copy to clipboard" })).toBeNull();
    expect(screen.getByTestId("ratio-chips")).toBeInTheDocument();

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
    expect(screen.getByTestId("start-recording")).toBeDisabled();

    press("Enter");
    press("r");
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(answer).not.toHaveBeenCalled();
  });

  it("a screenshot overlay has no Record button and R does nothing; P / V is the way to record", async () => {
    const { api, answer } = fakeApi({ "42": frame });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const widget = screen.getByTestId("capture-widget");
    expect(within(widget).queryByRole("button", { name: /^Record$/ })).not.toBeInTheDocument();
    expect(within(widget).getByRole("button", { name: "Recording" })).toBeInTheDocument();
    press("r");
    expect(answer).not.toHaveBeenCalled();
  });

  it("the Screen widget records the display from Record", async () => {
    const { api, answer } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={api}
      />,
    );
    await screen.findByTestId("screen-card");
    await flush();
    fireEvent.click(
      within(screen.getByTestId("capture-widget")).getByRole("button", { name: "Record" }),
    );
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
    const sheet = await screen.findByTestId("screen-card-sheet");
    await flush(); // the configured countdown (0 here) has been read
    fireEvent.click(sheet);
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
    expect(screen.getByTestId("size-readout")).toHaveTextContent("1280 × 720");
    const chips = screen.getByTestId("ratio-chips");
    expect(
      within(chips)
        .getAllByRole("button")
        .map((chip) => chip.textContent),
    ).toEqual(["Free", "16:9", "9:16", "1:1"]);
    expect(within(chips).getByRole("button", { name: "Free" })).toHaveAttribute(
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

    fireEvent.click(screen.getByTestId("start-recording"));
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

  it("the ratio lock survives P and V: a corner drag keeps 16:9 in both intents", async () => {
    renderRecord({ "42": { ...area, ratio: "16:9" } });
    await screen.findByTestId("capture-frame");
    const sheet = screen.getByTestId("capture-frame").parentElement!;
    const ratioOf = (box: CaptureRect): number => box.width / box.height;

    press("p");
    expect(screen.getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerDown(sheet, { button: 0, clientX: 740, clientY: 480, pointerId: 1 });
    fireEvent.pointerMove(sheet, { clientX: 1060, clientY: 900, pointerId: 1 });
    fireEvent.pointerUp(sheet, { pointerId: 1 });
    // Not free: a pointer at (1060, 900) alone would make 960 × 780.
    const shot = frameGeometry();
    expect(Math.abs(ratioOf(shot) - 16 / 9)).toBeLessThan(0.01);
    expect(shot.width).not.toBe(960);

    press("v");
    expect(screen.getByRole("button", { name: "16:9" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.pointerDown(sheet, {
      button: 0,
      clientX: shot.x + shot.width,
      clientY: shot.y + shot.height,
      pointerId: 2,
    });
    fireEvent.pointerMove(sheet, { clientX: shot.x + 640, clientY: shot.y + 100, pointerId: 2 });
    fireEvent.pointerUp(sheet, { pointerId: 2 });
    expect(Math.abs(ratioOf(frameGeometry()) - 16 / 9)).toBeLessThan(0.01);
  });

  it("the widget offers intent, modes and ratios, then the three inputs, then Cancel and Record", async () => {
    const { api } = renderRecord();
    await screen.findByTestId("capture-frame");
    const widget = screen.getByTestId("capture-widget");
    expect(widget).toHaveAttribute("data-edge", "bottom");
    const labels = within(widget)
      .getAllByRole("button")
      .map((button) => button.getAttribute("aria-label") ?? button.textContent);
    expect(labels).toEqual([
      "ScreenshotP",
      "RecordingV",
      "Frame (1)",
      "Window (2)",
      "Screen (3)",
      "Free",
      "16:9",
      "9:16",
      "1:1",
      "Choose Microphone device",
      "Microphone",
      "System audio",
      "Choose Camera device",
      "Camera",
      "CancelEsc",
      "Record",
      "More settings",
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
    const widget = await screen.findByTestId("capture-widget");
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
      within(screen.getByTestId("capture-widget")).getByRole("button", { name: "Cancel" }),
    );
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
  });

  it("the hints name the record keys and offer More settings", async () => {
    renderRecord();
    await screen.findByTestId("capture-frame");
    const hints = screen.getByTestId("widget-hints");
    expect(hints).toHaveTextContent(/Box\s*drag the box or its handles/);
    expect(hints).toHaveTextContent(/Go\s*↵\s*start\s*Esc\s*cancel\s*R\s*record/);
    expect(within(hints).getByRole("button", { name: "More settings" })).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Record" })).toBeNull();
    other.pushState({ intent: "record" });
    const record = await screen.findByRole("button", { name: "Record" });
    await flush(); // the configured countdown (0 here) has been read
    // A click there now records, not screenshots.
    fireEvent.click(record);
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
    expect(screen.getByTestId("start-recording")).toBeInTheDocument();

    press("p");
    // Screenshot actions now: Capture (Enter) and Copy; the record chrome is gone.
    const bar = screen.getByTestId("capture-widget");
    expect(within(bar).getByRole("button", { name: "Capture" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Copy to clipboard" })).toBeEnabled();
    expect(within(bar).getByRole("button", { name: "Screenshot" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.queryByTestId("start-recording")).toBeNull();
    expect(frameGeometry()).toEqual(area);
    expect(setMode).not.toHaveBeenCalled();

    press("v");
    expect(screen.getByTestId("start-recording")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: "Recording" }));
    expect(screen.queryByRole("button", { name: "Capture" })).toBeNull();
    expect(screen.getByTestId("start-recording")).toBeInTheDocument();
    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "record", rect: area }),
      ),
    );
  });

  it("the Screen widget carries the switch and, opened to record, Record and the inputs; nothing is pinned elsewhere", async () => {
    const { api, answer } = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={api}
      />,
    );
    await screen.findByTestId("screen-card");
    await flush(); // the configured countdown (0 here) has been read
    const widget = screen.getByTestId("capture-widget");
    expect(
      within(widget).getByRole("group", { name: "Screenshot or recording" }),
    ).toBeInTheDocument();
    expect(within(widget).getByTestId("input-microphone")).toBeInTheDocument();
    expect(within(widget).getByTestId("input-systemAudio")).toBeInTheDocument();
    expect(within(widget).getByTestId("input-camera")).toBeInTheDocument();
    expect(screen.queryByTestId("hint-pill")).toBeNull();

    fireEvent.click(within(widget).getByRole("button", { name: "Screenshot" }));
    expect(screen.queryByTestId("input-microphone")).toBeNull();
    expect(within(widget).getByRole("button", { name: "Capture" })).toBeInTheDocument();
    fireEvent.click(within(widget).getByRole("button", { name: "Recording" }));
    fireEvent.click(within(widget).getByRole("button", { name: "Record" }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "record",
      displayId: 42,
    });
  });
});

describe("CaptureOverlay — the keyboard works from the first paint", () => {
  // The frame appears in a later commit (the remembered geometry loads first). The release
  // verify of desktop-v0.15.0 pressed Enter the moment the box was in the DOM and nothing
  // answered: the box's keydown listener was a passive effect, one task behind the paint.
  // This observes the DOM like that test did (a MutationObserver, a microtask after the
  // commit) and expects the listener to be there already: it attaches in the commit itself.
  it("the frame box hears Enter as soon as it is in the DOM", async () => {
    let keydownListeners = 0;
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, ...rest) => {
      if (type === "keydown") keydownListeners += 1;
      return original(type, ...(rest as [EventListenerOrEventListenerObject, boolean?]));
    });
    const listenersWhenPainted = new Promise<number>((resolve) => {
      const observer = new MutationObserver(() => {
        if (!document.querySelector('[data-testid="capture-frame"]')) return;
        observer.disconnect();
        resolve(keydownListeners);
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });

    const { api } = fakeApi({ "42": { x: 300, y: 300, width: 500, height: 400 } });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);

    // The overlay's own Esc listener, plus the frame box's Enter listener.
    expect(await listenersWhenPainted).toBe(2);
  });
});

describe("CaptureOverlay — a box under the minimum", () => {
  it("can be shot with Enter and the Capture button stays enabled", async () => {
    const tiny = { x: 100, y: 120, width: 40, height: 30 };
    const { api, answer } = fakeApi({ "42": tiny });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    expect(screen.getByRole("button", { name: "Capture" })).toBeEnabled();

    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ kind: "rect", action: "capture", rect: tiny }),
      ),
    );
  });
});

describe("CaptureOverlay — the countdown runs on the widget (ADR 0056)", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  /** A recording overlay whose settings say `seconds`; fake timers are on once it is ready. */
  async function renderCounting(
    seconds: number | undefined = 3,
    ui: "frame" | "screen" = "frame",
    overrides: Partial<OverlayQuery> = {},
  ) {
    const fake = fakeApi(
      {},
      ui === "frame" ? FRAME_ON_42 : SCREEN,
      { "42": area },
      { recordingCountdownSeconds: seconds as 0 | 3 | 5 },
    );
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query(ui, { intent: "record", ...overrides })}
        api={fake.api}
        platform="mac"
      />,
    );
    await screen.findByTestId(ui === "frame" ? "capture-frame" : "screen-card");
    await flush(); // the configured countdown has been read
    vi.useFakeTimers();
    return fake;
  }
  const disc = (): HTMLElement | null => screen.queryByTestId("countdown-disc");

  it("prints the configured length on Record, or 'starts at once' for 0", async () => {
    const three = await renderCounting(3);
    expect(screen.getByTestId("start-recording")).toHaveTextContent("3 s countdown");
    expect(three.setCounting).not.toHaveBeenCalled();
    cleanup();
    vi.useRealTimers();

    await renderCounting(0);
    expect(screen.getByTestId("start-recording")).toHaveTextContent("starts at once");
  });

  it("Enter tells main it is counting, shows 3, 2, 1 on a disc, and answers at zero with countdownDone", async () => {
    const { answer, setCounting } = await renderCounting(3);

    press("Enter");
    expect(setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(answer).not.toHaveBeenCalled();
    expect(disc()).toHaveTextContent("3");
    // The confirm button reads the count and cannot be pressed twice.
    expect(screen.getByTestId("start-recording")).toBeDisabled();
    expect(screen.getByTestId("start-recording")).toHaveTextContent("Starting in 3…");

    await tick(1000);
    expect(disc()).toHaveTextContent("2");
    await tick(1000);
    expect(disc()).toHaveTextContent("1");
    expect(answer).not.toHaveBeenCalled();

    await tick(1000);
    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "rect",
      mode: "frame",
      action: "record",
      displayId: 42,
      rect: area,
      ratio: "free",
      countdownDone: true,
    });
    expect(setCounting.mock.calls).toEqual([[true], [false]]);
    // Main is told the count is over before it hears the answer, so it never hides the widget twice.
    expect(setCounting.mock.invocationCallOrder[1]).toBeLessThan(
      answer.mock.invocationCallOrder[0]!,
    );
    expect(disc()).toBeNull();
  });

  it("R and the Record button start the same count", async () => {
    const byKey = await renderCounting(3);
    press("r");
    expect(byKey.setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(disc()).toHaveTextContent("3");
    cleanup();
    vi.useRealTimers();

    const byClick = await renderCounting(3);
    fireEvent.click(screen.getByTestId("start-recording"));
    expect(byClick.setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(disc()).toHaveTextContent("3");
    expect(byClick.answer).not.toHaveBeenCalled();
  });

  it("the Screen widget counts and then answers the display, with countdownDone", async () => {
    const { answer, setCounting } = await renderCounting(3, "screen");

    fireEvent.click(screen.getByTestId("start-recording"));
    expect(setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(answer).not.toHaveBeenCalled();
    await tick(3000);

    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "record",
      displayId: 42,
      countdownDone: true,
    });
  });

  it("with a countdown of 0 the answer goes at once, without countdownDone and without counting", async () => {
    const frame = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={frame.api}
      />,
    );
    await screen.findByTestId("capture-frame");
    await flush();
    press("Enter");
    await waitFor(() =>
      expect(frame.answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
        mode: "frame",
        action: "record",
        displayId: 42,
        rect: area,
        ratio: "free",
      }),
    );
    expect(frame.setCounting).not.toHaveBeenCalled();
    expect(disc()).toBeNull();
    cleanup();

    const display = await renderCounting(0, "screen");
    vi.useRealTimers();
    fireEvent.click(screen.getByTestId("start-recording"));
    expect(display.answer).toHaveBeenCalledExactlyOnceWith({
      kind: "display",
      mode: "screen",
      action: "record",
      displayId: 42,
    });
    expect(display.setCounting).not.toHaveBeenCalled();
  });

  it("counts 3 s when the settings carry no countdown", async () => {
    const { setCounting, answer } = await renderCounting(undefined);
    press("Enter");
    expect(setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(disc()).toHaveTextContent("3");
    await tick(2000);
    expect(answer).not.toHaveBeenCalled();
    await tick(1000);
    expect(answer).toHaveBeenCalledOnce();
  });

  it("a Record pressed before the settings read finishes waits for it, then counts the saved 5 s", async () => {
    const fake = fakeApi({}, SCREEN, { "42": area }, { recordingCountdownSeconds: 5 });
    const saved = await fake.api.getSettings();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fake.api.getSettings.mockImplementation(async () => {
      await gate;
      return saved;
    });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={fake.api}
        platform="mac"
      />,
    );
    await screen.findByTestId("screen-card");
    vi.useFakeTimers();

    press("Enter");
    // The length is unknown, so nothing starts yet and nothing is answered.
    expect(fake.setCounting).not.toHaveBeenCalled();
    expect(fake.answer).not.toHaveBeenCalled();

    release();
    await flush();
    expect(fake.setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(disc()).toHaveTextContent("5");
    await tick(4000);
    expect(fake.answer).not.toHaveBeenCalled();
    await tick(1000);
    expect(fake.answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "display", action: "record", countdownDone: true }),
    );
  });

  it("a Record pressed while the settings read fails counts the fallback 3 s", async () => {
    const fake = fakeApi({}, SCREEN, { "42": area });
    let fail: (error: Error) => void = () => {};
    const gate = new Promise<never>((_, reject) => {
      fail = reject;
    });
    fake.api.getSettings.mockImplementation(() => gate);
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("screen", { intent: "record" })}
        api={fake.api}
        platform="mac"
      />,
    );
    await screen.findByTestId("screen-card");
    vi.useFakeTimers();

    press("Enter");
    expect(fake.setCounting).not.toHaveBeenCalled();
    fail(new Error("settings unavailable"));
    await flush();
    expect(disc()).toHaveTextContent("3");
    await tick(3000);
    expect(fake.answer).toHaveBeenCalledOnce();
  });

  it("counts the configured 5 s, not a fixed 3", async () => {
    const { answer } = await renderCounting(5);
    press("Enter");
    expect(disc()).toHaveTextContent("5");
    await tick(4000);
    expect(answer).not.toHaveBeenCalled();
    await tick(1000);
    expect(answer).toHaveBeenCalledOnce();
  });

  it("a screenshot never counts, whatever the setting says", async () => {
    const fake = fakeApi({}, FRAME_ON_42, { "42": area }, { recordingCountdownSeconds: 3 });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={fake.api} />);
    await screen.findByTestId("capture-frame");
    await flush();
    press("Enter");
    await waitFor(() =>
      expect(fake.answer).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ action: "capture" }),
      ),
    );
    expect(fake.setCounting).not.toHaveBeenCalled();
  });

  it("Esc stops only the count: no answer, main is told, the widget is back; a second Esc cancels", async () => {
    const { answer, setCounting } = await renderCounting(3);
    press("Enter");
    await tick(1000);

    press("Escape");
    expect(setCounting.mock.calls).toEqual([[true], [false]]);
    expect(answer).not.toHaveBeenCalled();
    expect(disc()).toBeNull();
    expect(screen.getByTestId("start-recording")).toBeEnabled();
    expect(screen.getByTestId("start-recording")).toHaveTextContent("Record");
    // The stopped count must not fire later.
    await tick(5000);
    expect(answer).not.toHaveBeenCalled();

    press("Escape");
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "cancelled" });
  });

  it("Cancel on the widget also stops only the count; the box can be recorded again afterwards", async () => {
    const { answer, setCounting } = await renderCounting(3);
    press("Enter");

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(setCounting.mock.calls).toEqual([[true], [false]]);
    expect(answer).not.toHaveBeenCalled();

    press("Enter");
    expect(setCounting.mock.calls).toEqual([[true], [false], [true]]);
    await tick(3000);
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "record", countdownDone: true }),
    );
  });

  it("while it counts, Enter, R, P, V, 1-3 and M, A, W do nothing", async () => {
    const { answer, setCounting, setIntent, setMode, api } = await renderCounting(3);
    press("Enter");

    for (const key of ["Enter", "r", "p", "v", "1", "2", "3", "m", "a", "w"]) press(key);
    fireEvent.click(screen.getByTestId("start-recording"));

    expect(setCounting).toHaveBeenCalledExactlyOnceWith(true);
    expect(setIntent).not.toHaveBeenCalled();
    expect(setMode).not.toHaveBeenCalled();
    expect(api.updateRecordingSettings).not.toHaveBeenCalled();
    expect(screen.queryByTestId("input-toast")).toBeNull();
    expect(disc()).toHaveTextContent("3");

    await tick(3000);
    // One count, one answer.
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "record", countdownDone: true }),
    );
  });

  it("the box cannot be dragged, resized or redrawn while it counts: the answer carries the box shown", async () => {
    const { answer } = await renderCounting(3);
    // Pointer events bubble from the box to the sheet's handlers, whatever the coordinates.
    const sheet = screen.getByTestId("capture-frame");
    press("Enter");

    // Inside the box (move), on the dim sheet (redraw) and on a corner (resize).
    for (const [x, y] of [
      [300, 270],
      [20, 20],
      [area.x, area.y],
    ] as const) {
      fireEvent.pointerDown(sheet, { button: 0, clientX: x, clientY: y });
      fireEvent.pointerMove(sheet, { clientX: x + 60, clientY: y + 40 });
      fireEvent.pointerUp(sheet, { clientX: x + 60, clientY: y + 40 });
    }

    expect(frameGeometry()).toEqual(area);
    await tick(3000);
    expect(answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ action: "record", countdownDone: true, rect: area }),
    );
  });

  it("while it counts, everything but Cancel and Record is inert, so Tab and Space change nothing", async () => {
    await renderCounting(3);
    const locked = (): Element[] => Array.from(document.querySelectorAll("[inert]"));
    expect(locked()).toHaveLength(0);

    press("Enter");

    // Capture as, Area, Ratio, the three inputs and the hints.
    expect(locked()).toHaveLength(7);
    expect(screen.getByRole("button", { name: "Cancel" }).closest("[inert]")).toBeNull();
    expect(screen.getByTestId("start-recording").closest("[inert]")).toBeNull();
    expect(screen.getByRole("button", { name: "Screenshot" }).closest("[inert]")).not.toBeNull();
    expect(screen.getByRole("button", { name: "16:9" }).closest("[inert]")).not.toBeNull();
  });

  it("More settings during the count stops it, opens the settings and answers nothing", async () => {
    const { answer, setCounting, openRecordSettings } = await renderCounting(3);
    press("Enter");

    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    expect(openRecordSettings).toHaveBeenCalledOnce();
    expect(setCounting.mock.calls).toEqual([[true], [false]]);
    await tick(5000);
    expect(answer).not.toHaveBeenCalled();
  });
});

describe("CaptureOverlay — the ratio chips work in both intents, in Frame only", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  it("in the screenshot intent a chip reshapes the box, and the answer and the remembered frame carry no ratio", async () => {
    const { api, answer } = fakeApi({ "42": area });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const chips = screen.getByTestId("ratio-chips");
    expect(within(chips).getByRole("button", { name: "Free" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    fireEvent.click(within(chips).getByRole("button", { name: "1:1" }));
    expect(within(chips).getByRole("button", { name: "1:1" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const box = frameGeometry();
    expect(box.width).toBe(box.height);

    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
    expect(answer).toHaveBeenCalledWith({
      kind: "rect",
      mode: "frame",
      action: "capture",
      displayId: 42,
      rect: box,
    });
    expect(api.updateSettings).toHaveBeenCalledWith({ screenshotFrame: { "42": box } });
  });

  it("in the record intent the same chip is carried by the answer and the recording area", async () => {
    const { api, answer } = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
      />,
    );
    await screen.findByTestId("capture-frame");
    await flush();
    fireEvent.click(
      within(screen.getByTestId("ratio-chips")).getByRole("button", { name: "16:9" }),
    );
    const box = frameGeometry();

    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
    expect(answer).toHaveBeenCalledWith(
      expect.objectContaining({ action: "record", rect: box, ratio: "16:9" }),
    );
    expect(api.updateSettings).toHaveBeenCalledWith({
      recordingArea: { "42": { ...box, ratio: "16:9" } },
    });
  });

  it("every chip is enabled in Frame and disabled in Screen and Window", async () => {
    const frame = fakeApi({ "42": area });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={frame.api} />);
    await screen.findByTestId("capture-frame");
    for (const chip of within(screen.getByTestId("ratio-chips")).getAllByRole("button")) {
      expect(chip).toBeEnabled();
    }
    cleanup();

    const display = fakeApi({}, SCREEN);
    render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("screen")} api={display.api} />,
    );
    const onScreen = within(screen.getByTestId("ratio-chips")).getAllByRole("button");
    expect(onScreen).toHaveLength(4);
    for (const chip of onScreen) {
      expect(chip).toBeDisabled();
      expect(chip).toHaveAttribute("aria-pressed", "false");
    }
    cleanup();

    const picker = fakeApi({}, { ...SCREEN, mode: "window", windows: [] });
    render(
      <CaptureOverlay enabledModes={CAPTURE_MODES} query={query("window")} api={picker.api} />,
    );
    for (const chip of within(screen.getByTestId("ratio-chips")).getAllByRole("button")) {
      expect(chip).toBeDisabled();
    }
  });
});

describe("CaptureOverlay — M, A and W toggle the inputs", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  async function renderInputs(
    intent: "capture" | "record" = "record",
    extra: Partial<CaptureOverlayApi> = {},
  ) {
    const fake = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent })}
        api={{ ...fake.api, ...extra }}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    if (intent === "record") await microphoneLoaded();
    return fake;
  }
  // Main's settings have the microphone on; keys act on what was read, so wait for it.
  const microphoneLoaded = () =>
    waitFor(() =>
      expect(
        within(screen.getByTestId("input-microphone")).getByRole("button", { name: "Microphone" }),
      ).toHaveAttribute("aria-pressed", "true"),
    );
  const toast = (): HTMLElement | null => screen.queryByTestId("input-toast");

  it("each key flips its input once and shows its toast with the key", async () => {
    const { api } = await renderInputs();

    press("m");
    expect(api.updateRecordingSettings).toHaveBeenLastCalledWith({ isMicrophoneEnabled: false });
    expect(toast()).toHaveTextContent("✓ Microphone off M");

    press("a");
    expect(api.updateRecordingSettings).toHaveBeenLastCalledWith({ isSystemAudioEnabled: true });
    expect(toast()).toHaveTextContent("✓ System audio on A");

    press("w");
    expect(api.updateRecordingSettings).toHaveBeenLastCalledWith({ isCameraEnabled: true });
    expect(toast()).toHaveTextContent("✓ Camera on W");
    expect(api.updateRecordingSettings).toHaveBeenCalledTimes(3);
    // The switches follow.
    expect(
      within(screen.getByTestId("input-systemAudio")).getByRole("button", { name: "System audio" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("the toast and the input's halo last 1.5 s, then both go", async () => {
    await renderInputs();
    vi.useFakeTimers();

    press("a");
    expect(toast()).toBeInTheDocument();
    expect(screen.getByTestId("input-systemAudio")).toHaveAttribute("data-halo", "true");

    await tick(1499);
    expect(toast()).toBeInTheDocument();
    await tick(1);
    expect(toast()).toBeNull();
    expect(screen.getByTestId("input-systemAudio")).not.toHaveAttribute("data-halo");
  });

  it("a second key restarts the toast for the new input", async () => {
    await renderInputs();
    vi.useFakeTimers();

    press("a");
    await tick(1000);
    press("w");
    await tick(1000);
    // 2 s after the first key, but only 1 s after the second one.
    expect(toast()).toHaveTextContent("✓ Camera on W");
    await tick(500);
    expect(toast()).toBeNull();
  });

  it("a second toggle inside 1.5 s hands the halo over: no input stays lit afterwards", async () => {
    await renderInputs();
    vi.useFakeTimers();

    press("a");
    await tick(500);
    press("w");
    expect(screen.getByTestId("input-systemAudio")).not.toHaveAttribute("data-halo");
    expect(screen.getByTestId("input-camera")).toHaveAttribute("data-halo", "true");

    await tick(1500);
    expect(screen.getByTestId("input-camera")).not.toHaveAttribute("data-halo");
    expect(screen.getByTestId("input-systemAudio")).not.toHaveAttribute("data-halo");
  });

  it("a click on the toggle changes the input and shows no toast", async () => {
    const { api } = await renderInputs();

    fireEvent.click(
      within(screen.getByTestId("input-systemAudio")).getByRole("button", { name: "System audio" }),
    );

    expect(api.updateRecordingSettings).toHaveBeenCalledExactlyOnceWith({
      isSystemAudioEnabled: true,
    });
    expect(toast()).toBeNull();
  });

  it("a camera blocked in the OS: W changes nothing and shows no toast", async () => {
    const { api } = await renderInputs("record", {
      getCameraAccessStatus: vi.fn(async () => "blocked" as const),
    });
    await screen.findByRole("button", { name: "Camera, blocked" });

    press("w");

    expect(api.updateRecordingSettings).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it.each([
    ["a held key", { repeat: true }],
    ["⌘", { metaKey: true }],
    ["Ctrl", { ctrlKey: true }],
    ["Alt", { altKey: true }],
    ["Shift", { shiftKey: true }],
  ] as const)("%s does not toggle", async (_name, init) => {
    const { api } = await renderInputs();

    press("m", init);
    press("a", init);
    press("w", init);

    expect(api.updateRecordingSettings).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it("a key typed into a text field does not toggle", async () => {
    const { api } = await renderInputs();
    const field = document.createElement("input");
    document.body.append(field);
    try {
      fireEvent.keyDown(field, { key: "m" });
      fireEvent.keyDown(field, { key: "a" });
    } finally {
      field.remove();
    }
    expect(api.updateRecordingSettings).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
  });

  it("in the screenshot intent M, A and W do nothing and there are no inputs", async () => {
    const { api } = await renderInputs("capture");

    press("m");
    press("a");
    press("w");

    expect(api.updateRecordingSettings).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
    expect(screen.queryByTestId("input-microphone")).toBeNull();
  });

  it("after V on a screenshot overlay the keys work", async () => {
    const { api } = await renderInputs("capture");
    press("v");
    await microphoneLoaded();

    press("a");

    expect(api.updateRecordingSettings).toHaveBeenCalledExactlyOnceWith({
      isSystemAudioEnabled: true,
    });
    expect(toast()).toHaveTextContent("✓ System audio on A");
  });
});

describe("CaptureOverlay — More settings", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  it("opens the Record settings once and sends no answer, even when Esc or Enter follow", async () => {
    const { api, answer, openRecordSettings } = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={api}
      />,
    );
    await screen.findByTestId("capture-frame");
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    expect(openRecordSettings).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "More settings" }));
    press("Escape");
    press("Enter");
    await flush();

    expect(openRecordSettings).toHaveBeenCalledOnce();
    expect(answer).not.toHaveBeenCalled();
  });

  it("is on the screenshot widget in no form", async () => {
    const { api } = fakeApi({ "42": area });
    render(<CaptureOverlay enabledModes={CAPTURE_MODES} query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    expect(screen.queryByRole("button", { name: "More settings" })).toBeNull();
  });
});

describe("CaptureOverlay — the device menus", () => {
  const area = { x: 100, y: 120, width: 640, height: 360 };

  async function renderRecording() {
    const fake = fakeApi({}, FRAME_ON_42, { "42": area });
    render(
      <CaptureOverlay
        enabledModes={CAPTURE_MODES}
        query={query("frame", { intent: "record" })}
        api={fake.api}
        platform="mac"
      />,
    );
    await screen.findByTestId("capture-frame");
    await flush();
    return fake;
  }

  it("Enter on a device menu item reaches no overlay shortcut: it does not start the recording", async () => {
    devices.microphones = [{ deviceId: "usb", label: "USB mic" }];
    const { answer, setCounting } = await renderRecording();

    fireEvent.click(screen.getByRole("button", { name: "Choose Microphone device" }));
    fireEvent.keyDown(screen.getByRole("menuitemradio", { name: "USB mic" }), { key: "Enter" });
    // The confirm persists the box first, so give it time to answer before asserting nothing did.
    await flush();

    expect(setCounting).not.toHaveBeenCalled();
    expect(answer).not.toHaveBeenCalled();
  });

  it("the Microphone name opens a menu of radio items; choosing one writes the shared recording settings", async () => {
    devices.microphones = [
      { deviceId: "built-in", label: "Built-in mic" },
      { deviceId: "usb", label: "USB mic" },
    ];
    const { api } = await renderRecording();

    const chevron = screen.getByRole("button", { name: "Choose Microphone device" });
    expect(chevron).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.click(chevron);

    const menu = screen.getByRole("menu", { name: "Microphone" });
    expect(chevron).toHaveAttribute("aria-expanded", "true");
    const items = within(menu).getAllByRole("menuitemradio");
    expect(items.map((item) => item.textContent)).toEqual(["Built-in mic", "USB mic"]);
    // Nothing is selected yet: the system default is in use.
    expect(items.map((item) => item.getAttribute("aria-checked"))).toEqual(["false", "false"]);

    fireEvent.click(within(menu).getByRole("menuitemradio", { name: "USB mic" }));
    expect(api.updateRecordingSettings).toHaveBeenCalledExactlyOnceWith({
      selectedMicrophone: { deviceId: "usb", label: "USB mic" },
    });
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Choose Microphone device" }));
    expect(screen.getByRole("menuitemradio", { name: "USB mic" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    // Choosing a device is not a toggle: no toast, the microphone's state is untouched.
    expect(screen.queryByTestId("input-toast")).toBeNull();
  });

  it("the Camera name writes the choice into the camera bubble, keeping its other settings", async () => {
    devices.cameras = [
      { deviceId: "facetime", label: "FaceTime HD" },
      { deviceId: "cam-link", label: "Cam Link" },
    ];
    const { api } = await renderRecording();
    const bubble = (await api.getSettings()).cameraBubble;

    fireEvent.click(screen.getByRole("button", { name: "Choose Camera device" }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Cam Link" }));

    await waitFor(() =>
      expect(api.updateSettings).toHaveBeenCalledWith({
        cameraBubble: { ...bubble, deviceId: "cam-link" },
      }),
    );
  });

  it("says so when no device is found, and System audio has no device menu", async () => {
    await renderRecording();

    fireEvent.click(screen.getByRole("button", { name: "Choose Camera device" }));
    expect(within(screen.getByRole("menu")).getByText("No devices found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Choose System audio device" })).toBeNull();
  });

  it("a press outside the menu closes it", async () => {
    devices.microphones = [{ deviceId: "usb", label: "USB mic" }];
    await renderRecording();
    fireEvent.click(screen.getByRole("button", { name: "Choose Microphone device" }));
    expect(screen.getByRole("menu")).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("CaptureOverlay — one widget per display in Screen mode", () => {
  it("each display's overlay carries its own widget, docked at the bottom", () => {
    const first = fakeApi({}, SCREEN);
    const second = fakeApi({}, SCREEN);
    render(
      <>
        <CaptureOverlay
          enabledModes={CAPTURE_MODES}
          query={query("screen", { displayId: 7, index: 1 })}
          api={first.api}
        />
        <CaptureOverlay
          enabledModes={CAPTURE_MODES}
          query={query("screen", { displayId: 42, index: 2 })}
          api={second.api}
        />
      </>,
    );

    const widgets = screen.getAllByTestId("capture-widget");
    expect(widgets).toHaveLength(2);
    for (const widget of widgets) expect(widget).toHaveAttribute("data-edge", "bottom");

    fireEvent.click(within(widgets[1]!).getByRole("button", { name: "Capture" }));
    expect(second.answer).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ kind: "display", displayId: 42 }),
    );
    expect(first.answer).not.toHaveBeenCalled();
  });
});
