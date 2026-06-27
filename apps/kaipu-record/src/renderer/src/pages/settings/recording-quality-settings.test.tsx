import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_QUALITY, QUALITY_PRESETS } from "@shared/recording-quality";
import { RecordingQualitySettings } from "./recording-quality-settings";

describe("RecordingQualitySettings", () => {
  it("highlights the matching preset and shows its caption", () => {
    render(<RecordingQualitySettings quality={DEFAULT_QUALITY} onChange={vi.fn()} />);

    const balanced = screen.getByRole("button", { name: /Equilibrado/ });
    expect(balanced).toHaveAttribute("data-active", "true");
    expect(screen.getByText(/La mejor relación entre nitidez y tamaño/)).toBeInTheDocument();
  });

  it("applies a preset's full combo when its chip is clicked", () => {
    const onChange = vi.fn();
    render(<RecordingQualitySettings quality={DEFAULT_QUALITY} onChange={onChange} />);

    screen.getByRole("button", { name: /Máxima calidad/ }).click();

    expect(onChange).toHaveBeenCalledWith(QUALITY_PRESETS.max);
  });

  it("patches a single axis when a slider step is clicked", () => {
    const onChange = vi.fn();
    render(<RecordingQualitySettings quality={DEFAULT_QUALITY} onChange={onChange} />);

    screen.getByRole("button", { name: "Resolución 4K" }).click();

    expect(onChange).toHaveBeenCalledWith({ ...DEFAULT_QUALITY, resolution: 2160 });
  });

  it("lands on the Personalizado chip + caption for a custom combo", () => {
    const custom = { ...DEFAULT_QUALITY, resolution: 2160 } as const;
    render(<RecordingQualitySettings quality={custom} onChange={vi.fn()} />);

    expect(screen.getByRole("button", { name: /Personalizado/ })).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(screen.getByText(/Ajusta cada control a tu gusto/)).toBeInTheDocument();
  });
});
