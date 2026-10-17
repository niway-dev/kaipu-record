import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import type { CaptureRect, OverlayState } from "@shared/types/screenshot-capture";
import { CaptureOverlay, HIDDEN_ACK_FALLBACK_MS, type CaptureOverlayApi } from "./capture-overlay";
import type { OverlayQuery } from "./overlay-query";

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
    ...overrides,
  };
}

function fakeApi(frames: Record<string, CaptureRect> = {}) {
  let settings: AppSettings = { ...DEFAULT_SETTINGS, screenshotFrame: frames };
  let stateListener: ((state: OverlayState) => void) | null = null;
  let ackListener: (() => void) | null = null;
  const api = {
    captureOverlay: {
      answer: vi.fn(),
      hover: vi.fn(),
      onState: vi.fn((cb: (state: OverlayState) => void) => {
        stateListener = cb;
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
  } satisfies CaptureOverlayApi;
  return {
    api,
    answer: api.captureOverlay.answer,
    pushState: (state: OverlayState) => act(() => stateListener?.(state)),
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
    const { api, answer } = fakeApi();
    render(<CaptureOverlay query={query("screen")} api={api} />);

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
    const { api, requestHiddenAck } = fakeApi();
    render(<CaptureOverlay query={query("area")} api={api} />);

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
      const { api, requestHiddenAck } = fakeApi();
      render(<CaptureOverlay query={query("area")} api={api} />);

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

describe("ScreenChooser", () => {
  it("labels this display with its number", () => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query("screen")} api={api} />);
    expect(screen.getByRole("button", { name: "Capture this display · 2" })).toBeInTheDocument();
  });

  it("answers display 2 when 2 is pressed on display 1's overlay", () => {
    const { api, answer } = fakeApi();
    // Display 1 (id 7) has keyboard focus; display 2 is id 42.
    render(<CaptureOverlay query={query("screen", { displayId: 7, index: 1 })} api={api} />);

    press("2");
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "display", displayId: 42 });
  });

  it("ignores digits past the display count and digits with a modifier", () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay query={query("screen")} api={api} />);

    press("4");
    press("0");
    press("1", { metaKey: true });
    press("1", { ctrlKey: true });
    expect(answer).not.toHaveBeenCalled();

    press("3");
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "display", displayId: 9 });
  });

  it("answers this display on a click", () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay query={query("screen")} api={api} />);
    fireEvent.click(screen.getByRole("button", { name: /capture this display/i }));
    expect(answer).toHaveBeenCalledExactlyOnceWith({ kind: "display", displayId: 42 });
  });

  it("reports hover once and highlights only when main says this display is hovered", () => {
    const { api, pushState } = fakeApi();
    const { container } = render(<CaptureOverlay query={query("screen")} api={api} />);
    const sheet = container.firstElementChild as HTMLElement;

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
    const { api, pushState } = fakeApi();
    const { container } = render(<CaptureOverlay query={query("screen")} api={api} />);
    const sheet = container.firstElementChild as HTMLElement;

    fireEvent.pointerEnter(sheet);
    pushState({ hoverDisplayId: 42 });
    // Another display's "left" reached main after our "entered".
    pushState({ hoverDisplayId: null });
    fireEvent.pointerMove(sheet);

    expect(api.captureOverlay.hover.mock.calls).toEqual([[42], [42]]);
  });
});

describe("FrameBox", () => {
  it("opens on the remembered frame and answers it, display-relative, on Enter", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const other = { x: 0, y: 0, width: 50, height: 50 };
    const { api, answer } = fakeApi({ "42": remembered, "7": other });
    render(<CaptureOverlay query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual(remembered);
    expect(screen.getByText("400 × 300")).toBeInTheDocument();

    press("Enter");
    await waitFor(() =>
      expect(answer).toHaveBeenCalledExactlyOnceWith({
        kind: "rect",
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
    render(<CaptureOverlay query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual({ x: 800, y: 400, width: 800, height: 600 });
  });

  it("shrinks a remembered frame larger than the work area to fit it", async () => {
    const { api } = fakeApi({ "42": { x: 0, y: 0, width: 2400, height: 1200 } });
    render(<CaptureOverlay query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual({ x: 0, y: 25, width: 1600, height: 975 });
  });

  it("opens on a centered third of the display when nothing is remembered", async () => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query("frame")} api={api} />);

    await screen.findByTestId("capture-frame");
    expect(frameGeometry()).toEqual({ x: 533, y: 333, width: 533, height: 333 });
  });

  it("moves with a body drag and answers the moved frame from the Capture button", async () => {
    const { api, answer } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    const { container } = render(<CaptureOverlay query={query("frame")} api={api} />);
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
        displayId: 42,
        rect: { x: 150, y: 140, width: 400, height: 300 },
      }),
    );
  });

  it("resizes from a corner handle, never past the work area", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    const { container } = render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const sheet = container.firstElementChild as HTMLElement;

    // The north-west corner, dragged above the menu bar: the top edge stops at y = 25.
    fireEvent.pointerDown(sheet, { button: 0, clientX: 101, clientY: 121 });
    fireEvent.pointerMove(sheet, { clientX: 60, clientY: 0 });
    fireEvent.pointerUp(sheet, { clientX: 60, clientY: 0 });
    expect(frameGeometry()).toEqual({ x: 60, y: 25, width: 440, height: 395 });
  });

  it("sends one answer when Esc follows Enter", async () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    press("Enter");
    press("Escape");
    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalled());
    expect(answer).toHaveBeenCalledOnce();
    expect(answer.mock.calls[0]![0]).toMatchObject({ kind: "rect" });
    expect(api.updateSettings).toHaveBeenCalledOnce();
  });

  it("still answers when remembering the frame fails", async () => {
    const { api, answer } = fakeApi();
    api.updateSettings.mockRejectedValueOnce(new Error("disk full"));
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
  });
});

describe("AreaDrag", () => {
  it("answers the dragged rectangle on release", () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay query={query("area")} api={api} />);
    const sheet = screen.getByTestId("capture-area");

    fireEvent.pointerDown(sheet, { button: 0, clientX: 300, clientY: 250 });
    fireEvent.pointerMove(sheet, { clientX: 100, clientY: 100 });
    expect(screen.getByText("200 × 150")).toBeInTheDocument();
    fireEvent.pointerUp(sheet, { clientX: 100, clientY: 100 });

    expect(answer).toHaveBeenCalledExactlyOnceWith({
      kind: "rect",
      displayId: 42,
      rect: { x: 100, y: 100, width: 200, height: 150 },
    });
  });

  it("ignores a click that moves less than 4 px", () => {
    const { api, answer } = fakeApi();
    render(<CaptureOverlay query={query("area")} api={api} />);
    const sheet = screen.getByTestId("capture-area");

    fireEvent.pointerDown(sheet, { button: 0, clientX: 300, clientY: 250 });
    fireEvent.pointerUp(sheet, { clientX: 303, clientY: 247 });

    expect(answer).not.toHaveBeenCalled();
  });
});
