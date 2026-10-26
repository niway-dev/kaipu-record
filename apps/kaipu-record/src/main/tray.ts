import { app, Menu, nativeImage, type NativeImage, Tray } from "electron";
import trayRecordingPath from "../../resources/tray-recording.png?asset";
import trayScreenshotPath from "../../resources/tray-screenshot.png?asset";
import trayWindowsRecordingPath from "../../resources/tray-windows-recording.ico?asset";
import trayWindowsScreenshotPath from "../../resources/tray-windows-screenshot.ico?asset";
import { createMainTranslator } from "@kaipu/i18n/main";
import type { Locale } from "@kaipu/i18n";
import type { CapturePanelWindow } from "./capture-panel-window";
import { buildTrayMenuTemplate, type TrayMenuActions } from "./tray-menu";
import type { ShortcutSettings } from "@shared/types";
import { trayIconFor, type TrayIconFile, type TrayState } from "./tray-icon";

export type { TrayState } from "./tray-icon";

/**
 * Creates the menu-bar tray icon.
 *  - Left click  → toggle the Capture Panel anchored to the tray.
 *  - Right click → context menu (Open, Record submenu, Stop while recording,
 *    screenshot, Library, Settings, Quit), translated. See `tray-menu.ts`.
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

/** What the menu needs from main: the things it triggers and the live bindings. */
export interface TrayMenuDeps {
  actions: Omit<TrayMenuActions, "open" | "quit">;
  getShortcuts: () => ShortcutSettings;
}

let menuDeps: TrayMenuDeps | null = null;
let currentLocale: Locale = "en";
let recording = false;
let countingDown = false;

function buildContextMenu(locale: Locale): Menu {
  const t = createMainTranslator(locale);
  const deps = menuDeps;
  const noop = (): void => {};
  return Menu.buildFromTemplate(
    buildTrayMenuTemplate({
      labels: {
        open: t("tray.open"),
        record: t("tray.record"),
        recordScreen: t("tray.recordScreen"),
        recordArea: t("tray.recordArea"),
        recordWindow: t("tray.recordWindow"),
        stopRecording: t("tray.stopRecording"),
        cancelCountdown: t("tray.cancelCountdown"),
        takeScreenshot: t("tray.takeScreenshot"),
        library: t("tray.library"),
        settings: t("tray.settings"),
        quit: t("tray.quit"),
      },
      actions: {
        open: () => showMain?.(),
        quit: () => app.quit(),
        recordScreen: deps?.actions.recordScreen ?? noop,
        recordArea: deps?.actions.recordArea ?? noop,
        recordWindow: deps?.actions.recordWindow ?? noop,
        stopRecording: deps?.actions.stopRecording ?? noop,
        takeScreenshot: deps?.actions.takeScreenshot ?? noop,
        openLibrary: deps?.actions.openLibrary ?? noop,
        openSettings: deps?.actions.openSettings ?? noop,
      },
      shortcuts: deps?.getShortcuts() ?? ({} as ShortcutSettings),
      recording,
      countingDown,
    }),
  );
}

/**
 * Tell the tray whether a recording is active (or paused). Rebuilds the menu only
 * on a change: the hub reports every status flip and timer tick.
 */
export function setTrayRecording(active: boolean): void {
  if (active === recording) return;
  recording = active;
  contextMenu = buildContextMenu(currentLocale);
}

/** Tell the tray a take is pending (countdown or acquiring). Rebuilds only on a change. */
export function setTrayCountdown(pending: boolean): void {
  if (pending === countingDown) return;
  countingDown = pending;
  contextMenu = buildContextMenu(currentLocale);
}

export function createTray(
  panel: CapturePanelWindow,
  showMainWindow: () => void,
  initialLocale: Locale,
  deps: TrayMenuDeps,
): Tray {
  menuDeps = deps;
  currentLocale = initialLocale;
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
  currentLocale = locale;
  contextMenu = buildContextMenu(locale);
}
