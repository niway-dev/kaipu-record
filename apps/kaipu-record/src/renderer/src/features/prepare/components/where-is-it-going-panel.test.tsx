import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { WhereIsItGoingPanel } from "./where-is-it-going-panel";

function renderPanel(overrides: Partial<Parameters<typeof WhereIsItGoingPanel>[0]> = {}) {
  const props = {
    thumbnailUrl: null,
    durationSeconds: 182,
    dimensions: { width: 1916, height: 1048 },
    sizeBytes: 119_000_000,
    onPick: vi.fn(),
    onEditFirst: vi.fn(),
    onDismiss: vi.fn(),
    ...overrides,
  };
  render(<WhereIsItGoingPanel {...props} />);
  return props;
}

describe("WhereIsItGoingPanel (NIW2-578)", () => {
  it("says the video is saved and asks where it is going", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: "Where is your video going?" })).toBeVisible();
    expect(screen.getByText("Saved to your Library")).toBeVisible();
    expect(
      screen.getByText("3:02 · 1916 × 1048 · 119 MB · the original stays as it is"),
    ).toBeVisible();
  });

  it("leaves the dimensions out until the file is read", () => {
    renderPanel({ dimensions: null });
    expect(screen.getByText("3:02 · 119 MB · the original stays as it is")).toBeVisible();
  });

  it("each shortcut picks its destination; More places picks none", () => {
    const props = renderPanel();
    const picks: Array<[RegExp | string, string | null]> = [
      [/^YouTube/, "youtube"],
      [/^TikTok · Reels/, "vertical"],
      [/^GitHub · Jira/, "github"],
      [/^Slack · Discord/, "chat"],
      ["More places", null],
    ];
    for (const [name, destination] of picks) {
      fireEvent.click(screen.getByRole("button", { name }));
      expect(props.onPick).toHaveBeenLastCalledWith(destination);
    }
    expect(props.onPick).toHaveBeenCalledTimes(picks.length);
  });

  it("Edit first and Not now", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Edit first" }));
    expect(props.onEditFirst).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "Not now — keep it in the Library" }));
    expect(props.onDismiss).toHaveBeenCalledOnce();
  });

  it("no Edit first when the recording cannot open in the editor", () => {
    renderPanel({ onEditFirst: undefined });
    expect(screen.queryByRole("button", { name: "Edit first" })).toBeNull();
  });
});
