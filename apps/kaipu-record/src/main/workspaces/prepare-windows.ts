/** What `prepare` needs of a `BrowserWindow`, so it can be tested without Electron. */
export interface PrepareWindow {
  isDestroyed(): boolean;
  once(event: "closed", listener: () => void): unknown;
  removeListener(event: "closed", listener: () => void): unknown;
  webContents: {
    isCrashed(): boolean;
    send(channel: string, payload: { requestId: number }): void;
    once(event: "render-process-gone" | "destroyed", listener: () => void): unknown;
    removeListener(event: "render-process-gone" | "destroyed", listener: () => void): unknown;
  };
}

/**
 * The prepare round of a workspace switch: ask every window to flush, ask about unsaved
 * work and close its editors, then wait for all of them.
 *
 * A window that does not answer in time cancels the switch. A window that closes, is
 * destroyed or loses its renderer while waiting has nothing left to flush: it counts as
 * prepared at once, instead of holding the switch (and every other one) for the timeout.
 */
export class PrepareRequests {
  private nextRequestId = 0;
  private readonly pending = new Map<number, (ok: boolean) => void>();

  constructor(
    private readonly channel: string,
    private readonly timeoutMs: number,
  ) {}

  /** A window's answer to its request; an unknown or late id is ignored. */
  answer(requestId: number, ok: boolean): void {
    this.pending.get(requestId)?.(ok);
  }

  prepare(windows: PrepareWindow[]): Promise<boolean> {
    const live = windows.filter((w) => !w.isDestroyed() && !w.webContents.isCrashed());
    return Promise.all(live.map((window) => this.ask(window))).then((answers) =>
      answers.every(Boolean),
    );
  }

  private ask(window: PrepareWindow): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const requestId = ++this.nextRequestId;
      const finish = (ok: boolean): void => {
        clearTimeout(timer);
        this.pending.delete(requestId);
        window.removeListener("closed", gone);
        if (!window.isDestroyed()) {
          window.webContents.removeListener("render-process-gone", gone);
          window.webContents.removeListener("destroyed", gone);
        }
        resolve(ok);
      };
      const gone = (): void => finish(true);
      const timer = setTimeout(() => finish(false), this.timeoutMs);
      this.pending.set(requestId, finish);
      window.once("closed", gone);
      window.webContents.once("render-process-gone", gone);
      window.webContents.once("destroyed", gone);
      window.webContents.send(this.channel, { requestId });
    });
  }
}
