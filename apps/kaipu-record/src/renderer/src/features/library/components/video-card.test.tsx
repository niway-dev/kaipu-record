import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoCard } from "./video-card";
import type { LibraryVideo } from "../types";

const video: LibraryVideo = {
  id: "x",
  assetId: "asset-x",
  kind: "recording",
  title: "My Recording",
  createdAt: Date.now() - 3_600_000,
  durationSeconds: 95,
  fileSizeBytes: 32 * 1024 * 1024,
  cloudSizeBytes: null,
  thumbnailUrl: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  editSavedAt: null,
};

describe("VideoCard", () => {
  it("shows the title and formatted size", () => {
    render(<VideoCard video={video} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("My Recording")).toBeInTheDocument();
    expect(screen.getByText(/32 MB/)).toBeInTheDocument();
  });

  it("shows the availability label", () => {
    render(
      <VideoCard
        video={{ ...video, availability: "local-and-cloud" }}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.getByText("Local and cloud")).toBeInTheDocument();
  });

  it("renders the comparison line when the local copy has changes the cloud hasn't seen", () => {
    const { container } = render(
      <VideoCard
        video={{ ...video, availability: "local-and-cloud", comparison: "local-changes" }}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.textContent).toMatch(/the cloud copy has not changed/i);
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    const onNavigate = vi.fn();
    render(<VideoCard video={video} onNavigate={onNavigate} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("hides the delete action for a cloud-only item (nothing local to delete)", () => {
    render(
      <VideoCard
        video={{ ...video, id: null, availability: "cloud" }}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(screen.queryByTitle("Delete")).toBeNull();
  });

  it("renders a duration for recordings", () => {
    const { container } = render(
      <VideoCard video={video} onNavigate={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(container.textContent).toMatch(/\d:\d\d/); // e.g. 1:35
  });

  it("hides the duration for screenshots (no bogus 0:00)", () => {
    const { container } = render(
      <VideoCard
        video={{ ...video, kind: "screenshot", durationSeconds: 0 }}
        onNavigate={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(container.textContent).not.toMatch(/\d:\d\d/);
  });

  it("shows the edit badge when given one", () => {
    render(
      <VideoCard video={video} badge="not-exported" onNavigate={vi.fn()} onDelete={vi.fn()} />,
    );
    expect(screen.getByText(/edited · not exported/i)).toBeInTheDocument();
  });
});
