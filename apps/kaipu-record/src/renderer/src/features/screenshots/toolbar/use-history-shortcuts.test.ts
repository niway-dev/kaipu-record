import { describe, expect, it } from "vitest";
import { historyShortcut, redoKeyLabel, undoKeyLabel } from "./use-history-shortcuts";

const press = (
  key: string,
  mods: Partial<{
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    shiftKey: boolean;
    repeat: boolean;
  }>,
  target: EventTarget | null = document.body,
) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  repeat: false,
  target,
  ...mods,
});

const input = (type: string): HTMLInputElement => {
  const el = document.createElement("input");
  el.type = type;
  return el;
};

describe("historyShortcut", () => {
  it("mac: Cmd+Z undoes, Cmd+Shift+Z redoes (either letter case)", () => {
    expect(historyShortcut(press("z", { metaKey: true }), "mac")).toBe("undo");
    expect(historyShortcut(press("Z", { metaKey: true, shiftKey: true }), "mac")).toBe("redo");
  });

  it("mac: Ctrl+Z, Cmd+Ctrl+Z and Cmd+Y do nothing", () => {
    expect(historyShortcut(press("z", { ctrlKey: true }), "mac")).toBeNull();
    expect(historyShortcut(press("z", { metaKey: true, ctrlKey: true }), "mac")).toBeNull();
    expect(historyShortcut(press("y", { metaKey: true }), "mac")).toBeNull();
  });

  it("other: Ctrl+Z undoes; Ctrl+Shift+Z and Ctrl+Y redo", () => {
    expect(historyShortcut(press("z", { ctrlKey: true }), "other")).toBe("undo");
    expect(historyShortcut(press("Z", { ctrlKey: true, shiftKey: true }), "other")).toBe("redo");
    expect(historyShortcut(press("y", { ctrlKey: true }), "other")).toBe("redo");
  });

  it("other: Cmd+Z, Ctrl+Meta+Z and Ctrl+Shift+Y do nothing", () => {
    expect(historyShortcut(press("z", { metaKey: true }), "other")).toBeNull();
    expect(historyShortcut(press("z", { ctrlKey: true, metaKey: true }), "other")).toBeNull();
    expect(historyShortcut(press("y", { ctrlKey: true, shiftKey: true }), "other")).toBeNull();
  });

  it("ignores a held key, Alt, a bare Z and other keys", () => {
    expect(historyShortcut(press("z", { metaKey: true, repeat: true }), "mac")).toBeNull();
    expect(historyShortcut(press("z", { metaKey: true, altKey: true }), "mac")).toBeNull();
    expect(historyShortcut(press("z", {}), "mac")).toBeNull();
    expect(historyShortcut(press("a", { metaKey: true }), "mac")).toBeNull();
  });

  it("leaves text fields to their own undo", () => {
    const ta = document.createElement("textarea");
    const editable = document.createElement("div");
    editable.setAttribute("contenteditable", "true");
    for (const target of [input("text"), input("search"), input("number"), ta, editable]) {
      expect(historyShortcut(press("z", { metaKey: true }, target), "mac")).toBeNull();
    }
  });

  it("treats a slider, checkbox, radio and button as the canvas", () => {
    for (const type of ["range", "checkbox", "radio", "button"]) {
      expect(historyShortcut(press("z", { metaKey: true }, input(type)), "mac")).toBe("undo");
    }
  });

  it("prints the keys per platform", () => {
    expect(undoKeyLabel("mac")).toBe("⌘Z");
    expect(redoKeyLabel("mac")).toBe("⇧⌘Z");
    expect(undoKeyLabel("other")).toBe("Ctrl+Z");
    expect(redoKeyLabel("other")).toBe("Ctrl+Shift+Z");
  });
});
