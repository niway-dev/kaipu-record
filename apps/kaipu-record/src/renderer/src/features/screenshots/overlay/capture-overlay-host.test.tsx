import { useEffect } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { OverlayState } from "@shared/types/screenshot-capture";
import type { CaptureOverlayApi } from "./capture-overlay";
import { CaptureOverlayHost } from "./capture-overlay-host";
import type { OverlayQuery } from "./overlay-query";

// The overlay itself is tested in capture-overlay.test.tsx; here only when it is mounted.
const mounts = vi.hoisted(() => ({ count: 0 }));
vi.mock("./capture-overlay", () => ({
  CaptureOverlay: ({ initialState }: { initialState?: OverlayState }) => {
    useEffect(() => {
      mounts.count += 1;
    }, []);
    return <div data-testid="overlay" data-session={String(initialState?.session)} />;
  },
}));

const QUERY: OverlayQuery = {
  displayId: 1,
  ui: "frame",
  index: 1,
  count: 1,
  bounds: { x: 0, y: 0, width: 100, height: 100 },
  work: { x: 0, y: 0, width: 100, height: 100 },
  ids: [1],
  frame: null,
  internal: false,
  intent: "capture",
  spare: true,
};

const stateOf = (session: number, patch: Partial<OverlayState> = {}): OverlayState => ({
  session,
  mode: "frame",
  hoverDisplayId: null,
  frameDisplayId: 1,
  windows: null,
  ...patch,
});

function fakeApi() {
  let onState: ((state: OverlayState) => void) | null = null;
  let onReset: (() => void) | null = null;
  const api = {
    captureOverlay: {
      onState: vi.fn((cb: (state: OverlayState) => void) => {
        onState = cb;
        return () => {
          onState = null;
        };
      }),
      onReset: vi.fn((cb: () => void) => {
        onReset = cb;
        return () => {
          onReset = null;
        };
      }),
      requestState: vi.fn(),
    },
  } as unknown as CaptureOverlayApi;
  return {
    api,
    requestState: (api.captureOverlay as unknown as { requestState: ReturnType<typeof vi.fn> })
      .requestState,
    state: (state: OverlayState) => act(() => onState?.(state)),
    reset: () => act(() => onReset?.()),
  };
}

afterEach(() => {
  cleanup();
  mounts.count = 0;
});

describe("CaptureOverlayHost", () => {
  it("paints nothing until main sends a state, then mounts the overlay with it", () => {
    const fake = fakeApi();
    render(<CaptureOverlayHost query={QUERY} api={fake.api} />);

    expect(screen.queryByTestId("overlay")).toBeNull();
    expect(fake.requestState).toHaveBeenCalled();

    fake.state(stateOf(1));
    expect(screen.getByTestId("overlay").dataset.session).toBe("1");
  });

  it("keeps the overlay across state updates of the same pick", () => {
    const fake = fakeApi();
    render(<CaptureOverlayHost query={QUERY} api={fake.api} />);

    fake.state(stateOf(1));
    fake.state(stateOf(1, { hoverDisplayId: 1 }));
    fake.state(stateOf(1, { mode: "screen", frameDisplayId: null }));

    expect(mounts.count).toBe(1);
  });

  it("treats states without a session id as one pick: no remount between them", () => {
    const fake = fakeApi();
    render(<CaptureOverlayHost query={QUERY} api={fake.api} />);

    fake.state({ ...stateOf(1), session: undefined });
    fake.state({ ...stateOf(1, { hoverDisplayId: 1 }), session: undefined });

    expect(mounts.count).toBe(1);
  });

  it("mounts a fresh overlay when the window serves a new pick, so nothing of the last one survives", () => {
    const fake = fakeApi();
    render(<CaptureOverlayHost query={QUERY} api={fake.api} />);

    fake.state(stateOf(1));
    fake.state(stateOf(2, { mode: "screen", frameDisplayId: null }));

    expect(mounts.count).toBe(2);
    expect(screen.getByTestId("overlay").dataset.session).toBe("2");
  });

  it("drops the overlay when main resets the window after the pick ended", () => {
    const fake = fakeApi();
    render(<CaptureOverlayHost query={QUERY} api={fake.api} />);
    fake.state(stateOf(1));

    fake.reset();
    expect(screen.queryByTestId("overlay")).toBeNull();

    fake.state(stateOf(2));
    expect(screen.getByTestId("overlay").dataset.session).toBe("2");
  });

  it("mounts a window that was not loaded ahead at once, from its query", () => {
    const fake = fakeApi();
    render(<CaptureOverlayHost query={{ ...QUERY, spare: false }} api={fake.api} />);

    expect(screen.getByTestId("overlay")).toBeTruthy();
  });
});
