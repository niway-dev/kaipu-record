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
    thumbnailUrl: null,
    storage: "local",
    ...overrides,
  };
}

function renderRow(overrides: Partial<React.ComponentProps<typeof VideoRow>> = {}) {
  const onNavigate = vi.fn();
  const onDelete = vi.fn();
  const onUpload = vi.fn();
  const result = render(
    <VideoRow
      video={makeVideo()}
      onNavigate={onNavigate}
      onDelete={onDelete}
      onUpload={onUpload}
      {...overrides}
    />,
  );
  return { ...result, onNavigate, onDelete, onUpload };
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

  it("uploads local recordings without navigating", () => {
    const { onUpload, onNavigate } = renderRow();
    fireEvent.click(screen.getByTitle("Upload to cloud"));
    expect(onUpload).toHaveBeenCalledTimes(1);
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("hides the upload action for non-local storage", () => {
    renderRow({ video: makeVideo({ storage: "cloud" }) });
    expect(screen.queryByTitle("Upload to cloud")).toBeNull();
  });

  it("hides the upload action when no onUpload handler is given", () => {
    render(<VideoRow video={makeVideo()} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.queryByTitle("Upload to cloud")).toBeNull();
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
});
