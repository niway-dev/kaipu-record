import { fireEvent, render, screen, within } from "@testing-library/react";
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
    gifEnabled: true,
    ...overrides,
  };
  render(<ExportSheet {...props} />);
  return props;
}

describe("ExportSheet", () => {
  it("offers MP4 only while GIF export is on hold", () => {
    const props = renderSheet({ gifEnabled: undefined });
    expect(screen.queryByRole("radio", { name: "GIF" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalled();
  });

  it("exports the recommended Balanced row in one click by default", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "balanced", framing: null });
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
  const row = (name: RegExp) => screen.getByRole("radio", { name });

  it("lists every row, recommended Balanced first and Maximum last, each with size and estimate", () => {
    renderSheet({ presetSource: { width: 1662, height: 1080, fps: 30, hasAudio: true } });
    const names = within(screen.getByRole("radiogroup", { name: "Destination" }))
      .getAllByRole("radio")
      .map((r) => r.textContent ?? "");
    expect(names[0]).toMatch(/^Balanced 1080p/);
    expect(names.at(-1)).toMatch(/^Maximum quality/);
    expect(row(/Balanced 1080p/).getAttribute("aria-checked")).toBe("true");
    expect(row(/Balanced 1080p/).textContent).toContain("Recommended");
    expect(row(/Balanced 1080p/).textContent).toContain("1662×1080");
    expect(row(/YouTube 16:9/).textContent).toContain("1920×1080");
    expect(row(/Vertical 9:16/).textContent).toContain("1080×1920");
    expect(row(/Square 1:1/).textContent).toContain("1080×1080");
    expect(row(/^GitHub/).textContent).toContain("≤ 10 MB");
    expect(row(/Chat \/ Discord/).textContent).toContain("≤ 25 MB");
    expect(row(/Maximum quality/).textContent).toContain("1662×1080");
  });

  it("preselects the Settings default (Maximum) and exports it", () => {
    const props = renderSheet({ defaultPreset: "maximum" });
    expect(row(/Maximum quality/).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "maximum", framing: null });
  });

  it("Enter exports the selected row; Enter on a row only selects it", () => {
    const props = renderSheet();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "balanced", framing: null });

    fireEvent.click(row(/YouTube 16:9/));
    fireEvent.keyDown(row(/YouTube 16:9/), { key: "Enter" });
    expect(props.onExportVideo).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(props.onExportVideo).toHaveBeenLastCalledWith({ presetId: "youtube", framing: null });
  });

  it("offers Fit/Fill only under the selected Vertical or Square row, with their defaults", () => {
    renderSheet();
    expect(screen.queryByRole("radio", { name: "Fit" })).toBeNull();
    fireEvent.click(row(/YouTube 16:9/));
    expect(screen.queryByRole("radio", { name: "Fit" })).toBeNull();
    fireEvent.click(row(/Vertical 9:16/));
    expect(screen.getByRole("radio", { name: "Fill" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(row(/Square 1:1/));
    expect(screen.getByRole("radio", { name: "Fit" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "Fill" }));
    expect(screen.getAllByRole("radio", { name: "Fill" })).toHaveLength(1);
  });

  it("passes the chosen framing with the export", () => {
    const props = renderSheet();
    fireEvent.click(row(/Square 1:1/));
    fireEvent.click(screen.getByRole("radio", { name: "Fill" }));
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "square", framing: "fill" });
  });

  it("estimates every row from pure math", () => {
    renderSheet({ timelineDuration: 60 });
    // (3 Mbps + 128 kbps) × 60 s / 8 ≈ 23 MB, plus the moov reservation.
    expect(row(/Balanced 1080p/).textContent).toMatch(/up to ~24 MB/);
    // (8 Mbps + 128 kbps) × 60 s / 8 ≈ 61 MB.
    expect(row(/YouTube 16:9/).textContent).toMatch(/up to ~61 MB/);
    expect(row(/Maximum quality/).textContent).toContain("Same quality as the source");
    expect(row(/^GitHub/).textContent).toContain("1280×720");
  });

  it("warns under the selected capped row when the cap can't be met, and still allows exporting", () => {
    const props = renderSheet({ timelineDuration: 900 });
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(row(/^GitHub/));
    expect(screen.getByRole("alert").textContent).toMatch(/Fits up to ~\d+:\d\d/);
    fireEvent.click(screen.getByRole("button", { name: "Export anyway (over limit)" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "small-10", framing: null });
  });
});

describe("already exported → reuse (NIW2-218)", () => {
  const existing = {
    id: "local-yt",
    assetId: "asset-yt",
    kind: "recording" as const,
    title: "Demo (YouTube)",
    createdAt: 1,
    durationSeconds: 12,
    fileSizeBytes: 100,
    cloudSizeBytes: null,
    availability: "local" as const,
    comparison: "same" as const,
    editing: "exported-only" as const,
    transfer: { state: "idle" as const },
    derivedFromAssetId: "source",
    editSavedAt: null,
    editExportedSavedAt: null,
    export: { preset: "youtube" as const, fingerprint: "whole" },
  };

  it("marks the row and opens the existing file instead of encoding", () => {
    const onOpenExisting = vi.fn();
    const props = renderSheet({ reusable: { youtube: existing }, onOpenExisting });
    const row = screen.getByRole("radio", { name: /YouTube 16:9/ });
    expect(row.textContent).toContain("Already exported");
    expect(row.textContent).not.toMatch(/up to/);

    fireEvent.click(screen.getByRole("button", { name: "Open the existing YouTube 16:9 file" }));
    expect(onOpenExisting).toHaveBeenCalledWith(existing);

    fireEvent.click(row);
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenExisting).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(onOpenExisting).toHaveBeenCalledTimes(3);
    expect(props.onExportVideo).not.toHaveBeenCalled();
  });

  it("other rows still export", () => {
    const props = renderSheet({ reusable: { youtube: existing }, onOpenExisting: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Export video" }));
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "balanced", framing: null });
  });

  it("ignores reuse when the host can't open files", () => {
    renderSheet({ reusable: { youtube: existing } });
    expect(screen.queryByText("Already exported")).toBeNull();
  });

  it("takes a custom title (Share)", () => {
    renderSheet({ title: "Prepare a file to share" });
    expect(screen.getByRole("heading", { name: "Prepare a file to share" })).toBeInTheDocument();
  });
});
