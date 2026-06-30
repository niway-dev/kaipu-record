import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VideoCard } from "./video-card";
import type { LibraryVideo } from "../types";

const video: LibraryVideo = {
  id: "x",
  kind: "recording",
  title: "My Recording",
  createdAt: Date.now() - 3_600_000,
  durationSeconds: 95,
  fileSizeBytes: 32 * 1024 * 1024,
  storage: "local",
  thumbnailUrl: null,
};

describe("VideoCard", () => {
  it("shows the title and formatted size", () => {
    render(<VideoCard video={video} onNavigate={vi.fn()} onDelete={vi.fn()} />);
    expect(screen.getByText("My Recording")).toBeInTheDocument();
    expect(screen.getByText(/32 MB/)).toBeInTheDocument();
  });

  it("calls onDelete when the delete button is clicked", async () => {
    const onDelete = vi.fn();
    const onNavigate = vi.fn();
    render(<VideoCard video={video} onNavigate={onNavigate} onDelete={onDelete} />);

    await userEvent.click(screen.getByRole("button", { name: /delete/i }));
    expect(onDelete).toHaveBeenCalledOnce();
    expect(onNavigate).not.toHaveBeenCalled();
  });
});
