import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import { VideoRow } from "./video-row";

function makeVideo(overrides: Partial<LibraryVideo> = {}): LibraryVideo {
  return {
    id: "v1",
    assetId: "asset-v1",
    kind: "recording",
    title: "My Recording",
    createdAt: 1_700_000_000_000,
    durationSeconds: 65,
    fileSizeBytes: 12_000_000,
    cloudSizeBytes: null,
    thumbnailUrl: null,
    availability: "local",
    comparison: "same",
    editing: "project-available",
    transfer: { state: "idle" },
    derivedFromAssetId: null,
    editSavedAt: null,
    ...overrides,
  };
}

function renderRow(overrides: Partial<React.ComponentProps<typeof VideoRow>> = {}) {
  const onNavigate = vi.fn();
  const onDelete = vi.fn();
  const result = render(
    <VideoRow video={makeVideo()} onNavigate={onNavigate} onDelete={onDelete} {...overrides} />,
  );
  return { ...result, onNavigate, onDelete };
}

describe("VideoRow", () => {
  it("navigates when the row is clicked", () => {
    const { container, onNavigate } = renderRow();
    fireEvent.click(container.firstChild as HTMLElement);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("navigates on Enter and Space (keyboard a11y)", () => {
    const { container, onNavigate } = renderRow();
    const row = container.firstChild as HTMLElement;
    fireEvent.keyDown(row, { key: "Enter" });
    fireEvent.keyDown(row, { key: " " });
    expect(onNavigate).toHaveBeenCalledTimes(2);
  });

  it("deletes without navigating — action clicks don't bubble to the row", () => {
    const { onDelete, onNavigate } = renderRow();
    fireEvent.click(screen.getByTitle("Delete"));
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("hides the delete action for a cloud-only item (nothing local to delete)", () => {
    renderRow({ video: makeVideo({ id: null, availability: "cloud" }) });
    expect(screen.queryByTitle("Delete")).toBeNull();
  });

  it("shows the location label per availability", () => {
    renderRow({ video: makeVideo({ availability: "local" }) });
    expect(screen.getByText("Local")).toBeInTheDocument();
  });

  it("shows the cloud label for a cloud-only item", () => {
    renderRow({ video: makeVideo({ id: null, availability: "cloud" }) });
    expect(screen.getByText("Cloud")).toBeInTheDocument();
  });

  it("shows the combined label for an item that is both local and cloud", () => {
    renderRow({ video: makeVideo({ availability: "local-and-cloud" }) });
    expect(screen.getByText("Local and cloud")).toBeInTheDocument();
  });

  it("shows the unavailable label when the local file can't be reached", () => {
    renderRow({ video: makeVideo({ availability: "local-unavailable" }) });
    expect(screen.getByText("Local location unavailable")).toBeInTheDocument();
  });

  it("falls back to 'Untitled recording' for an empty title", () => {
    renderRow({ video: makeVideo({ title: "" }) });
    expect(screen.getByText("Untitled recording")).toBeInTheDocument();
  });

  it("hides the duration for screenshots (no bogus 0:00)", () => {
    const { container } = renderRow({
      video: makeVideo({ kind: "screenshot", durationSeconds: 0 }),
    });
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });

  it("shows the edit badge when given one", () => {
    renderRow({ badge: "not-exported" });
    expect(screen.getByText(/edited · not exported/i)).toBeInTheDocument();
  });
});
