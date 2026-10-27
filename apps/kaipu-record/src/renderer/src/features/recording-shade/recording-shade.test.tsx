import { act, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { CountdownOverlay } from "@renderer/features/recording/components/countdown-overlay";
import type { RecordingShadeState } from "@shared/types/ipc";
import { parseShadeRect, parseShadeState, RecordingShade } from "./recording-shade";

const RECT = { x: 100, y: 50, width: 640, height: 360 };

function fakeApi() {
  let listener: ((state: RecordingShadeState) => void) | null = null;
  return {
    api: {
      onRecordingShadeState: vi.fn((callback: (state: RecordingShadeState) => void) => {
        listener = callback;
        return () => {
          listener = null;
        };
      }),
    },
    push: (state: RecordingShadeState) => act(() => listener?.(state)),
  };
}

describe("parseShadeRect", () => {
  it("reads the clear area from the query", () => {
    expect(parseShadeRect("?window=recording-shade&rect=100,50,640,360")).toEqual(RECT);
  });

  it("answers null for a missing or malformed rect", () => {
    expect(parseShadeRect("?window=recording-shade")).toBeNull();
    expect(parseShadeRect("?rect=1,2,3")).toBeNull();
    expect(parseShadeRect("?rect=1,2,0,4")).toBeNull();
  });
});

describe("parseShadeState", () => {
  it("reads a countdown tick, and recording otherwise", () => {
    expect(parseShadeState("?phase=countdown&value=3")).toEqual({ phase: "countdown", value: 3 });
    expect(parseShadeState("?phase=countdown")).toEqual({ phase: "countdown", value: null });
    expect(parseShadeState("?phase=recording")).toEqual({ phase: "recording" });
    expect(parseShadeState("")).toEqual({ phase: "recording" });
  });
});

describe("RecordingShade", () => {
  it("while an area records: keeps the dark shade around a clear area, with the pink border and tag", () => {
    const { api } = fakeApi();
    render(<RecordingShade rect={RECT} api={api} />);
    const area = screen.getByTestId("recording-shade-area");
    expect(area.style.left).toBe("100px");
    expect(area.style.top).toBe("50px");
    expect(area.style.width).toBe("640px");
    expect(area.style.height).toBe("360px");
    // The border sits 3 px outside the area, its 2 px line included: 5 px out on each side.
    const border = screen.getByTestId("recording-shade-border");
    expect(border.style.left).toBe("95px");
    expect(border.style.width).toBe("650px");
    expect(screen.getByText("REC · BORDER NOT RECORDED")).toBeInTheDocument();
  });

  it("draws the tag inside the border when the area touches the top of the display", () => {
    const { api } = fakeApi();
    render(<RecordingShade rect={{ ...RECT, y: 0 }} api={api} />);
    expect(screen.getByTestId("recording-shade-border").dataset.tagInside).toBe("true");
  });

  it("while a whole display records: only a border around the display", () => {
    const { api } = fakeApi();
    render(<RecordingShade rect={null} api={api} />);
    expect(screen.getByTestId("recording-shade-display")).toBeInTheDocument();
    expect(screen.queryByTestId("recording-shade-area")).toBeNull();
    expect(screen.queryByText("REC · BORDER NOT RECORDED")).toBeNull();
  });

  it("counts down on the region, then turns into the recording marker", () => {
    const { api, push } = fakeApi();
    render(
      <RecordingShade rect={RECT} initialState={{ phase: "countdown", value: 3 }} api={api} />,
    );
    // The shared CountdownOverlay (the Record page's pink one), confined to the region,
    // with no Cancel button: the shade is click-through and Esc is global.
    const overlay = screen.getByRole("status");
    expect(overlay.style.left).toBe("100px");
    expect(overlay.style.width).toBe("640px");
    expect(screen.queryByRole("button", { name: /cancel/i })).toBeNull();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Recording starts… press Esc to cancel")).toBeInTheDocument();

    push({ phase: "countdown", value: 2 });
    expect(screen.getByText("2")).toBeInTheDocument();
    push({ phase: "countdown", value: null });
    expect(screen.queryByText("2")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();

    push({ phase: "recording" });
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByTestId("recording-shade-border")).toBeInTheDocument();
  });

  it("renders the number with the shared component's class, not a copy", () => {
    const { api } = fakeApi();
    const shade = render(
      <RecordingShade rect={RECT} initialState={{ phase: "countdown", value: 3 }} api={api} />,
    );
    const shadeClass = screen.getByText("3").className;
    shade.unmount();
    render(<CountdownOverlay value={3} onCancel={() => {}} />);
    expect(screen.getByText("3").className).toBe(shadeClass);
  });
});
