import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageActions } from "./image-actions";

// The Crop / Corners / Reset controls of a selected image (NIW2-876). One component serves the
// floating bar and the Tool tab, so what is pinned here holds in both.

function mount(over: Partial<React.ComponentProps<typeof ImageActions>> = {}) {
  const props = {
    variant: "bar" as const,
    hasCrop: false,
    followRadius: 12,
    maxRadius: 200,
    onCrop: vi.fn(),
    onResetCrop: vi.fn(),
    onRadius: vi.fn(),
    ...over,
  };
  render(<ImageActions {...props} />);
  return props;
}

describe.each(["bar", "panel"] as const)("ImageActions (%s)", (variant) => {
  it("offers Crop, Corners and Reset", () => {
    mount({ variant });
    expect(screen.getByRole("button", { name: "Crop" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Corners" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reset" })).toBeInTheDocument();
  });

  it("Crop asks to crop", () => {
    const p = mount({ variant });
    fireEvent.click(screen.getByRole("button", { name: "Crop" }));
    expect(p.onCrop).toHaveBeenCalledTimes(1);
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
