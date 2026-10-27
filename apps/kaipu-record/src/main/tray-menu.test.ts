import { describe, expect, it, vi } from "vitest";
import type { MenuItemConstructorOptions } from "electron";
import type { ShortcutSettings } from "@shared/types";
import { buildTrayMenuTemplate, type TrayMenuActions, type TrayMenuLabels } from "./tray-menu";

const labels: TrayMenuLabels = {
  open: "Open",
  record: "Record",
  recordScreen: "Record screen",
  recordArea: "Record area",
  recordWindow: "Record window…",
  stopRecording: "Stop recording",
  cancelCountdown: "Cancel countdown",
  takeScreenshot: "Take screenshot",
  library: "Library",
  settings: "Settings…",
  quit: "Quit",
};

const shortcuts = {
  startRecording: "Command+Control+C",
  stopRecording: "Command+Control+S",
  recordArea: "Command+Control+A",
  captureScreenshot: "Command+Control+X",
} as ShortcutSettings;

function actions(): TrayMenuActions {
  return {
    open: vi.fn(),
    recordScreen: vi.fn(),
    recordArea: vi.fn(),
    recordWindow: vi.fn(),
    stopRecording: vi.fn(),
    takeScreenshot: vi.fn(),
    openLibrary: vi.fn(),
    openSettings: vi.fn(),
    quit: vi.fn(),
  };
}

const build = (recording: boolean, a = actions()): MenuItemConstructorOptions[] =>
  buildTrayMenuTemplate({ labels, actions: a, shortcuts, recording });
const names = (items: MenuItemConstructorOptions[]): (string | undefined)[] =>
  items.map((i) => (i.type === "separator" ? "---" : i.label));
const submenu = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
  items.find((i) => i.label === "Record")!.submenu as MenuItemConstructorOptions[];
const click = (item: MenuItemConstructorOptions | undefined): void => (item!.click as () => void)();

describe("buildTrayMenuTemplate", () => {
  it("idle: lists the menu in order with no Stop item", () => {
    expect(names(build(false))).toEqual([
      "Open",
      "---",
      "Record",
      "Take screenshot",
      "---",
      "Library",
      "Settings…",
      "---",
      "Quit",
    ]);
  });

  it("idle: the Record submenu is enabled and shows only the accelerators that do the same", () => {
    const sub = submenu(build(false));
    expect(names(sub)).toEqual(["Record screen", "Record area", "Record window…"]);
    expect(sub.map((i) => i.enabled)).toEqual([true, true, true]);
    // startRecording opens the last used mode, not always Screen: not shown on Record screen.
    expect(sub[0]!.accelerator).toBeUndefined();
    expect(sub[1]).toMatchObject({ accelerator: "Command+Control+A", registerAccelerator: false });
    expect(sub[2]!.accelerator).toBeUndefined();
  });

  it("countdown: the Record items are disabled and Cancel countdown takes Stop's place", () => {
    const a = actions();
    const items = buildTrayMenuTemplate({
      labels,
      actions: a,
      shortcuts,
      recording: false,
      countingDown: true,
    });
    expect(names(items).slice(0, 4)).toEqual(["Open", "---", "Record", "Cancel countdown"]);
    expect(submenu(items).map((i) => i.enabled)).toEqual([false, false, false]);
    expect(names(items)).not.toContain("Stop recording");
    click(items.find((i) => i.label === "Cancel countdown"));
    // The same stop command cancels a pending start.
    expect(a.stopRecording).toHaveBeenCalledTimes(1);
  });

  it("recording: Stop appears right after Record and the submenu is disabled", () => {
    const items = build(true);
    expect(names(items).slice(0, 4)).toEqual(["Open", "---", "Record", "Stop recording"]);
    expect(submenu(items).map((i) => i.enabled)).toEqual([false, false, false]);
    const stop = items.find((i) => i.label === "Stop recording")!;
    expect(stop).toMatchObject({ accelerator: "Command+Control+S", registerAccelerator: false });
    expect(stop.enabled).not.toBe(false);
  });

  it("never registers an accelerator, so it cannot double-register a global shortcut", () => {
    const all = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
      items.flatMap((i) => [i, ...(Array.isArray(i.submenu) ? all(i.submenu) : [])]);
    for (const item of all(build(true))) {
      if (item.accelerator) expect(item.registerAccelerator).toBe(false);
    }
  });

  it("omits the accelerator when a binding is empty", () => {
    const items = buildTrayMenuTemplate({
      labels,
      actions: actions(),
      shortcuts: { ...shortcuts, captureScreenshot: "" },
      recording: false,
    });
    expect(items.find((i) => i.label === "Take screenshot")!.accelerator).toBeUndefined();
  });

  it("uses the labels it is given, so a locale change only needs a rebuild", () => {
    const items = buildTrayMenuTemplate({
      labels: { ...labels, record: "Grabar", quit: "Salir" },
      actions: actions(),
      shortcuts,
      recording: false,
    });
    expect(names(items)).toContain("Grabar");
    expect(names(items)).toContain("Salir");
  });

  it("wires each item to its action", () => {
    const a = actions();
    const items = build(true, a);
    for (const label of [
      "Open",
      "Stop recording",
      "Take screenshot",
      "Library",
      "Settings…",
      "Quit",
    ]) {
      click(items.find((i) => i.label === label));
    }
    for (const item of submenu(items)) click(item);
    for (const fn of Object.values(a)) expect(fn).toHaveBeenCalledTimes(1);
  });
});
