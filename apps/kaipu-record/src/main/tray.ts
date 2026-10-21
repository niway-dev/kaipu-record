import { app, Menu, nativeImage, type NativeImage, Tray } from "electron";
import trayRecordingPath from "../../resources/tray-recording.png?asset";
import trayScreenshotPath from "../../resources/tray-screenshot.png?asset";
import trayWindowsRecordingPath from "../../resources/tray-windows-recording.ico?asset";
import trayWindowsScreenshotPath from "../../resources/tray-windows-screenshot.ico?asset";
import { createMainTranslator } from "@kaipu/i18n/main";
import type { Locale } from "@kaipu/i18n";
import type { CapturePanelWindow } from "./capture-panel-window";
import { trayIconFor, type TrayIconFile, type TrayState } from "./tray-icon";

export type { TrayState } from "./tray-icon";

/**
 * Creates the menu-bar tray icon.
 *  - Left click  → toggle the Capture Panel anchored to the tray.
 *  - Right click → context menu (open main window / quit), translated.
 *
 * On macOS each icon is a monochrome black+alpha template image;
 * `setTemplateImage(true)` lets macOS recolor it for light/dark menu bars
 * automatically. Windows does not recolor tray icons, so it gets light-glyph
 * .ico files instead (see `tray-icon.ts`).
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

const TRAY_ICON_PATHS: Record<TrayIconFile, string> = {
  "tray-recording.png": trayRecordingPath,
  "tray-screenshot.png": trayScreenshotPath,
  "tray-windows-recording.ico": trayWindowsRecordingPath,
  "tray-windows-screenshot.ico": trayWindowsScreenshotPath,
};

/** The tray image for a mode on this platform, marked as a template where macOS wants one. */
function loadTrayIcon(state: TrayState): NativeImage {
  const { file, template } = trayIconFor(state, process.platform);
  const icon = nativeImage.createFromPath(TRAY_ICON_PATHS[file]);
  if (template) icon.setTemplateImage(true);
  return icon;
}

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
  trayRef.setImage(loadTrayIcon(state));
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
  const tray = new Tray(loadTrayIcon(trayState));
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
