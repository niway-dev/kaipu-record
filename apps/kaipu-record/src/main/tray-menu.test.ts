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
  adminMode: "Admin mode",
  quit: "Quit",
};

const shortcuts = {
  startRecording: "Command+Control+X",
  captureScreenshot: "Command+Shift+1",
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
    openAdminMode: vi.fn(),
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

  it("idle: the Record submenu is enabled and shows no accelerators", () => {
    const sub = submenu(build(false));
    expect(names(sub)).toEqual(["Record screen", "Record area", "Record window…"]);
    expect(sub.map((i) => i.enabled)).toEqual([true, true, true]);
    // startRecording opens the last used mode, not always Screen: not shown on Record screen.
    expect(sub[0]!.accelerator).toBeUndefined();
    expect(sub[1]!.accelerator).toBeUndefined();
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
    expect(stop).toMatchObject({ accelerator: "Command+Control+X", registerAccelerator: false });
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
    // The Admin mode line has its own tests below: it only exists for an admin.
    const { openAdminMode, ...wired } = a;
    for (const fn of Object.values(wired)) expect(fn).toHaveBeenCalledTimes(1);
    expect(openAdminMode).not.toHaveBeenCalled();
  });

  describe("Admin mode line (ADR 0067)", () => {
    const withAdmin = (
      admin: { isAdmin: boolean; effective: boolean } | undefined,
      a = actions(),
    ): MenuItemConstructorOptions[] =>
      buildTrayMenuTemplate({ labels, actions: a, shortcuts, recording: false, admin });
    const line = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions | undefined =>
      items.find((i) => i.label === "Admin mode");

    it("shows a checked line while Admin mode is effective", () => {
      const item = line(withAdmin({ isAdmin: true, effective: true }));
      expect(item).toMatchObject({ type: "checkbox", checked: true });
      expect(item?.enabled).not.toBe(false);
    });

    it("keeps the checked line after the admin signed out, while the mode is still effective", () => {
      expect(line(withAdmin({ isAdmin: false, effective: true }))).toMatchObject({
        type: "checkbox",
        checked: true,
      });
    });

    it("shows an unchecked line for an admin account in User mode", () => {
      expect(line(withAdmin({ isAdmin: true, effective: false }))).toMatchObject({
        type: "checkbox",
        checked: false,
      });
    });

    it("has no line for a non-admin account, or when no admin state is given", () => {
      expect(line(withAdmin({ isAdmin: false, effective: false }))).toBeUndefined();
      expect(line(withAdmin(undefined))).toBeUndefined();
    });

    it("sits right after Settings and clicking it opens Settings, App", () => {
      const a = actions();
      const items = withAdmin({ isAdmin: true, effective: true }, a);
      const labelsInOrder = names(items);
      expect(labelsInOrder.indexOf("Admin mode")).toBe(labelsInOrder.indexOf("Settings…") + 1);
      click(line(items));
      expect(a.openAdminMode).toHaveBeenCalledTimes(1);
    });
  });
});
