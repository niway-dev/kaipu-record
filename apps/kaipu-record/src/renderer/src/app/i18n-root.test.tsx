import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type AppSettings, DEFAULT_SHORTCUTS } from "@shared/types";
import { DEFAULT_QUALITY } from "@shared/recording-quality";
import { I18nRoot } from "./i18n-root";

const SETTINGS: AppSettings = {
  theme: "dark",
  locale: "es",
  launchAtLogin: false,
  showInDock: true,
  recordingQuality: DEFAULT_QUALITY,
  showBarInRecording: false,
  shortcuts: DEFAULT_SHORTCUTS,
  deviceId: "",
};

describe("I18nRoot theme application", () => {
  beforeEach(() => {
    window.electronAPI.getSettings = vi.fn(async () => SETTINGS);
  });

  afterEach(() => {
    delete document.documentElement.dataset.theme;
  });

  it("applies the persisted theme before the provider mounts", async () => {
    window.electronAPI.getSettings = vi.fn(async () => ({ ...SETTINGS, theme: "light" as const }));
    await I18nRoot({ children: null });
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("leaves dark with no data-theme attribute", async () => {
    await I18nRoot({ children: null });
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  it("re-applies the theme when a settings broadcast arrives", async () => {
    // Held in a ref object (rather than a plain `let`) so TS keeps the declared
    // union type at the read below — a bare `let` reassigned only inside the
    // nested closure narrows to `never` under this project's strict tsconfig.
    const broadcastRef: { current: ((settings: AppSettings) => void) | null } = { current: null };
    window.electronAPI.onSettingsChanged = ((callback: (settings: AppSettings) => void) => {
      broadcastRef.current = callback;
      return () => {};
    }) as typeof window.electronAPI.onSettingsChanged;

    const element = await I18nRoot({ children: null });
    // The provider calls subscribeExternal on mount; invoke it directly since
    // we never mount. `apply` only needs to accept the locale.
    (
      element.props as { subscribeExternal: (apply: (locale: string) => void) => void }
    ).subscribeExternal(() => {});
    broadcastRef.current?.({ ...SETTINGS, theme: "light" });
    expect(document.documentElement.dataset.theme).toBe("light");
  });
});
