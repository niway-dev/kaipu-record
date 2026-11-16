import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { WebcamPendingDrop } from "../webcam/use-webcam-drop";
import { webcamRoute } from "../webcam/webcam-route";
import { WebcamDropCard } from "./webcam-drop-card";

const FRAME = { width: 1920, height: 1080 };
/** The preview measures half the frame, so every frame pixel is half a CSS pixel. */
const PREVIEW = { width: 960, height: 540 };
const BOX = { width: 384, height: 384 };

const drop = (patch: Partial<WebcamPendingDrop> = {}): WebcamPendingDrop => ({
  position: { x: 0.75, y: 0.3 },
  sourceTime: 24,
  now: { x: 192, y: 880 },
  box: BOX,
  room: { start: 24, end: 34 },
  ...patch,
});

function renderCard(card: WebcamPendingDrop) {
  const handlers = { onPart: vi.fn(), onWhole: vi.fn(), onClose: vi.fn() };
  const view = render(<WebcamDropCard card={card} frame={FRAME} {...handlers} />);
  return { ...view, handlers };
}

const cardBox = (): HTMLElement => screen.getByRole("group");

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
    width: PREVIEW.width,
    height: PREVIEW.height,
    left: 0,
    top: 0,
    right: PREVIEW.width,
    bottom: PREVIEW.height,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  });
});
afterEach(() => vi.restoreAllMocks());

describe("WebcamDropCard", () => {
  it("asks 'Keep the camera here…' and offers a part with its real length and start time", () => {
    renderCard(drop());
    expect(screen.getByText("Keep the camera here…")).toBeInTheDocument();
    expect(screen.getByText("Only for this part")).toBeInTheDocument();
    expect(screen.getByText("10 s from 0:24, resizable.")).toBeInTheDocument();
    expect(screen.getByText("For the whole video")).toBeInTheDocument();
    expect(screen.getByText("Becomes the original position.")).toBeInTheDocument();
  });

  it("says the real length when the room is shorter than 10 s", () => {
    renderCard(drop({ sourceTime: 83, room: { start: 83, end: 91 } }));
    expect(screen.getByText("8 s from 1:23, resizable.")).toBeInTheDocument();
  });

  it("each choice and Close call their handler, Close with the 'Put it back (Esc)' tooltip", () => {
    const { handlers } = renderCard(drop());
    fireEvent.click(screen.getByRole("button", { name: /Only for this part/ }));
    fireEvent.click(screen.getByRole("button", { name: /For the whole video/ }));
    const close = screen.getByRole("button", { name: "Put it back (Esc)" });
    expect(close).toHaveAttribute("title", "Put it back (Esc)");
    fireEvent.click(close);
    expect(handlers.onPart).toHaveBeenCalledOnce();
    expect(handlers.onWhole).toHaveBeenCalledOnce();
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("with no room 'Only for this part' is disabled and reads 'No room left here.'", () => {
    const { handlers } = renderCard(drop({ room: null }));
    const part = screen.getByRole("button", { name: /Only for this part/ });
    expect(part).toBeDisabled();
    expect(part).toHaveTextContent("No room left here.");
    fireEvent.click(part);
    expect(handlers.onPart).not.toHaveBeenCalled();
    // The other answers stay available.
    expect(screen.getByRole("button", { name: /For the whole video/ })).toBeEnabled();
  });

  it("is 360 px wide, below a bubble in the upper half and above one in the lower half", () => {
    const { unmount } = renderCard(drop({ position: { x: 0.5, y: 0.2 } }));
    expect(cardBox().style.width).toBe("360px");
    const belowTop = parseFloat(cardBox().style.top);
    // y 0.2 of 540 = 108, bubble radius 96: the card starts under it.
    expect(belowTop).toBeCloseTo(108 + 96 + 12, 3);
    unmount();
    renderCard(drop({ position: { x: 0.5, y: 0.8 } }));
    const aboveTop = parseFloat(cardBox().style.top);
    // y 0.8 of 540 = 432: the card ends above the bubble (guess height 108).
    expect(aboveTop).toBeCloseTo(432 - 96 - 12 - 108, 3);
  });

  it("never leaves the preview: it shifts at the edges", () => {
    const { unmount } = renderCard(drop({ position: { x: 0.99, y: 0.02 } }));
    let left = parseFloat(cardBox().style.left);
    let top = parseFloat(cardBox().style.top);
    expect(left + 360).toBeLessThanOrEqual(PREVIEW.width - 12 + 1e-6);
    expect(top).toBeGreaterThanOrEqual(12);
    unmount();
    renderCard(drop({ position: { x: 0.01, y: 0.99 } }));
    left = parseFloat(cardBox().style.left);
    top = parseFloat(cardBox().style.top);
    expect(left).toBeGreaterThanOrEqual(12);
    expect(top + 108).toBeLessThanOrEqual(PREVIEW.height - 12 + 1e-6);
  });

  it("draws the route Now → New position with webcamRoute: the same curve the slide follows", () => {
    renderCard(drop());
    const end = { x: 0.75 * FRAME.width, y: 0.3 * FRAME.height };
    const reach = {
      minX: BOX.width / 2,
      maxX: FRAME.width - BOX.width / 2,
      minY: BOX.height / 2,
      maxY: FRAME.height - BOX.height / 2,
    };
    const route = webcamRoute({ x: 192, y: 880 }, end, FRAME, reach);
    const path = document.querySelector("svg path")!.getAttribute("d")!;
    const n = path.match(/-?\d+(\.\d+)?/g)!.map(Number);
    expect(n[0]).toBeCloseTo(route.start.x / 2, 6);
    expect(n[1]).toBeCloseTo(route.start.y / 2, 6);
    expect(n[2]).toBeCloseTo(route.control.x / 2, 6);
    expect(n[3]).toBeCloseTo(route.control.y / 2, 6);
    expect(n[4]).toBeCloseTo(route.end.x / 2, 6);
    expect(n[5]).toBeCloseTo(route.end.y / 2, 6);
    expect(screen.getByTestId("webcam-drop-arrow")).toBeInTheDocument();
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("New position")).toBeInTheDocument();
  });

  it("draws no route when the bubble would not move", () => {
    renderCard(drop({ now: { x: 0.75 * FRAME.width + 4, y: 0.3 * FRAME.height } }));
    expect(screen.queryByTestId("webcam-drop-arrow")).toBeNull();
    expect(screen.queryByText("Now")).toBeNull();
    // The card itself is still there.
    expect(screen.getByText("Keep the camera here…")).toBeInTheDocument();
  });
});
