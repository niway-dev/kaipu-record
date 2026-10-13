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
  onChange = () => undefined,
  onClose = () => undefined,
}: {
  vocabulary?: string[];
  onChange?: (tags: readonly string[]) => void;
  onClose?: () => void;
}): React.JSX.Element {
  const [tags, setTags] = useState<string[]>(video.tags ?? []);
  return (
    <TagPanel
      video={{ ...video, tags }}
      vocabulary={vocabulary}
      onChange={(next) => {
        setTags([...next]);
        onChange(next);
      }}
      onOpenDetails={() => undefined}
      onClose={onClose}
    />
  );
}

describe("TagPanel", () => {
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

  it("closes on Esc, but Esc inside the field only clears the draft", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Tags" }), { key: "Escape" });
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("hides the quick picks when the library has no tags yet", () => {
    render(<Harness vocabulary={[]} />);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });
});
