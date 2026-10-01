import { app, Menu, nativeImage, Tray } from "electron";
import trayRecordingPath from "../../resources/tray-recording.png?asset";
import trayScreenshotPath from "../../resources/tray-screenshot.png?asset";
import { createMainTranslator } from "@kaipu/i18n/main";
import type { Locale } from "@kaipu/i18n";
import type { CapturePanelWindow } from "./capture-panel-window";

/**
 * Creates the menu-bar tray icon.
 *  - Left click  → toggle the Capture Panel anchored to the tray.
 *  - Right click → context menu (open main window / quit), translated.
 *
 * Each icon is a monochrome black+alpha template image; `setTemplateImage(true)`
 * lets macOS recolor it for light/dark menu bars automatically.
 *
 * The icon follows the mode the capture panel has selected: the fox with its
 * record dot for Record, the framed fox for Screenshot. There is no third
 * "idle" icon because there is no idle mode — one of the two is always chosen,
 * and the menu bar is often the only part of Kaipu on screen, so it should say
 * which.
 *
 * The context menu is rebuilt on locale change (see `rebuildTrayMenu`) — native
 * menu labels can't be mutated in place.
 */

let showMain: (() => void) | null = null;
let contextMenu: Menu | null = null;
let trayRef: Tray | null = null;

/** The capture mode the menu-bar icon is showing. */
export type TrayState = "record" | "screenshot";

const TRAY_ICONS: Record<TrayState, string> = {
  record: trayRecordingPath,
  screenshot: trayScreenshotPath,
};

let trayState: TrayState = "record";

/**
 * Swap the menu-bar icon for the selected mode. Safe before the tray exists, and
 * a no-op when nothing changed — the panel re-sends its selection on every
 * render, and reloading the image each time would repaint the menu bar for no
 * reason.
 */
export function setTrayState(state: TrayState): void {
  if (state === trayState) return;
  trayState = state;
  if (!trayRef || trayRef.isDestroyed()) return;
  const icon = nativeImage.createFromPath(TRAY_ICONS[state]);
  icon.setTemplateImage(true);
  trayRef.setImage(icon);
}

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
  const icon = nativeImage.createFromPath(TRAY_ICONS[trayState]);
  icon.setTemplateImage(true);

  const tray = new Tray(icon);
  trayRef = tray;
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
