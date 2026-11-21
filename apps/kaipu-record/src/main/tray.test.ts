import { describe, expect, it, vi } from "vitest";

interface BuiltMenu {
  template: Array<{ label?: string; type?: string; checked?: boolean; click?: () => void }>;
}

const built: BuiltMenu[] = [];
const popped: BuiltMenu[] = [];
const trayHandlers = new Map<string, () => void>();

vi.mock("electron", () => ({
  app: { quit: vi.fn() },
  Menu: {
    buildFromTemplate: (template: BuiltMenu["template"]) => {
      const menu = { template };
      built.push(menu);
      return menu;
    },
  },
  nativeImage: { createFromPath: () => ({ setTemplateImage: vi.fn() }) },
  Tray: class {
    setToolTip(): void {}
    getBounds(): object {
      return {};
    }
    on(event: string, handler: () => void): void {
      trayHandlers.set(event, handler);
    }
    popUpContextMenu(menu: BuiltMenu): void {
      popped.push(menu);
    }
  },
}));
vi.mock("../../resources/tray-screenshot.png?asset", () => ({ default: "tray.png" }));
vi.mock("../../resources/tray-windows-screenshot.ico?asset", () => ({ default: "tray.ico" }));

const { createTray, setTrayAdmin } = await import("./tray");

describe("tray Admin mode line", () => {
  it("rebuilds the cached menu after a click, so Electron's own check flip never sticks", () => {
    const openAdminMode = vi.fn();
    const noop = vi.fn();
    setTrayAdmin({ isAdmin: true, effective: true });
    createTray({ toggle: vi.fn() } as never, vi.fn(), "en", {
      actions: {
        recordScreen: noop,
        recordArea: noop,
        recordWindow: noop,
        stopRecording: noop,
        takeScreenshot: noop,
        openLibrary: noop,
        openSettings: noop,
        openAdminMode,
      },
      getShortcuts: () => ({}) as never,
    });
    const first = built.at(-1)!;
    const line = first.template.find((item) => item.type === "checkbox");
    expect(line?.checked).toBe(true);

    // Electron flips `checked` on the clicked item before running its handler.
    line!.checked = false;
    line!.click!();
    expect(openAdminMode).toHaveBeenCalledTimes(1);

    trayHandlers.get("right-click")!();
    const shown = popped.at(-1)!;
    expect(shown).not.toBe(first);
    expect(shown.template.find((item) => item.type === "checkbox")?.checked).toBe(true);
  });
});
