import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TagSummary } from "@shared/types";
import { TagPanel } from "./tag-panel";
import type { LibraryVideo } from "../types";

const video: LibraryVideo = {
  id: "x",
  assetId: "asset-x",
  kind: "screenshot",
  title: "Login error",
  createdAt: 0,
  durationSeconds: 0,
  fileSizeBytes: 1024,
  cloudSizeBytes: null,
  thumbnailUrl: null,
  availability: "local",
  comparison: "same",
  editing: "project-available",
  transfer: { state: "idle" },
  derivedFromAssetId: null,
  editSavedAt: null,
  editExportedSavedAt: null,
  tagIds: ["t-cricut"],
};

const library: TagSummary[] = [
  { id: "t-cricut", name: "Cricut", slug: "cricut", color: "rose", count: 3 },
  { id: "t-bug", name: "Bug", slug: "bug", color: "amber", count: 2 },
  { id: "t-demo", name: "Demo", slug: "demo", color: "sky", count: 1 },
];

type Handlers = Partial<{
  onAssign: (ids: readonly string[]) => void;
  onCreate: (name: string, color?: string) => Promise<TagSummary | null>;
  onRename: (id: string, name: string) => Promise<void>;
  onRecolor: (id: string, color: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onFilterTag: (id: string) => void;
  onClose: () => void;
}>;

function Harness({ withItem = true, ...h }: Handlers & { withItem?: boolean }): React.JSX.Element {
  const [tagIds, setTagIds] = useState<string[]>(video.tagIds ?? []);
  return (
    <TagPanel
      video={withItem ? { ...video, tagIds } : null}
      tags={library}
      initialTab="item"
      onAssign={(next) => {
        setTagIds([...next]);
        h.onAssign?.(next);
      }}
      onCreate={h.onCreate ?? (async () => null)}
      onRename={h.onRename ?? (async () => undefined)}
      onRecolor={h.onRecolor ?? (async () => undefined)}
      onDelete={h.onDelete ?? (async () => undefined)}
      onFilterTag={h.onFilterTag ?? (() => undefined)}
      onOpenDetails={() => undefined}
      onClose={h.onClose ?? (() => undefined)}
    />
  );
}

describe("TagPanel — this item", () => {
  it("shows the item and toggles library tags with one click", () => {
    const onAssign = vi.fn();
    render(<Harness onAssign={onAssign} />);
    expect(screen.getByText("Login error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cricut", pressed: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Bug", pressed: false }));
    expect(onAssign).toHaveBeenLastCalledWith(["t-cricut", "t-bug"]);
    fireEvent.click(screen.getByRole("button", { name: "Cricut", pressed: true }));
    expect(onAssign).toHaveBeenLastCalledWith(["t-bug"]);
  });

  it("closes on Esc or on the curtain, but Esc inside the field only clears it", () => {
    const onClose = vi.fn();
    const { container } = render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Tags" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(container.querySelector("[aria-hidden]")!);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("TagPanel — all tags", () => {
  it("opens on the list when there is no item, with slugs and counts", () => {
    render(<Harness withItem={false} />);
    expect(screen.queryByRole("tab", { name: "This item" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All tags (3)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("#cricut")).toBeInTheDocument();
  });

  it("creates a standalone tag with the picked color", async () => {
    const onCreate = vi.fn(async (name: string) => ({
      id: "t-new",
      name,
      slug: "archivos_varios",
      color: "mint" as const,
      count: 0,
    }));
    render(<Harness withItem={false} onCreate={onCreate} />);

    fireEvent.click(screen.getByRole("button", { name: "Tag color" }));
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    fireEvent.change(screen.getByRole("textbox", { name: "New tag name" }), {
      target: { value: "Archivos varios" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith("Archivos varios", "mint"));
  });

  it("refuses a name that exists in another case", () => {
    render(<Harness withItem={false} />);
    fireEvent.change(screen.getByRole("textbox", { name: "New tag name" }), {
      target: { value: "demo" },
    });
    expect(screen.getByRole("button", { name: "Create" })).toBeDisabled();
    expect(screen.getByText("A tag with this name already exists.")).toBeInTheDocument();
  });

  it("recolors a tag from its mini color menu", () => {
    const onRecolor = vi.fn(async () => undefined);
    render(<Harness withItem={false} onRecolor={onRecolor} />);
    fireEvent.click(screen.getByRole("button", { name: "Color of Bug" }));
    fireEvent.click(screen.getByRole("radio", { name: "Iris" }));
    expect(onRecolor).toHaveBeenCalledWith("t-bug", "iris");
  });

  it("renames by id with Enter", () => {
    const onRename = vi.fn(async () => undefined);
    render(<Harness withItem={false} onRename={onRename} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename Bug" }));
    const field = screen.getByRole("textbox", { name: "New name for Bug" });
    fireEvent.change(field, { target: { value: "Known issue" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRename).toHaveBeenCalledWith("t-bug", "Known issue");
  });

  it("deletes only after confirming", () => {
    const onDelete = vi.fn(async () => undefined);
    render(<Harness withItem={false} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete Demo" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText("Remove from 1 item?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete Demo" }));
    expect(onDelete).toHaveBeenCalledWith("t-demo");
  });

  it("filters the library by a tag when its name is clicked", () => {
    const onFilterTag = vi.fn();
    render(<Harness withItem={false} onFilterTag={onFilterTag} />);
    fireEvent.click(screen.getByTitle("Show items tagged Bug"));
    expect(onFilterTag).toHaveBeenCalledWith("t-bug");
  });
});
