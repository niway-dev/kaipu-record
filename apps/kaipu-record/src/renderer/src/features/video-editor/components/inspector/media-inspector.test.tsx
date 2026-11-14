import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ImageMediaItem } from "../../scene";
import { MediaInspector } from "./media-inspector";

const item: ImageMediaItem = {
  id: "m",
  kind: "image",
  assetId: "asset",
  naturalWidth: 1600,
  naturalHeight: 900,
  anchor: { kind: "source", time: 0 },
  duration: 10,
  box: { x: 0.5, y: 0.5, width: 1 },
  z: 0,
  fadeInMs: 200,
  fadeOutMs: 300,
};

function renderPanel(props: Partial<React.ComponentProps<typeof MediaInspector>> = {}) {
  const handlers = {
    onDuration: vi.fn(),
    onFull: vi.fn(),
    onBox: vi.fn(),
    onBringForward: vi.fn(),
    onSendBackward: vi.fn(),
    onFades: vi.fn(),
    onDelete: vi.fn(),
  };
  const view = render(
    <MediaInspector
      item={item}
      seconds={10}
      canBringForward
      canSendBackward
      {...handlers}
      {...props}
    />,
  );
  return { ...handlers, rerender: view.rerender };
}

describe("MediaInspector", () => {
  it("each button is one action", () => {
    const h = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Full" }));
    fireEvent.click(screen.getByRole("button", { name: "Box" }));
    fireEvent.click(screen.getByRole("button", { name: "Bring forward" }));
    fireEvent.click(screen.getByRole("button", { name: "Send backward" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete this floating image" }));
    expect(h.onFull).toHaveBeenCalledOnce();
    expect(h.onBox).toHaveBeenCalledOnce();
    expect(h.onBringForward).toHaveBeenCalledOnce();
    expect(h.onSendBackward).toHaveBeenCalledOnce();
    expect(h.onDelete).toHaveBeenCalledOnce();
  });

  it("disables Bring forward and Send backward when there is nothing to pass", () => {
    renderPanel({ canBringForward: false, canSendBackward: false });
    expect(screen.getByRole("button", { name: "Bring forward" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send backward" })).toBeDisabled();
  });

  it("shows the stored values and commits a fade once, when the field is left", () => {
    const h = renderPanel();
    const fadeIn = screen.getByLabelText("Fade in (ms)") as HTMLInputElement;
    expect(fadeIn.value).toBe("200");
    expect((screen.getByLabelText("Fade out (ms)") as HTMLInputElement).value).toBe("300");
    fireEvent.change(fadeIn, { target: { value: "5" } });
    fireEvent.change(fadeIn, { target: { value: "500" } });
    expect(h.onFades).not.toHaveBeenCalled();
    fireEvent.blur(fadeIn);
    expect(h.onFades).toHaveBeenCalledOnce();
    expect(h.onFades).toHaveBeenCalledWith({ fadeInMs: 500 });
  });

  it("clamps a fade to 0-2000 ms and commits the duration in seconds on Enter", () => {
    const h = renderPanel();
    const fadeOut = screen.getByLabelText("Fade out (ms)");
    fireEvent.change(fadeOut, { target: { value: "9000" } });
    fireEvent.blur(fadeOut);
    expect(h.onFades).toHaveBeenCalledWith({ fadeOutMs: 2000 });
    const duration = screen.getByLabelText("Duration (s)");
    fireEvent.change(duration, { target: { value: "0.1" } });
    fireEvent.keyDown(duration, { key: "Enter" });
    expect(h.onDuration).toHaveBeenCalledWith(0.5);
  });

  it("commits nothing when a field is left unchanged or emptied", () => {
    const h = renderPanel();
    const fadeIn = screen.getByLabelText("Fade in (ms)") as HTMLInputElement;
    fireEvent.blur(fadeIn);
    fireEvent.change(fadeIn, { target: { value: "" } });
    fireEvent.blur(fadeIn);
    expect(h.onFades).not.toHaveBeenCalled();
    expect(fadeIn.value).toBe("200");
  });

  it("shows what the scene holds when a commit leaves the stored value as it was", () => {
    // The item already reaches the end of the video: typing 20 asks for more, the page clamps
    // it, and `seconds` stays 12. The field must go back to 12, not keep the typed 20.
    const h = renderPanel({ seconds: 12 });
    const duration = screen.getByLabelText("Duration (s)") as HTMLInputElement;
    fireEvent.change(duration, { target: { value: "20" } });
    fireEvent.blur(duration);
    expect(h.onDuration).toHaveBeenCalledWith(20);
    expect(duration.value).toBe("12");
  });

  it("shows the stored fade when a typed decimal rounds back to it", () => {
    // The scene rounds a fade to whole milliseconds, so 100.4 is stored as 100 and `value`
    // does not change; the field must say 100.
    const h = renderPanel({ item: { ...item, fadeInMs: 100 } });
    const fadeIn = screen.getByLabelText("Fade in (ms)") as HTMLInputElement;
    fireEvent.change(fadeIn, { target: { value: "100.4" } });
    fireEvent.blur(fadeIn);
    expect(h.onFades).toHaveBeenCalledWith({ fadeInMs: 100.4 });
    expect(fadeIn.value).toBe("100");
  });

  it("does not carry typed text over to another image with the same values", () => {
    const h = renderPanel();
    fireEvent.change(screen.getByLabelText("Duration (s)"), { target: { value: "7" } });
    // Another image is selected without the field being left first: same duration, same fades.
    h.rerender(
      <MediaInspector
        item={{ ...item, id: "other" }}
        seconds={10}
        canBringForward
        canSendBackward
        {...h}
      />,
    );
    expect((screen.getByLabelText("Duration (s)") as HTMLInputElement).value).toBe("10");
  });
});
