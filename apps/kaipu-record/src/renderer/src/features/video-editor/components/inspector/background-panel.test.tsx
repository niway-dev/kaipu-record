import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BACKGROUND_IDS } from "@renderer/features/screenshots/beautify/backgrounds";
import type { VideoBackground } from "../../background";
import { initialScene } from "../../scene";
import type { BackgroundEditing } from "../../use-background-editing";
import { useBackgroundEditing } from "../../use-background-editing";
import { useVideoScene } from "../../use-video-scene";
import { BackgroundPanel } from "./background-panel";

const MAGENTA: VideoBackground = { bg: "magenta", padding: 48, radius: 16, shadow: 24 };

function edits(background: VideoBackground, partial: Partial<BackgroundEditing> = {}) {
  return {
    background,
    choose: vi.fn(),
    commit: vi.fn(),
    begin: vi.fn(),
    live: vi.fn(),
    end: vi.fn(),
    ...partial,
  } satisfies BackgroundEditing;
}

describe("BackgroundPanel", () => {
  it("shows the eighteen swatches of the screenshot editor, by their names", () => {
    render(<BackgroundPanel edits={edits(MAGENTA)} />);
    const section = screen.getByRole("region", { name: "Background" });
    const buttons = within(section).getAllByRole("button");
    expect(buttons).toHaveLength(18);
    expect(BACKGROUND_IDS).toHaveLength(18);
    for (const name of [
      "None",
      "Dark",
      "Carbon",
      "White",
      "Magenta",
      "Purple",
      "Ocean",
      "Sunset",
      "Forest",
      "Graphite",
      "Aurora",
      "Iris",
      "Coral",
      "Lilac",
      "Citrus",
      "Ember",
      "Sky",
      "Dusk",
    ]) {
      expect(within(section).getByRole("button", { name })).toBeInTheDocument();
    }
  });

  it("marks the chosen swatch", () => {
    render(<BackgroundPanel edits={edits(MAGENTA)} />);
    expect(screen.getByRole("button", { name: "Magenta" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "false");
  });

  it("has padding, corners and shadow sliders over the screenshot editor's ranges", () => {
    render(<BackgroundPanel edits={edits(MAGENTA)} />);
    const padding = screen.getByRole("slider", { name: "Padding" });
    expect(padding).toHaveAttribute("min", "0");
    expect(padding).toHaveAttribute("max", "96");
    expect(padding).toHaveValue("48");
    expect(screen.getByRole("slider", { name: "Corners" })).toHaveAttribute("max", "28");
    expect(screen.getByRole("slider", { name: "Corners" })).toHaveValue("16");
    expect(screen.getByRole("slider", { name: "Shadow" })).toHaveAttribute("max", "100");
    expect(screen.getByRole("slider", { name: "Shadow" })).toHaveValue("24");
  });

  it("disables the sliders while the background is none, with the hint", () => {
    render(<BackgroundPanel edits={edits({ bg: "none", padding: 48, radius: 16, shadow: 24 })} />);
    for (const name of ["Padding", "Corners", "Shadow"]) {
      expect(screen.getByRole("slider", { name })).toBeDisabled();
    }
    expect(screen.getByText(/Pick a background/)).toBeInTheDocument();
  });

  it("enables them with a preset, and says the original is untouched", () => {
    render(<BackgroundPanel edits={edits(MAGENTA)} />);
    for (const name of ["Padding", "Corners", "Shadow"]) {
      expect(screen.getByRole("slider", { name })).toBeEnabled();
    }
    expect(screen.getByText(/original recording on disk is not changed/)).toBeInTheDocument();
  });

  it("is the default look with none and zeros: swatch None chosen, sliders at 0", () => {
    render(<BackgroundPanel edits={edits({ bg: "none", padding: 0, radius: 0, shadow: 0 })} />);
    expect(screen.getByRole("button", { name: "None" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("slider", { name: "Padding" })).toHaveValue("0");
  });

  it("sends a swatch click to choose", () => {
    const e = edits({ bg: "none", padding: 0, radius: 0, shadow: 0 });
    render(<BackgroundPanel edits={e} />);
    fireEvent.click(screen.getByRole("button", { name: "Ocean" }));
    expect(e.choose).toHaveBeenCalledWith("ocean");
  });

  // The slider coalesces live updates to one per animation frame (NIW2-662), so a drag's value
  // reaches `live` on the next frame, not inside the change event.
  it("sends a keyboard step to commit and a drag to begin / live / end", async () => {
    const e = edits(MAGENTA);
    render(<BackgroundPanel edits={e} />);
    const padding = screen.getByRole("slider", { name: "Padding" });
    fireEvent.change(padding, { target: { value: "49" } });
    expect(e.commit).toHaveBeenCalledWith({ padding: 49 });
    fireEvent.pointerDown(padding, { pointerId: 1 });
    expect(e.begin).toHaveBeenCalled();
    fireEvent.change(padding, { target: { value: "60" } });
    await waitFor(() => expect(e.live).toHaveBeenCalledWith({ padding: 60 }));
    fireEvent.pointerUp(padding, { pointerId: 1 });
    expect(e.end).toHaveBeenCalled();
  });

  it("releasing before the frame still delivers the last value to live, before end", () => {
    const e = edits(MAGENTA);
    render(<BackgroundPanel edits={e} />);
    const padding = screen.getByRole("slider", { name: "Padding" });
    fireEvent.pointerDown(padding, { pointerId: 1 });
    fireEvent.change(padding, { target: { value: "70" } });
    fireEvent.pointerUp(padding, { pointerId: 1 });
    expect(e.live).toHaveBeenLastCalledWith({ padding: 70 });
    expect(e.end).toHaveBeenCalledTimes(1);
    expect(vi.mocked(e.begin).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(e.live).mock.invocationCallOrder[0],
    );
    expect(vi.mocked(e.live).mock.invocationCallOrder.at(-1)!).toBeLessThan(
      vi.mocked(e.end).mock.invocationCallOrder[0],
    );
  });

  it("declares the UI area the catalog crops (ADR 0046)", () => {
    const { container } = render(<BackgroundPanel edits={edits(MAGENTA)} />);
    expect(container.querySelector('[data-ui-area="editorVideo.background"]')).not.toBeNull();
  });
});

describe("BackgroundPanel with the real scene history", () => {
  function harness() {
    const hook = renderHook(() => {
      const controller = useVideoScene(initialScene(10));
      return { controller, edits: useBackgroundEditing(controller) };
    });
    const view = () => render(<BackgroundPanel edits={hook.result.current.edits} />);
    return { hook, view };
  }

  it("picking magenta then dragging padding is two undo steps, and undo restores each", () => {
    const { hook, view } = harness();
    const { rerender } = view();
    const redraw = () => rerender(<BackgroundPanel edits={hook.result.current.edits} />);
    fireEvent.click(screen.getByRole("button", { name: "Magenta" }));
    redraw();
    expect(screen.getByRole("slider", { name: "Padding" })).toBeEnabled();
    const padding = screen.getByRole("slider", { name: "Padding" });
    fireEvent.pointerDown(padding, { pointerId: 1 });
    redraw();
    fireEvent.change(screen.getByRole("slider", { name: "Padding" }), { target: { value: "48" } });
    redraw();
    fireEvent.pointerUp(screen.getByRole("slider", { name: "Padding" }), { pointerId: 1 });
    redraw();
    expect(hook.result.current.edits.background).toEqual({
      bg: "magenta",
      padding: 48,
      radius: 10,
      shadow: 64,
    });
    act(() => hook.result.current.controller.undo());
    expect(hook.result.current.edits.background).toEqual({
      bg: "magenta",
      padding: 60,
      radius: 10,
      shadow: 64,
    });
    act(() => hook.result.current.controller.undo());
    expect(hook.result.current.edits.background.bg).toBe("none");
  });
});
