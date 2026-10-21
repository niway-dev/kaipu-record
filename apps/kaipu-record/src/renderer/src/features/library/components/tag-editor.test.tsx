import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { TagSummary } from "@shared/types";
import { TagEditor } from "./tag-editor";

const tag = (name: string, id = `t-${name}`): TagSummary => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "_"),
  color: "lagoon",
  count: 1,
});

function Harness({
  initial = [],
  all = [],
  onAssign = () => undefined,
  onCreate = async (name: string) => tag(name),
}: {
  initial?: TagSummary[];
  all?: TagSummary[];
  onAssign?: (ids: readonly string[]) => void;
  onCreate?: (name: string) => Promise<TagSummary | null>;
}): React.JSX.Element {
  const [ids, setIds] = useState<readonly string[]>(initial.map((t) => t.id));
  const [library, setLibrary] = useState<TagSummary[]>([...all, ...initial]);
  return (
    <TagEditor
      assigned={ids.flatMap((id) => library.filter((t) => t.id === id))}
      all={library}
      onAssign={(next) => {
        setIds(next);
        onAssign(next);
      }}
      onCreate={async (name) => {
        const created = await onCreate(name);
        if (created) setLibrary((prev) => [...prev, created]);
        return created;
      }}
    />
  );
}

const input = (): HTMLInputElement => screen.getByRole("textbox", { name: "Tags" });
const chips = (): string[] =>
  Array.from(screen.getByRole("list", { name: "Tags" }).querySelectorAll("li"), (li) =>
    (li.textContent ?? "").trim(),
  );

describe("TagEditor", () => {
  it("creates a new tag from typed text, keeping its capitals", async () => {
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(<Harness onCreate={onCreate} onAssign={onAssign} />);

    fireEvent.change(input(), { target: { value: "Archivos varios" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(onAssign).toHaveBeenLastCalledWith(["t-Archivos varios"]));
    expect(onCreate).toHaveBeenCalledWith("Archivos varios");
    expect(chips()).toEqual(["Archivos varios"]);
    expect(input().value).toBe("");
  });

  it("reuses the existing tag when the name matches in any case or with #", async () => {
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(<Harness all={[tag("Demo")]} onCreate={onCreate} onAssign={onAssign} />);

    fireEvent.change(input(), { target: { value: "#demo" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await waitFor(() => expect(onAssign).toHaveBeenLastCalledWith(["t-Demo"]));
    expect(onCreate).not.toHaveBeenCalled();
  });

  it("ignores an invalid name and a tag already on the item", async () => {
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(<Harness initial={[tag("cricut")]} onCreate={onCreate} onAssign={onAssign} />);

    fireEvent.change(input(), { target: { value: "CRICUT" } });
    fireEvent.keyDown(input(), { key: "Enter" });
    fireEvent.change(input(), { target: { value: "../x" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    await Promise.resolve();
    expect(onCreate).not.toHaveBeenCalled();
    expect(onAssign).not.toHaveBeenCalled();
    expect(chips()).toEqual(["cricut"]);
  });

  it("removes the last chip with Backspace and a chip with its button", () => {
    render(<Harness initial={[tag("a"), tag("b"), tag("c")]} />);
    fireEvent.keyDown(input(), { key: "Backspace" });
    expect(chips()).toEqual(["a", "b"]);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag a" }));
    expect(chips()).toEqual(["b"]);
  });

  it("suggests library tags by slug and assigns one when picked", () => {
    render(
      <Harness
        initial={[tag("video")]}
        all={[tag("Archivos varios"), tag("cricut"), tag("circuit board")]}
      />,
    );

    fireEvent.change(input(), { target: { value: "#arch" } });
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(["Archivos varios"]);

    fireEvent.mouseDown(screen.getByRole("button", { name: "Archivos varios" }));
    expect(chips()).toEqual(["video", "Archivos varios"]);
    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
