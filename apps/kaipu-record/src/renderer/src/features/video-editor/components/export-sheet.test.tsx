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

/** The footer's primary action: "Export ~7.2 MB ↵", "Export", "Open ↵"… */
const exportButton = (): HTMLElement => screen.getByRole("button", { name: /^Export( |$)/ });

describe("ExportSheet", () => {
  it("offers MP4 only while GIF export is on hold", () => {
    const props = renderSheet({ gifEnabled: undefined });
    expect(screen.queryByRole("radio", { name: "GIF" })).toBeNull();
    fireEvent.click(exportButton());
    expect(props.onExportVideo).toHaveBeenCalled();
  });

  it("exports the recommended Balanced row in one click by default", () => {
    const props = renderSheet();
    fireEvent.click(exportButton());
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
    renderSheet({ estimate: { status: "ready", bytes: 12_000_000, frameCount: 180 } });
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

describe("presets (NIW2-218 export redesign)", () => {
  const row = (name: RegExp) => screen.getByRole("radio", { name });
  /** The size column the row is described by: "~9.2 MB" + "1280×720". */
  const sizeOf = (name: RegExp): string =>
    document.getElementById(row(name).getAttribute("aria-describedby")!)!.textContent ?? "";

  it("groups the rows by intent: Recommended, Share in a tool, Post, Keep", () => {
    renderSheet({ presetSource: { width: 1662, height: 1080, fps: 30, hasAudio: true } });
    const list = screen.getByRole("radiogroup", { name: "Destination" });
    const text = list.textContent ?? "";
    const order = [
      "Recommended",
      "Balanced",
      "Share in a tool",
      "Light",
      "Post",
      "YouTube",
      "Reels · TikTok · Shorts",
      "Feeds",
      "Keep",
      "Maximum quality",
    ].map((label) => text.indexOf(label));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(within(list).getAllByRole("radio")).toHaveLength(6);
  });

  it("gives each row where it works, its size in MB and its output dimensions", () => {
    renderSheet({ presetSource: { width: 1662, height: 1080, fps: 30, hasAudio: true } });
    expect(row(/^Balanced/).getAttribute("aria-checked")).toBe("true");
    expect(row(/^Balanced/).textContent).toContain("Recommended");
    expect(row(/^Balanced/).textContent).toContain("Good for almost anything");
    expect(sizeOf(/^Balanced/)).toContain("1662×1080");
    expect(sizeOf(/^YouTube/)).toContain("1920×1080");
    expect(sizeOf(/^Reels/)).toContain("1080×1920");
    expect(sizeOf(/^Feeds/)).toContain("1080×1080");
    expect(row(/^Light/).textContent).toContain("GitHub · Jira · Linear · Slack");
    expect(sizeOf(/^Maximum quality/)).toContain("1662×1080");
    expect(sizeOf(/^Maximum quality/)).toContain("Full size");
  });

  it("estimates every row from pure math, 'up to' only for the fixed canvases", () => {
    renderSheet({ timelineDuration: 60 });
    // 6 MB/min of q30 video + 128 kbps × 60 s / 8 ≈ 7 MB, plus the moov reservation.
    expect(sizeOf(/^Balanced/)).toMatch(/^~7\.2 MB/);
    // (8 Mbps + 128 kbps) × 60 s / 8 ≈ 61 MB.
    expect(sizeOf(/^YouTube/)).toMatch(/^up to ~61 MB/);
    // 4.7 MB/min of q33 video + the same audio ≈ 5.7 MB, plus the moov reservation.
    expect(sizeOf(/^Light/)).toMatch(/^~5\.9 MB/);
    expect(sizeOf(/^Light/)).toContain("1920×1080");
  });

  it("shows the before/after meter for the selected row against the original's size", () => {
    renderSheet({ timelineDuration: 60, sourceSizeBytes: 119_000_000 });
    expect(screen.getByText("Original 119 MB")).toBeInTheDocument();
    expect(screen.getByText("~7.2 MB", { selector: "strong" })).toBeInTheDocument();
    expect(screen.getByText(/94% lighter/)).toBeInTheDocument();

    fireEvent.click(row(/^Light/));
    expect(screen.getByText(/95% lighter/)).toBeInTheDocument();
    fireEvent.click(row(/^YouTube/));
    expect(screen.getByText("Up to ~61 MB")).toBeInTheDocument();
    fireEvent.click(row(/^Maximum quality/));
    expect(screen.queryByText(/lighter/)).toBeNull();
  });

  it("leaves the meter out without the original's size", () => {
    renderSheet();
    expect(screen.queryByText(/^Original/)).toBeNull();
  });

  it("puts the size on the primary button and Enter exports the selected row", () => {
    const props = renderSheet({ timelineDuration: 60 });
    expect(exportButton().textContent).toBe("Export ~7.2 MB↵");
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "balanced", framing: null });

    fireEvent.click(row(/^YouTube/));
    fireEvent.keyDown(row(/^YouTube/), { key: "Enter" });
    expect(props.onExportVideo).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(props.onExportVideo).toHaveBeenLastCalledWith({ presetId: "youtube", framing: null });
  });

  it("preselects the Settings default (Maximum) and exports it", () => {
    const props = renderSheet({ defaultPreset: "maximum" });
    expect(row(/^Maximum quality/).getAttribute("aria-checked")).toBe("true");
    expect(exportButton().textContent).toBe("Export↵");
    fireEvent.click(exportButton());
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "maximum", framing: null });
  });

  it("opens the selected row with its explanation and facts", () => {
    renderSheet({ presetSource: { width: 1662, height: 1080, fps: 30, hasAudio: true } });
    expect(screen.getByText(/Crisp text that stays light/)).toBeInTheDocument();
    expect(screen.getByText("Text stays readable")).toBeInTheDocument();

    fireEvent.click(row(/^Light/));
    expect(screen.queryByText(/Crisp text that stays light/)).toBeNull();
    expect(screen.getByText("Readable text, smallest file.")).toBeInTheDocument();
    expect(screen.getByText("Smallest file")).toBeInTheDocument();

    // Not 16:9 → YouTube adds bars, and says so.
    fireEvent.click(row(/^YouTube/));
    expect(screen.getByText("Black bars if the screen isn't 16:9")).toBeInTheDocument();
  });

  it("says nothing about bars when the recording already is 16:9", () => {
    renderSheet({ defaultPreset: "youtube" });
    expect(screen.queryByText("Black bars if the screen isn't 16:9")).toBeNull();
  });

  it("offers Fill / Fit with a framing preview only under Reels or Feeds, with their defaults", () => {
    renderSheet({ thumbnailUrl: "kaipu-media://thumb/rec-1.jpg" });
    expect(screen.queryByRole("radio", { name: /^Fit/ })).toBeNull();
    fireEvent.click(row(/^YouTube/));
    expect(screen.queryByTestId("framing-preview")).toBeNull();

    fireEvent.click(row(/^Reels/));
    expect(screen.getByRole("radio", { name: "Fill · crop the sides" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByTestId("framing-preview")).toHaveAttribute("data-framing", "fill");
    expect(screen.getByText(/edges of your recording are cut off/)).toBeInTheDocument();

    fireEvent.click(row(/^Feeds/));
    expect(screen.getByRole("radio", { name: "Fit · show all" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    fireEvent.click(screen.getByRole("radio", { name: "Fill · crop the sides" }));
    expect(screen.getByTestId("framing-preview")).toHaveAttribute("data-framing", "fill");
    expect(screen.getAllByTestId("framing-preview")).toHaveLength(1);
  });

  it("passes the chosen framing with the export", () => {
    const props = renderSheet();
    fireEvent.click(row(/^Feeds/));
    fireEvent.click(screen.getByRole("radio", { name: "Fill · crop the sides" }));
    fireEvent.click(exportButton());
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "square", framing: "fill" });
  });

  it("shows both GitHub plans for a tier, from its estimate", () => {
    // One minute of Light (~5.9 MB) fits both.
    renderSheet({ timelineDuration: 60, defaultPreset: "light" });
    expect(screen.getByText("GitHub Free · 10 MB")).toHaveAttribute("data-fits", "true");
    expect(screen.getByText("GitHub Pro / Team / Enterprise · 100 MB")).toHaveAttribute(
      "data-fits",
      "true",
    );
  });

  it("over 10 MB: GitHub Free is muted as 'over', the paid plans still fit", () => {
    // Two minutes of Balanced (~14 MB).
    renderSheet({ timelineDuration: 120 });
    const free = screen.getByText("GitHub Free · over 10 MB");
    expect(free).toHaveAttribute("data-fits", "false");
    expect(free).not.toHaveAttribute("data-warn", "true");
    expect(screen.getByText("GitHub Pro / Team / Enterprise · 100 MB")).toBeInTheDocument();
  });

  it("no GitHub chips on the POST or KEEP rows", () => {
    renderSheet({ defaultPreset: "youtube" });
    expect(screen.queryByText(/GitHub Free/)).toBeNull();
  });

  it("over GitHub's 100 MB: warns in amber but never blocks or lowers the quality", () => {
    // 20 minutes of Light ≈ 117 MB.
    const props = renderSheet({ timelineDuration: 1200, defaultPreset: "light" });
    expect(screen.getByText("GitHub Free · over 10 MB")).toBeInTheDocument();
    const paid = screen.getByText("Too big for GitHub — export a shorter part");
    expect(paid).toHaveAttribute("data-warn", "true");
    expect(sizeOf(/^Light/)).toContain("1920×1080");
    fireEvent.click(exportButton());
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "light", framing: null });
  });

  it("subtitles the sheet with the title, duration and resolution", () => {
    renderSheet({ sourceTitle: "Recording — 10/12/2026", timelineDuration: 78 });
    expect(screen.getByText("Recording — 10/12/2026 · 1:18 · 1920×1080")).toBeInTheDocument();
  });

  it("closes from the ✕ and from Cancel", () => {
    const props = renderSheet();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(props.onCancel).toHaveBeenCalledTimes(2);
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

  it("badges the row and opens the existing file instead of encoding", () => {
    const onOpenExisting = vi.fn();
    const props = renderSheet({ reusable: { youtube: existing }, onOpenExisting });
    const badge = screen.getByRole("button", { name: "Open the existing YouTube file" });
    expect(badge.textContent).toBe("Already exported · Open");

    fireEvent.click(badge);
    expect(onOpenExisting).toHaveBeenCalledWith(existing);
    // The badge opens the file; it doesn't select the row.
    expect(screen.getByRole("radio", { name: /^YouTube/ })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    fireEvent.click(screen.getByRole("radio", { name: /^YouTube/ }));
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    expect(onOpenExisting).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Enter" });
    expect(onOpenExisting).toHaveBeenCalledTimes(3);
    expect(props.onExportVideo).not.toHaveBeenCalled();
  });

  it("other rows still export", () => {
    const props = renderSheet({ reusable: { youtube: existing }, onOpenExisting: vi.fn() });
    fireEvent.click(exportButton());
    expect(props.onExportVideo).toHaveBeenCalledWith({ presetId: "balanced", framing: null });
  });

  it("ignores reuse when the host can't open files", () => {
    renderSheet({ reusable: { youtube: existing } });
    expect(screen.queryByText("Already exported · Open")).toBeNull();
  });

  it("takes a custom title (Share)", () => {
    renderSheet({ title: "Share a copy" });
    expect(screen.getByRole("heading", { name: "Share a copy" })).toBeInTheDocument();
  });
});
