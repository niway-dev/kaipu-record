import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { DEFAULT_SETTINGS, type AppSettings } from "@shared/types";
import { defaultShortcutsFor } from "@shared/shortcut-defaults";
import type { CaptureRect, OverlayState } from "@shared/types/screenshot-capture";
import {
  BEFORE_SEND_TIMEOUT_MS,
  CaptureOverlay,
  HIDDEN_ACK_FALLBACK_MS,
  type CaptureOverlayApi,
} from "./capture-overlay";
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
    frame: null,
    ...overrides,
  };
}

/** Main's first state message, as it reaches an overlay: the frame is on display 42. */
const FRAME_ON_42: OverlayState = { hoverDisplayId: null, frameDisplayId: 42 };

function fakeApi(
  frames: Record<string, CaptureRect> = {},
  initialState: OverlayState | null = FRAME_ON_42,
) {
  let settings: AppSettings = {
    ...DEFAULT_SETTINGS,
    shortcuts: defaultShortcutsFor("darwin"),
    screenshotFrame: frames,
  };
  let state: OverlayState = initialState ?? { hoverDisplayId: null, frameDisplayId: null };
  let stateListener: ((state: OverlayState) => void) | null = null;
  let ackListener: (() => void) | null = null;
  const api = {
    captureOverlay: {
      answer: vi.fn(),
      hover: vi.fn(),
      chooseFrameDisplay: vi.fn(),
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
  } satisfies CaptureOverlayApi;
  return {
    api,
    answer: api.captureOverlay.answer,
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

describe("display label", () => {
  it.each(["area", "screen", "frame"] as const)("names the display on the %s overlay", (ui) => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query(ui)} api={api} />);
    expect(screen.getByText("Display 2")).toBeInTheDocument();
  });
});

describe("ScreenChooser", () => {
  it("labels this display with its number", () => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query("screen")} api={api} />);
    expect(screen.getByRole("button", { name: "Capture this display · 2" })).toBeInTheDocument();
  });

  it("shows the number tile and the display's DIP size in its pill", () => {
    const { api } = fakeApi();
    render(<CaptureOverlay query={query("screen")} api={api} />);
    const pill = screen.getByRole("button", { name: "Capture this display · 2" });
    expect(within(pill).getByText("2")).toBeInTheDocument();
    expect(within(pill).getByText("1600 × 1000")).toBeInTheDocument();
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
  it("draws the toolbar under the frame: Capture plus the key hint, centered", async () => {
    const { api } = fakeApi({ "42": { x: 100, y: 120, width: 400, height: 300 } });
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");
    const hint = screen.getByText("Enter to capture · Esc to cancel");
    const toolbar = hint.parentElement as HTMLElement;
    expect(within(toolbar).getByRole("button", { name: "Capture" })).toBeInTheDocument();
    // Centered on the frame (x 100 + 400 / 2), 10 DIP under its bottom edge (120 + 300).
    expect(toolbar.style.left).toBe("300px");
    expect(toolbar.style.top).toBe("430px");
  });

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

  it("sends one answer when Esc follows Enter: the pending persist does not block Esc", async () => {
    const { api, answer } = fakeApi();
    let finishPersist = (): void => {};
    api.updateSettings.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishPersist = () =>
            resolve({ ...DEFAULT_SETTINGS, shortcuts: defaultShortcutsFor("darwin") });
        }),
    );
    render(<CaptureOverlay query={query("frame")} api={api} />);
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
    render(<CaptureOverlay query={query("frame")} api={api} />);
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
    render(<CaptureOverlay query={query("frame")} api={api} />);
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
    render(<CaptureOverlay query={query("frame")} api={api} />);
    await screen.findByTestId("capture-frame");

    press("Enter");
    await waitFor(() => expect(answer).toHaveBeenCalledOnce());
  });
});

describe("Frame on several displays", () => {
  it("offers 'Click to move the frame here' on a display without the frame, and a click asks main", () => {
    const { api, chooseFrameDisplay, answer } = fakeApi({}, { ...FRAME_ON_42, frameDisplayId: 7 });
    render(<CaptureOverlay query={query("frame")} api={api} />);

    expect(screen.queryByTestId("capture-frame")).toBeNull();
    fireEvent.click(screen.getByText("Click to move the frame here"));

    expect(chooseFrameDisplay).toHaveBeenCalledExactlyOnceWith(42);
    expect(answer).not.toHaveBeenCalled();
  });

  it("moves the frame from the hint with Enter or Space, as a button", () => {
    const { api, chooseFrameDisplay } = fakeApi({}, { ...FRAME_ON_42, frameDisplayId: 7 });
    render(<CaptureOverlay query={query("frame")} api={api} />);
    const hint = screen.getByRole("button", { name: "Click to move the frame here" });

    fireEvent.keyDown(hint, { key: "Enter" });
    fireEvent.keyDown(hint, { key: " " });
    fireEvent.keyDown(hint, { key: "a" });

    expect(chooseFrameDisplay).toHaveBeenCalledTimes(2);
    expect(chooseFrameDisplay).toHaveBeenCalledWith(42);
  });

  it("renders from the query's frame display before any state arrives", async () => {
    const own = fakeApi({}, null);
    render(<CaptureOverlay query={query("frame", { frame: 42 })} api={own.api} />);
    await screen.findByTestId("capture-frame");
    cleanup();

    const other = fakeApi({}, null);
    render(<CaptureOverlay query={query("frame", { frame: 7 })} api={other.api} />);
    expect(screen.getByText("Click to move the frame here")).toBeTruthy();
    expect(screen.queryByTestId("capture-frame")).toBeNull();
  });

  it("shows only the dim sheet until main says where the frame is", () => {
    const { api } = fakeApi({}, { ...FRAME_ON_42, frameDisplayId: null });
    render(<CaptureOverlay query={query("frame")} api={api} />);

    expect(screen.queryByTestId("capture-frame")).toBeNull();
    expect(screen.queryByText("Click to move the frame here")).toBeNull();
  });

  it("renders the frame on its own display with that display's remembered geometry", async () => {
    const remembered = { x: 100, y: 120, width: 400, height: 300 };
    const { api } = fakeApi({ "42": remembered, "7": { x: 0, y: 25, width: 50, height: 50 } });
    render(<CaptureOverlay query={query("frame")} api={api} />);

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
          <CaptureOverlay query={query("frame", { displayId: 7 })} api={a.api} />
        </div>
        <div data-testid="overlay-42">
          <CaptureOverlay query={query("frame", { displayId: 42 })} api={b.api} />
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
        <CaptureOverlay query={query("frame")} api={active.api} />
        <CaptureOverlay query={query("frame", { displayId: 7, index: 1 })} api={idle.api} />
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
