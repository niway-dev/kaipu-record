import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportSheet, enabledGifWidths } from "./export-sheet";

const IDLE = { status: "idle" as const, bytes: null, frameCount: null };

function renderSheet(overrides: Partial<Parameters<typeof ExportSheet>[0]> = {}) {
  const props = {
    timelineDuration: 12,
    sourceWidth: 1920,
    estimate: IDLE,
    presetSource: { width: 1920, height: 1080, fps: 30, hasAudio: true, sampleRate: 48000 },
    onGifSettingsChange: vi.fn(),
    onExportVideo: vi.fn(),
    onExportGif: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  };
  render(<ExportSheet {...props} />);
  return props;
}

describe("ExportSheet", () => {
  it("keeps today's MP4 export one click away (Original preselected on first use)", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "original", framing: null });
    expect(props.onGifSettingsChange).toHaveBeenLastCalledWith(null);
  });

  it("defaults GIF to the whole timeline at 640 px / 15 fps", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: "GIF" }));
    expect(props.onGifSettingsChange).toHaveBeenLastCalledWith({
      range: { start: 0, end: 12 },
      width: 640,
      fps: 15,
    });
    fireEvent.click(screen.getByRole("button", { name: "Export GIF" }));
    expect(props.onExportGif).toHaveBeenCalledWith({
      range: { start: 0, end: 12 },
      width: 640,
      fps: 15,
    });
  });

  it("blocks ranges over 30 s and explains why", () => {
    const props = renderSheet({ timelineDuration: 45 });
    fireEvent.click(screen.getByRole("radio", { name: "GIF" }));
    expect(screen.getByRole("alert").textContent).toMatch(/at most 30 s/);
    expect(screen.getByRole("button", { name: "Export GIF" })).toBeDisabled();
    expect(props.onGifSettingsChange).toHaveBeenLastCalledWith(null);
  });

  it("blocks ranges under 0.5 s", () => {
    renderSheet();
    fireEvent.click(screen.getByRole("radio", { name: "GIF" }));
    const [startField] = screen.getAllByLabelText("Start (s)");
    const [endField] = screen.getAllByLabelText("End (s)");
    fireEvent.change(startField, { target: { value: "2" } });
    fireEvent.change(endField, { target: { value: "2.3" } });
    expect(screen.getByRole("alert").textContent).toBe("Select at least 0.5 s");
    expect(screen.getByRole("button", { name: "Export GIF" })).toBeDisabled();
  });

  it("disables widths wider than the source", () => {
    renderSheet({ sourceWidth: 700 });
    fireEvent.click(screen.getByRole("radio", { name: "GIF" }));
    expect(screen.getByRole("radio", { name: "800 px" })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "640 px" })).not.toBeDisabled();
  });

  it("shows the estimate and warns above 10 MB", () => {
    renderSheet({ estimate: { status: "ready", bytes: 12 * 1024 * 1024, frameCount: 180 } });
    fireEvent.click(screen.getByRole("radio", { name: "GIF" }));
    expect(screen.getByText(/≈ 12/)).toBeInTheDocument();
    expect(screen.getByText(/GitHub won't accept it/)).toBeInTheDocument();
  });
});

describe("enabledGifWidths", () => {
  it("keeps at least the smallest width for tiny sources", () => {
    expect(enabledGifWidths(1920)).toEqual([480, 640, 800]);
    expect(enabledGifWidths(320)).toEqual([480]);
  });
});

describe("presets (NIW2-218)", () => {
  const card = (name: RegExp) => screen.getByRole("radio", { name });

  it("shows one card per destination with its size", () => {
    renderSheet();
    expect(card(/^Original/).getAttribute("aria-checked")).toBe("true");
    expect(card(/YouTube 16:9/).textContent).toContain("1920×1080");
    expect(card(/Vertical 9:16/).textContent).toContain("1080×1920");
    expect(card(/Square 1:1/).textContent).toContain("1080×1080");
    expect(card(/Small file/).textContent).toContain("GitHub · Discord · chat");
  });

  it("preselects the last-used preset and framing", () => {
    const props = renderSheet({ initialPreset: "square", initialFraming: "fill" });
    expect(card(/Square 1:1/).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Fill" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "square", framing: "fill" });
  });

  it("offers Fit/Fill only on Vertical and Square, with their defaults", () => {
    renderSheet();
    expect(screen.queryByRole("radio", { name: "Fit" })).toBeNull();
    fireEvent.click(card(/YouTube 16:9/));
    expect(screen.queryByRole("radio", { name: "Fit" })).toBeNull();
    fireEvent.click(card(/Vertical 9:16/));
    expect(screen.getByRole("radio", { name: "Fill" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(card(/Square 1:1/));
    expect(screen.getByRole("radio", { name: "Fit" }).getAttribute("aria-checked")).toBe("true");
  });

  it("updates the estimate instantly from pure math", () => {
    renderSheet({ timelineDuration: 60 });
    // (8 Mbps + 128 kbps) × 60 s / 8 ≈ 61 MB, plus the moov reservation.
    expect(card(/YouTube 16:9/).textContent).toMatch(/up to ~61 MB/);
    expect(card(/^Original/).textContent).toContain("Same quality as the source");
    fireEvent.click(card(/Small file/));
    expect(card(/Small file/).textContent).toContain("≤ 10 MB · 1280×720");
    fireEvent.click(screen.getByRole("radio", { name: "25 MB" }));
    expect(card(/Small file/).textContent).toMatch(/≤ 25 MB/);
  });

  it("warns when the cap can't be met and still allows exporting", () => {
    const props = renderSheet({ timelineDuration: 900 });
    fireEvent.click(card(/Small file/));
    expect(screen.getByRole("alert").textContent).toMatch(/Fits up to ~\d+:\d\d/);
    fireEvent.click(screen.getByRole("button", { name: "Export anyway (over limit)" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "small-10", framing: null });
  });
});
