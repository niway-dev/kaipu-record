import { app, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { resolve, join } from "node:path";
import { isTrustedAppUrl, type TrustedOrigin } from "./trusted-url";

/** The renderer origin this build serves its own windows from. */
export function appOrigin(): TrustedOrigin {
  return {
    rendererFilePath: resolve(join(__dirname, "../renderer/index.html")),
    devOrigin: app.isPackaged ? undefined : process.env["ELECTRON_RENDERER_URL"] : undefined,
  };
}

/** True when the URL is one of our own renderer pages. */
export function isAppUrl(url: string | undefined | null): boolean {
  return isTrustedAppUrl(url, appOrigin());
}

/**
 * An IPC message is trusted only when it comes from the top frame of a page we
 * loaded ourselves. A navigated-away window, a sub-frame, or any other
 * `webContents` is refused, whatever channel it talks to.
 */
export function isTrustedSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame) return false;
  if (frame !== event.sender.mainFrame) return false;
  return isAppUrl(frame.url);
}

// Electron's own listener types are generic over the args; ours forward them
// untouched, so the handlers keep their precise parameter types.
// oxlint-disable-next-line typescript/no-explicit-any
type Args = any[];

/**
 * Drop-in replacements for `ipcMain.handle` / `ipcMain.on` that check the sender
 * before the listener runs. Every channel must be registered through these.
 */
export const secureIpc = {
  handle(
    channel: string,
    listener: (event: IpcMainInvokeEvent, ...args: Args) => unknown,
  ): void {
    ipcMain.handle(channel, (event, ...args) => {
      if (!isTrustedSender(event)) throw new Error(`Rejected IPC call on "${channel}"`);
      return listener(event, ...args);
    });
  },
  on(channel: string, listener: (event: IpcMainEvent, ...args: Args) => void): void {
    ipcMain.on(channel, (event, ...args) => {
      if (!isTrustedSender(event)) {
        console.warn(`Rejected IPC message on "${channel}"`);
        return;
      }
      listener(event, ...args);
    });
  },
};
