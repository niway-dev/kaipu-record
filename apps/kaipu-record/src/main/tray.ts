import { app, Menu, nativeImage, Tray } from "electron";
import trayIconPath from "../../resources/tray.png?asset";
import { createMainTranslator } from "@kaipu/i18n/main";
import type { Locale } from "@kaipu/i18n";
import type { CapturePanelWindow } from "./capture-panel-window";

/**
 * Creates the menu-bar tray icon.
 *  - Left click  → toggle the Capture Panel anchored to the tray.
 *  - Right click → context menu (open main window / quit), translated.
 *
 * `tray.png` is a monochrome black+alpha template image; `setTemplateImage(true)`
 * lets macOS recolor it for light/dark menu bars automatically.
 *
 * The context menu is rebuilt on locale change (see `rebuildTrayMenu`) — native
 * menu labels can't be mutated in place.
 */

let showMain: (() => void) | null = null;
let contextMenu: Menu | null = null;

function buildContextMenu(locale: Locale): Menu {
  const t = createMainTranslator(locale);
  return Menu.buildFromTemplate([
    { label: t("tray.open"), click: () => showMain?.() },
    { type: "separator" },
    { label: t("tray.quit"), click: () => app.quit() },
  ]);
}

export function createTray(
  panel: CapturePanelWindow,
  showMainWindow: () => void,
  initialLocale: Locale,
): Tray {
  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  showMain = showMainWindow;
  tray.setToolTip("Kaipu Record");

  tray.on("click", () => panel.toggle(tray.getBounds()));

  contextMenu = buildContextMenu(initialLocale);
  tray.on("right-click", () => {
    if (contextMenu) tray.popUpContextMenu(contextMenu);
  });

  return tray;
}

/** Rebuild the tray context menu in a new language. Safe to call before createTray (no-op). */
export function rebuildTrayMenu(locale: Locale): void {
  contextMenu = buildContextMenu(locale);
}
