import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LibraryVideo } from "@renderer/features/library/types";
import {
  __resetReadyCopiesForTests,
  markCopySeen,
  noteFinishedCopy,
} from "@renderer/features/video-editor/export/ready-copies";
import { LibraryPage } from "./library-page";

const base: LibraryVideo = {
  id: "x",
  assetId: "asset-master",
  kind: "recording",
  title: "Master",
  createdAt: 1,
  durationSeconds: 95,
  fileSizeBytes: 32_000_000,
  cloudSizeBytes: null,
  thumbnailUrl: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
};
const VIDEOS: LibraryVideo[] = [
  base,
  { ...base, id: "y", assetId: "asset-copy", title: "Master (YouTube)", createdAt: 2 },
];

vi.mock("@renderer/features/library/hooks/use-local-library", () => ({
  useLocalLibrary: () => ({
    videos: VIDEOS,
    isLoading: false,
    hasError: false,
    refresh: vi.fn(),
    remove: vi.fn(),
    setTags: vi.fn(),
  }),
}));
vi.mock("@renderer/features/library/hooks/use-tags", () => ({
  useTags: () => ({ tags: [], byId: new Map() }),
  resolveTags: () => [],
}));
vi.mock("@renderer/features/editor/open-in-editor", () => ({
  useOpenInEditor: () => ({ openItem: vi.fn() }),
  canOpenInEditor: () => false,
}));

afterEach(() => __resetReadyCopiesForTests());

const card = (title: string): HTMLElement =>
  screen.getByText(title, { selector: "p" }).closest("[role='button']")!;

describe("LibraryPage ready copies (NIW2-586)", () => {
  it("says how many copies are ready and outlines them until each is opened", () => {
    noteFinishedCopy("asset-copy");
    // A copy no longer in the Library (deleted) is not counted.
    noteFinishedCopy("asset-gone");
    render(
      <MemoryRouter>
        <LibraryPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("1 copy ready");
    expect(card("Master (YouTube)")).toHaveAttribute("data-just-ready", "true");
    expect(card("Master")).toHaveAttribute("data-just-ready", "false");

    act(() => markCopySeen("asset-copy"));
    expect(screen.queryByText("1 copy ready")).toBeNull();
    expect(card("Master (YouTube)")).toHaveAttribute("data-just-ready", "false");
  });
});
