import { vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { STUB_SETTINGS } from "./stub-settings";

type SettingsListener = (settings: AppSettings) => void;

export interface SettingsIpc {
  /** `window.electronAPI.getSettings`: how many times the window asked main. */
  getSettings: ReturnType<typeof vi.fn<() => Promise<AppSettings>>>;
  /** `window.electronAPI.onSettingsChanged`: how many `settings:changed` listeners were opened. */
  onSettingsChanged: ReturnType<typeof vi.fn<(listener: SettingsListener) => () => void>>;
  /** The `settings:changed` listeners open right now (opened and not yet unsubscribed). */
  activeSubscriptions(): number;
  /** Main's broadcast: every open listener hears `settings`. */
  broadcast(settings: AppSettings): void;
  /** Answers a read held back with `deferRead`. */
  resolveRead(settings?: AppSettings): void;
  /** Fails a read held back with `deferRead`. */
  rejectRead(error?: Error): void;
}

/**
 * Replaces the settings half of `window.electronAPI` with a fake main process that counts: the
 * reads, the `settings:changed` listeners and the ones still open. `deferRead` holds the first
 * `getSettings()` until the test answers it, which is how a broadcast is made to land first.
 * The store resets after every test (see setup.ts); the stubs it leaves on `electronAPI` are
 * the next call's to replace.
 */
export function installSettingsIpc(
  initial: AppSettings = STUB_SETTINGS as unknown as AppSettings,
  options: { deferRead?: boolean } = {},
): SettingsIpc {
  const listeners = new Set<SettingsListener>();
  let latest = initial;
  let answer: ((settings: AppSettings) => void) | null = null;
  let fail: ((error: Error) => void) | null = null;
  const getSettings = vi.fn(
    () =>
      new Promise<AppSettings>((resolve, reject) => {
        if (options.deferRead) {
          answer = resolve;
          fail = reject;
        } else {
          resolve(latest);
        }
      }),
  );
  const onSettingsChanged = vi.fn((listener: SettingsListener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  });
  window.electronAPI.getSettings = getSettings;
  window.electronAPI.onSettingsChanged = onSettingsChanged;
  return {
    getSettings,
    onSettingsChanged,
    activeSubscriptions: () => listeners.size,
    broadcast(settings) {
      latest = settings;
      for (const listener of [...listeners]) listener(settings);
    },
    resolveRead(settings = latest) {
      answer?.(settings);
    },
    rejectRead(error = new Error("read failed")) {
      fail?.(error);
    },
  };
}
