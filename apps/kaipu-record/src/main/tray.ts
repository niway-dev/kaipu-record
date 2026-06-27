import { app, Menu, nativeImage, Tray } from "electron";
import trayIconPath from "../../resources/tray.png?asset";
import type { CapturePanelWindow } from "./capture-panel-window";

/**
 * Creates the menu-bar tray icon.
 *  - Left click  → toggle the Capture Panel anchored to the tray.
 *  - Right click → context menu (open main window / quit).
 *
 * `tray.png` is a monochrome black+alpha template image; `setTemplateImage(true)`
 * lets macOS recolor it for light/dark menu bars automatically.
 */
export function createTray(panel: CapturePanelWindow, showMainWindow: () => void): Tray {
  const icon = nativeImage.createFromPath(trayIconPath);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  tray.setToolTip("Kaipu Record");

  tray.on("click", () => panel.toggle(tray.getBounds()));

  const contextMenu = Menu.buildFromTemplate([
    { label: "Open Kaipu Record", click: () => showMainWindow() },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.on("right-click", () => tray.popUpContextMenu(contextMenu));

  return tray;
}
