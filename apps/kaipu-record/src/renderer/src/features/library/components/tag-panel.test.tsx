import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
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
  tags: ["cricut"],
};

function Harness({
  vocabulary = ["cricut", "bug", "demo"],
  withItem = true,
  onChange = () => undefined,
  onClose = () => undefined,
  onRenameTag = async () => undefined,
  onDeleteTag = async () => undefined,
  onFilterTag = () => undefined,
}: {
  vocabulary?: string[];
  withItem?: boolean;
  onChange?: (tags: readonly string[]) => void;
  onClose?: () => void;
  onRenameTag?: (from: string, to: string) => Promise<void>;
  onDeleteTag?: (tag: string) => Promise<void>;
  onFilterTag?: (tag: string) => void;
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>(video.tags ?? []);
  return (
    <TagPanel
      video={withItem ? { ...video, tags } : null}
      tagCounts={vocabulary.map((tag, i) => ({ tag, count: vocabulary.length - i }))}
      initialTab="item"
      onChange={(next) => {
        setTags([...next]);
        onChange(next);
      }}
      onRenameTag={onRenameTag}
      onDeleteTag={onDeleteTag}
      onFilterTag={onFilterTag}
      onOpenDetails={() => undefined}
      onClose={onClose}
    />
  );
}

describe("TagPanel — this item", () => {
  it("shows the item and its current tags", () => {
    render(<Harness />);
    expect(screen.getByText("Login error")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "cricut", pressed: true })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "bug", pressed: false })).toBeInTheDocument();
  });

  it("toggles a library tag on and off with one click", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "bug", pressed: false }));
    expect(onChange).toHaveBeenLastCalledWith(["cricut", "bug"]);
    expect(screen.getByRole("button", { name: "bug", pressed: true })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "cricut", pressed: true }));
    expect(onChange).toHaveBeenLastCalledWith(["bug"]);
  });

  it("adds a new tag typed in the field", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const field = screen.getByRole("textbox", { name: "Tags" });
    fireEvent.change(field, { target: { value: "Release" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith(["cricut", "release"]);
  });

  it("closes on Esc or on the curtain, but Esc inside the field only clears the draft", () => {
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
  it("opens on the list when there is no item, with counts", () => {
    render(<Harness withItem={false} />);
    expect(screen.queryByRole("tab", { name: "This item" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "All tags (3)" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("button", { name: /^cricut/ })).toHaveTextContent("cricut3");
  });

  it("renames a tag with Enter", () => {
    const onRenameTag = vi.fn(async () => undefined);
    render(<Harness withItem={false} onRenameTag={onRenameTag} />);
    fireEvent.click(screen.getByRole("button", { name: "Rename bug" }));
    const field = screen.getByRole("textbox", { name: "New name for bug" });
    fireEvent.change(field, { target: { value: "Issue" } });
    fireEvent.keyDown(field, { key: "Enter" });
    expect(onRenameTag).toHaveBeenCalledWith("bug", "issue");
  });

  it("deletes a tag only after confirming", () => {
    const onDeleteTag = vi.fn(async () => undefined);
    render(<Harness withItem={false} onDeleteTag={onDeleteTag} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete demo" }));
    expect(onDeleteTag).not.toHaveBeenCalled();
    expect(screen.getByText("Remove from 1 item?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Delete demo" }));
    expect(onDeleteTag).toHaveBeenCalledWith("demo");
  });

  it("filters the library by a tag when its name is clicked", () => {
    const onFilterTag = vi.fn();
    render(<Harness withItem={false} onFilterTag={onFilterTag} />);
    fireEvent.click(screen.getByRole("button", { name: /^bug/ }));
    expect(onFilterTag).toHaveBeenCalledWith("bug");
  });
});
