import type { MenuItemConstructorOptions } from "electron";
import type { ShortcutSettings } from "@shared/types";

/**
 * The tray's right-click menu as a plain template, kept apart from `tray.ts` so it
 * can be tested without Electron ("Kaipu Record Modes v2", section 5).
 *
 * Accelerators are display-only (`registerAccelerator: false`): the global
 * shortcuts are registered once by `global-shortcuts.ts`, and a second
 * registration from a menu item would fight it on Windows/Linux.
 */

/** The tray-menu labels, translated by the caller (main's translator). */
export interface TrayMenuLabels {
  open: string;
  record: string;
  recordScreen: string;
  recordArea: string;
  recordWindow: string;
  stopRecording: string;
  takeScreenshot: string;
  library: string;
  settings: string;
  quit: string;
}

export interface TrayMenuActions {
  open(): void;
  recordScreen(): void;
  recordArea(): void;
  recordWindow(): void;
  stopRecording(): void;
  takeScreenshot(): void;
  openLibrary(): void;
  openSettings(): void;
  quit(): void;
}

export interface TrayMenuInput {
  labels: TrayMenuLabels;
  actions: TrayMenuActions;
  shortcuts: ShortcutSettings;
  /** A recording is active or paused. Pause keeps Stop enabled, so it is not a separate input. */
  recording: boolean;
}

/** Display-only accelerator; an empty binding shows nothing. */
function display(accelerator: string | undefined): Partial<MenuItemConstructorOptions> {
  if (!accelerator) return {};
  return { accelerator, registerAccelerator: false };
}

export function buildTrayMenuTemplate(input: TrayMenuInput): MenuItemConstructorOptions[] {
  const { labels, actions, shortcuts, recording } = input;
  const items: MenuItemConstructorOptions[] = [
    {
      label: labels.open,
      ...display("CommandOrControl+O"),
      click: actions.open,
    },
    { type: "separator" },
    {
      label: labels.record,
      submenu: [
        {
          label: labels.recordScreen,
          enabled: !recording,
          ...display(shortcuts.startRecording),
          click: actions.recordScreen,
        },
        {
          label: labels.recordArea,
          enabled: !recording,
          ...display(shortcuts.recordArea),
          click: actions.recordArea,
        },
        { label: labels.recordWindow, enabled: !recording, click: actions.recordWindow },
      ],
    },
  ];
  if (recording) {
    items.push({
      label: labels.stopRecording,
      ...display(shortcuts.stopRecording),
      click: actions.stopRecording,
    });
  }
  items.push(
    {
      label: labels.takeScreenshot,
      ...display(shortcuts.captureScreenshot),
      click: actions.takeScreenshot,
    },
    { type: "separator" },
    { label: labels.library, click: actions.openLibrary },
    { label: labels.settings, click: actions.openSettings },
    { type: "separator" },
    { label: labels.quit, click: actions.quit },
  );
  return items;
}
