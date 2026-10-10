import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ExportSheet, enabledGifWidths } from "./export-sheet";

const IDLE = { status: "idle" as const, bytes: null, frameCount: null };

function renderSheet(overrides: Partial<Parameters<typeof ExportSheet>[0]> = {}) {
  const props = {
    timelineDuration: 12,
    sourceWidth: 1920,
    estimate: IDLE,
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
  it("keeps today's MP4 export one click away", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalled();
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
