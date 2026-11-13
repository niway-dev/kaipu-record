import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import type { RecordingCapture } from "@shared/recording-capture";
import { ItemDetails } from "./item-details";

const video = (overrides: Partial<LibraryVideo> = {}): LibraryVideo => ({
  id: "x",
  assetId: "x",
  kind: "recording",
  title: "Take",
  createdAt: Date.now(),
  durationSeconds: 10,
  fileSizeBytes: 1000,
  cloudSizeBytes: null,
  availability: "local",
  comparison: "same",
  editing: "exported-only",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  sourceVideoAssetId: null,
  sourceTimeSeconds: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  ...overrides,
});

const cap = (mode: RecordingCapture["mode"]): RecordingCapture => ({
  mode,
  width: 100,
  height: 100,
  ratio: null,
});

function sourceOf(capture: RecordingCapture | null): string | null {
  render(
    <ItemDetails video={video()} probe={null} dimensions={null} capture={capture} path={null} />,
  );
  return screen.getByText("Source").nextElementSibling?.textContent ?? null;
}

afterEach(cleanup);

describe("ItemDetails Source", () => {
  it.each([
    ["screen", "Screen recording"],
    ["window", "Window recording"],
    ["area", "Region recording"],
    ["import", "Imported video"],
  ] as const)("reads %s as a sentence-case label", (mode, label) => {
    expect(sourceOf(cap(mode))).toBe(label);
  });

  it("falls back to Screen recording without capture data", () => {
    expect(sourceOf(null)).toBe("Screen recording");
  });
});
