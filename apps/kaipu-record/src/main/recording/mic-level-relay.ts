import { IPC_CHANNELS } from "@shared/types/ipc";

/** The slice of a webContents the relay needs. */
export interface MicLevelTarget {
  id: number;
  send(channel: string, ...args: unknown[]): void;
  isDestroyed(): boolean;
}

export interface MicLevelRelay {
  /** A window wants the levels. Counted: a window may subscribe more than once. */
  subscribe(target: MicLevelTarget): void;
  /** One subscription of that window is gone. */
  unsubscribe(id: number): void;
  /** The window is gone for good (its webContents was destroyed). */
  remove(id: number): void;
  /** The recorder's latest levels: sent to subscribed windows only. */
  publish(levels: number[]): void;
  /** Whether any live window is subscribed. */
  listening(): boolean;
}

/**
 * Routes the recording's microphone levels to the windows that asked for them. They used to
 * ride the recording-activity broadcast, which re-rendered every window ~10 times a second
 * for the whole take. Now the recorder only sends while at least one window is subscribed
 * (main tells it when that changes), and main relays to those windows alone.
 */
export function createMicLevelRelay(getRecorder: () => MicLevelTarget | null): MicLevelRelay {
  const subscribers = new Map<number, { target: MicLevelTarget; count: number }>();
  let announced = false;

  const prune = (): void => {
    for (const [id, entry] of subscribers) if (entry.target.isDestroyed()) subscribers.delete(id);
  };
  const sync = (): void => {
    prune();
    const now = subscribers.size > 0;
    if (now === announced) return;
    announced = now;
    const recorder = getRecorder();
    if (recorder && !recorder.isDestroyed()) {
      recorder.send(IPC_CHANNELS.micLevelsListening, now);
    }
  };

  return {
    subscribe(target) {
      const entry = subscribers.get(target.id);
      if (entry) entry.count += 1;
      else subscribers.set(target.id, { target, count: 1 });
      sync();
    },
    unsubscribe(id) {
      const entry = subscribers.get(id);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count <= 0) subscribers.delete(id);
      sync();
    },
    remove(id) {
      subscribers.delete(id);
      sync();
    },
    publish(levels) {
      prune();
      for (const { target } of subscribers.values()) {
        target.send(IPC_CHANNELS.micLevelsData, levels);
      }
      sync();
    },
    listening() {
      prune();
      return subscribers.size > 0;
    },
  };
}
