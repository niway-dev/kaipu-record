import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TAGS_PER_ITEM_MAX } from "@kaipu/domain/constants";
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

const deferred = (): { promise: Promise<void>; resolve: () => void } => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

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

  // These render TagEditor with a static `assigned`, like a parent whose save has not
  // landed yet: the Harness above updates state synchronously and cannot show it.
  it("assigns a pasted list of new tags in one onAssign call", async () => {
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(<TagEditor assigned={[]} all={[]} onAssign={onAssign} onCreate={onCreate} />);

    fireEvent.change(input(), { target: { value: "design, demo, " } });

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign).toHaveBeenCalledWith(["t-design", "t-demo"]);
    expect(input().value).toBe("");
  });

  it("keeps existing tags and mixes existing and new in a paste", async () => {
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(
      <TagEditor
        assigned={[tag("a")]}
        all={[tag("Demo")]}
        onAssign={onAssign}
        onCreate={onCreate}
      />,
    );

    fireEvent.change(input(), { target: { value: "demo, fresh, " } });

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign).toHaveBeenCalledWith(["t-a", "t-Demo", "t-fresh"]);
    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith("fresh");
  });

  it("ignores duplicates and invalid pieces in a paste", async () => {
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(<TagEditor assigned={[]} all={[]} onAssign={onAssign} onCreate={onCreate} />);

    fireEvent.change(input(), { target: { value: "a, A, ../x, b, " } });

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onCreate.mock.calls.map(([name]) => name)).toEqual(["a", "b"]);
    expect(onAssign).toHaveBeenCalledWith(["t-a", "t-b"]);
  });

  it("caps a paste at the per-item limit", async () => {
    const assigned = Array.from({ length: TAGS_PER_ITEM_MAX - 1 }, (_, i) => tag(`t${i}`));
    const onCreate = vi.fn(async (name: string) => tag(name));
    const onAssign = vi.fn();
    render(<TagEditor assigned={assigned} all={[]} onAssign={onAssign} onCreate={onCreate} />);

    fireEvent.change(input(), { target: { value: "x, y, z, " } });

    await waitFor(() => expect(onAssign).toHaveBeenCalledTimes(1));
    expect(onAssign.mock.calls[0]![0]).toHaveLength(TAGS_PER_ITEM_MAX);
    // Only the tag that fits is created; the rest would be orphans in the registry.
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("two quick chip removals before the first save settles both apply", async () => {
    const save = deferred();
    const onAssign = vi.fn((_ids: readonly string[]) => save.promise);
    render(
      <TagEditor
        assigned={[tag("a"), tag("b"), tag("c")]}
        all={[]}
        onAssign={onAssign}
        onCreate={async (name) => tag(name)}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag a" }));
    fireEvent.click(screen.getByRole("button", { name: "Remove tag b" }));

    expect(onAssign.mock.calls).toEqual([[["t-b", "t-c"]], [["t-c"]]]);
    await act(async () => save.resolve());
  });

  it("re-syncs with the props after a save settles", async () => {
    const save = deferred();
    const onAssign = vi.fn((_ids: readonly string[]) => save.promise);
    const onCreate = async (name: string): Promise<TagSummary> => tag(name);
    const { rerender } = render(
      <TagEditor
        assigned={[tag("a"), tag("b")]}
        all={[]}
        onAssign={onAssign}
        onCreate={onCreate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Remove tag a" }));
    await act(async () => save.resolve());
    rerender(<TagEditor assigned={[tag("b")]} all={[]} onAssign={onAssign} onCreate={onCreate} />);
    fireEvent.click(screen.getByRole("button", { name: "Remove tag b" }));

    expect(onAssign).toHaveBeenLastCalledWith([]);
  });
});
