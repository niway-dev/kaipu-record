import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TagEditor } from "./tag-editor";

function Harness({
  initial = [],
  vocabulary = [],
  onChange = () => undefined,
}: {
  initial?: string[];
  vocabulary?: string[];
  onChange?: (tags: readonly string[]) => void;
}): React.JSX.Element {
  const [tags, setTags] = useState<readonly string[]>(initial);
  return (
    <TagEditor
      tags={tags}
      vocabulary={vocabulary}
      onChange={(next) => {
        setTags(next);
        onChange(next);
      }}
    />
  );
}

const input = (): HTMLInputElement => screen.getByRole("textbox", { name: "Tags" });
const chips = (): string[] => screen.queryAllByRole("listitem").map((li) => li.textContent ?? "");

describe("TagEditor", () => {
  it("adds normalized tags with Enter and comma", () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);

    fireEvent.change(input(), { target: { value: "Cricut" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "issue #1232," } });

    expect(chips()).toEqual(["cricut", "issue-#1232"]);
    expect(onChange).toHaveBeenLastCalledWith(["cricut", "issue-#1232"]);
    expect(input().value).toBe("");
  });

  it("ignores a second spelling of the same tag and an invalid one", () => {
    const onChange = vi.fn();
    render(<Harness initial={["cricut"]} onChange={onChange} />);

    fireEvent.change(input(), { target: { value: "CRICUT" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "../x" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(chips()).toEqual(["cricut"]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("removes the last chip with Backspace on an empty input", () => {
    render(<Harness initial={["a", "b"]} />);
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chips()).toEqual(["a"]);
  });

  it("removes a chip with its button", () => {
    render(<Harness initial={["a", "b"]} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag a" }));
    expect(chips()).toEqual(["b"]);
  });

  it("suggests vocabulary tags not on the item and adds one when picked", () => {
    render(<Harness initial={["video"]} vocabulary={["cricut", "video", "circuit-board"]} />);

    fireEvent.change(input(), { target: { value: "cri" } });
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["cricut"]);

    fireEvent.mouseDown(screen.getByRole("button", { name: "cricut" }));
    expect(chips()).toEqual(["video", "cricut"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
