/**
 * Which tray image each platform shows for each capture mode, free of Electron
 * so it can be tested on its own. `tray.ts` maps the file names to bundled paths.
 *
 *  - macOS (and Linux, unchanged): black-on-alpha PNGs marked as template images,
 *    which the menu bar recolours for light and dark appearances.
 *  - Windows: the taskbar recolours nothing and is dark by default, so it gets
 *    .ico files with a light glyph (16/24/32 px, see generate-app-icons.sh).
 */

/** The capture mode the tray icon is showing. */
export type TrayState = "record" | "screenshot";

export type TrayIconFile =
  | "tray-recording.png"
  | "tray-screenshot.png"
  | "tray-windows-recording.ico"
  | "tray-windows-screenshot.ico";

export interface TrayIcon {
  file: TrayIconFile;
  /** Mark it as a macOS template image (`setTemplateImage(true)`). */
  template: boolean;
}

export function trayIconFor(state: TrayState, platform: NodeJS.Platform): TrayIcon {
  if (platform === "win32") {
    return {
      file: state === "record" ? "tray-windows-recording.ico" : "tray-windows-screenshot.ico",
      template: false,
    };
  }
  return {
    file: state === "record" ? "tray-recording.png" : "tray-screenshot.png",
    template: true,
  };
}
