import React from "react";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { dirnameOf } from "../../../test/source-tree";
import { ImageActions } from "./image-actions";

// The Crop / Corners / Reset controls of a selected image (NIW2-876). One component serves the
// floating bar and the Tool tab, so what is pinned here holds in both.

function mount(over: Partial<React.ComponentProps<typeof ImageActions>> = {}) {
  const props = {
    variant: "bar" as const,
    imageId: "a",
    hasCrop: false,
    followRadius: 12,
    maxRadius: 200,
    onCrop: vi.fn(),
    onMove: vi.fn(),
    onResetCrop: vi.fn(),
    onRadius: vi.fn(),
    ...over,
  };
  render(<ImageActions {...props} />);
  return props;
}

describe.each(["bar", "panel"] as const)("ImageActions (%s)", (variant) => {
  const move = () => screen.getByRole("radio", { name: "Move" });
  const crop = () => screen.getByRole("radio", { name: "Crop" });

  it("offers a Move | Crop mode control, Corners and Reset", () => {
    mount({ variant });
    expect(screen.getByRole("radiogroup", { name: "Image mode" })).toBeInTheDocument();
    expect(move()).toBeInTheDocument();
    expect(crop()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corners" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("starts in Move: Move is checked, Crop is not", () => {
    mount({ variant });
    expect(move()).toHaveAttribute("aria-checked", "true");
    expect(crop()).toHaveAttribute("aria-checked", "false");
  });

  it("in crop mode Crop is the checked segment and Move is not", () => {
    mount({ variant, cropping: true });
    expect(crop()).toHaveAttribute("aria-checked", "true");
    expect(move()).toHaveAttribute("aria-checked", "false");
  });

  it("choosing Crop enters crop mode", () => {
    const p = mount({ variant });
    fireEvent.click(crop());
    expect(p.onCrop).toHaveBeenCalledTimes(1);
    expect(p.onMove).not.toHaveBeenCalled();
  });

  it("choosing Move leaves crop mode, like Done", () => {
    const p = mount({ variant, cropping: true });
    fireEvent.click(move());
    expect(p.onMove).toHaveBeenCalledTimes(1);
    expect(p.onCrop).not.toHaveBeenCalled();
  });

  it("choosing the segment that is already active does nothing", () => {
    const idle = mount({ variant });
    fireEvent.click(move());
    expect(idle.onMove).not.toHaveBeenCalled();
    expect(idle.onCrop).not.toHaveBeenCalled();
  });

  it("is operated from the keyboard: the arrow keys move between the segments", () => {
    const p = mount({ variant });
    // Only the checked segment is in the tab order (roving tabindex).
    expect(move()).toHaveAttribute("tabindex", "0");
    expect(crop()).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(move(), { key: "ArrowRight" });
    expect(p.onCrop).toHaveBeenCalledTimes(1);
  });

  it("ArrowLeft from Crop chooses Move", () => {
    const p = mount({ variant, cropping: true });
    fireEvent.keyDown(crop(), { key: "ArrowLeft" });
    expect(p.onMove).toHaveBeenCalledTimes(1);
  });

  it("the arrow keys wrap: ArrowRight or ArrowDown on Crop goes to Move", () => {
    for (const key of ["ArrowRight", "ArrowDown"]) {
      const p = mount({ variant, cropping: true });
      fireEvent.keyDown(crop(), { key });
      expect(p.onMove).toHaveBeenCalledTimes(1);
      expect(p.onCrop).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("the arrow keys wrap: ArrowLeft or ArrowUp on Move goes to Crop", () => {
    for (const key of ["ArrowLeft", "ArrowUp"]) {
      const p = mount({ variant });
      fireEvent.keyDown(move(), { key });
      expect(p.onCrop).toHaveBeenCalledTimes(1);
      expect(p.onMove).not.toHaveBeenCalled();
      cleanup();
    }
  });

  it("Reset is disabled with no crop and asks to reset with one", () => {
    const none = mount({ variant, hasCrop: false });
    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(none.onResetCrop).not.toHaveBeenCalled();
  });

  it("Reset asks to reset when the image has a crop", () => {
    const p = mount({ variant, hasCrop: true });
    fireEvent.click(screen.getByRole("button", { name: "Reset" }));
    expect(p.onResetCrop).toHaveBeenCalledTimes(1);
  });
});

describe("the mode control's look", () => {
  const css = readFileSync(join(dirnameOf(import.meta.url), "image-actions.module.css"), "utf8");
  const rule = (selector: string): string => {
    const at = css.indexOf(selector);
    return at < 0 ? "" : (css.slice(at).match(/\{([^}]*)\}/)?.[1] ?? "");
  };

  it("the idle Crop segment carries no accent: only the checked segment is pink", () => {
    // The base segment rule is neutral; the accent lives on the checked one only.
    expect(rule(".segment {")).not.toMatch(/--ie-accent/);
    expect(rule('.segment[aria-checked="true"]')).toMatch(/background:\s*var\(--ie-accent\)/);
  });

  it("the floating bar's hover and track use the always-dark overlay tints, not the themed ones", () => {
    // `--ie-card` is white and `--ie-sep` a 9% black in the light theme: light text on them is
    // unreadable on the dark pill. The overlay tints stay light-on-dark in both themes.
    expect(rule('.segment:hover:not([aria-checked="true"]) {')).toMatch(/--ie-ov-hover/);
    expect(rule(".modes {")).toMatch(/--ie-ov-track/);
    expect(rule(".button:hover:not(:disabled)")).toMatch(/--ie-ov-hover/);
    // The Tool tab sits on themed chrome and keeps the themed tokens.
    expect(rule(".panel .segment:hover:not")).toMatch(/--ie-card/);
    expect(rule(".panel .modes {")).toMatch(/--ie-sep/);
  });

  it("the old always-pink Crop button is gone", () => {
    expect(css).not.toMatch(/\.primary/);
  });
});

describe("Corners", () => {
  it("opens a control that shows what the slider gives while the image follows it", () => {
    mount();
    expect(screen.queryByTestId("corners-control")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Corners" }));
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("12");
    expect(screen.getByText("Follows the Beautify slider")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Follow slider" })).toBeDisabled();
  });

  it("commits the typed radius, in source px, when the field is left", () => {
    const p = mount();
    fireEvent.click(screen.getByRole("button", { name: "Corners" }));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "40" } });
    expect(p.onRadius).not.toHaveBeenCalled();
    fireEvent.blur(input);
    expect(p.onRadius).toHaveBeenCalledWith(40);
  });

  it("clamps the radius to the image's half side", () => {
    const p = mount({ maxRadius: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Corners" }));
    const input = screen.getByRole("spinbutton");
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.blur(input);
    expect(p.onRadius).toHaveBeenCalledWith(50);
  });

  it("an own radius shows its value, and Follow slider returns it to the slider", () => {
    const p = mount({ radius: 30 });
    fireEvent.click(screen.getByRole("button", { name: "Corners" }));
    expect((screen.getByRole("spinbutton") as HTMLInputElement).value).toBe("30");
    fireEvent.click(screen.getByRole("button", { name: "Follow slider" }));
    expect(p.onRadius).toHaveBeenCalledWith(undefined);
  });

  it("leaving the field alone keeps following even when the slider's radius exceeds the limit", () => {
    const p = mount({ followRadius: 80, maxRadius: 50 });
    fireEvent.click(screen.getByRole("button", { name: "Corners" }));
    const input = screen.getByRole("spinbutton") as HTMLInputElement;
    expect(input.value).toBe("50");
    fireEvent.blur(input);
    expect(p.onRadius).not.toHaveBeenCalled();
  });

  it("leaving the field unchanged commits nothing", () => {
    const p = mount({ radius: 30 });
    fireEvent.click(screen.getByRole("button", { name: "Corners" }));
    fireEvent.blur(screen.getByRole("spinbutton"));
    expect(p.onRadius).not.toHaveBeenCalled();
  });
});

describe("switching the selected image", () => {
  it.each(["bar", "panel"] as const)(
    "an uncommitted Corners value never reaches the next image (%s)",
    (variant) => {
      const base = {
        variant,
        hasCrop: false,
        followRadius: 12,
        maxRadius: 200,
        onCrop: vi.fn(),
        onMove: vi.fn(),
        onResetCrop: vi.fn(),
      };
      const onA = vi.fn();
      const onB = vi.fn();
      const { rerender } = render(<ImageActions {...base} imageId="a" onRadius={onA} />);
      fireEvent.click(screen.getByRole("button", { name: "Corners" }));
      const field = screen.getByRole("spinbutton");
      fireEvent.change(field, { target: { value: "20" } });
      // Another image with the same shown radius is selected before the field is committed.
      rerender(<ImageActions {...base} imageId="b" onRadius={onB} />);
      expect(screen.queryByTestId("corners-control")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "Corners" }));
      const next = screen.getByRole("spinbutton") as HTMLInputElement;
      expect(next.value).toBe("12");
      fireEvent.blur(next);
      expect(onB).not.toHaveBeenCalled();
      expect(onA).not.toHaveBeenCalled();
    },
  );
});
