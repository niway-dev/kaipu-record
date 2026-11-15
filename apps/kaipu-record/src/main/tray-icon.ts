/**
 * Which tray image each platform shows, free of Electron
 * so it can be tested on its own. `tray.ts` maps the file names to bundled paths.
 *
 *  - macOS (and Linux, unchanged): black-on-alpha PNGs marked as template images,
 *    which the menu bar recolours for light and dark appearances.
 *  - Windows: the taskbar recolours nothing and is dark by default, so it gets
 *    .ico files with a light glyph (16/24/32 px, see generate-app-icons.sh).
 */

export type TrayIconFile = "tray-screenshot.png" | "tray-windows-screenshot.ico";

export interface TrayIcon {
  file: TrayIconFile;
  /** Mark it as a macOS template image (`setTemplateImage(true)`). */
  template: boolean;
}

export function trayIconFor(platform: NodeJS.Platform): TrayIcon {
  if (platform === "win32") return { file: "tray-windows-screenshot.ico", template: false };
  return { file: "tray-screenshot.png", template: true };
}
