import { StrictMode } from "react";
import { act, render, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AppSettings } from "@shared/types";
import { STUB_SETTINGS } from "../test/stub-settings";
import { installSettingsIpc } from "../test/settings-ipc";

/**
 * How many `settings:changed` listeners and startup `getSettings()` reads one renderer window
 * makes (ADR 0063). The main window used to open twelve listeners on the Record page, past Node's
 * limit of ten, and Node warned `MaxListenersExceededWarning`.
 *
 * The main window is rendered the way main.tsx renders it: `<App />` (the real hash router,
 * `AppRoot`, `AppShell` and the pages) inside `I18nRoot`, under `StrictMode`, whose effect replay
 * is what made the warning print twice. The full tree is practical in jsdom because the stubbed
 * `electronAPI` in test/setup.ts answers every call the shell and these pages make; only
 * `navigator.mediaDevices`, which jsdom lacks, is added below. The fake main process is
 * installed BEFORE the app modules are imported, because the recorder store reads the settings
 * at import (it is one of the window's consumers), exactly as it does when main.tsx loads it.
 */

// The i18n stub in test/setup.ts replaces the provider with a pass-through. This file wants the
// real one: its `subscribeExternal` is one of the settings consumers being counted.
vi.mock("@kaipu/i18n", async (importOriginal) => importOriginal());

const SETTINGS = STUB_SETTINGS as unknown as AppSettings;

const settle = (ms = 25): Promise<void> =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });

beforeAll(() => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      enumerateDevices: async () => [],
      addEventListener: () => {},
      removeEventListener: () => {},
    },
  });
});

describe("settings listeners per window", () => {
  it("the main window has 1 listener and 1 startup read on Record, and still 1 after 20 route changes", async () => {
    window.location.hash = "#/";
    const ipc = installSettingsIpc(SETTINGS);
    const { I18nRoot } = await import("./i18n-root");
    const { default: App } = await import("./app");
    const element = await I18nRoot({ children: <App /> });
    render(<StrictMode>{element}</StrictMode>);
    await waitFor(() => expect(document.body.textContent).toContain("Kaipu Record"));
    await settle();

    expect(ipc.activeSubscriptions()).toBe(1);
    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);

    // Record <-> Library <-> Settings <-> Shortcuts: pages that read settings mount and unmount.
    const routes = ["#/library", "#/settings/general", "#/shortcuts", "#/"];
    for (let step = 0; step < 20; step += 1) {
      const before = document.body.textContent;
      window.location.hash = routes[step % routes.length]!;
      await waitFor(() => expect(document.body.textContent).not.toBe(before));
      await settle(10);
      expect(ipc.activeSubscriptions()).toBe(1);
    }

    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
  });

  it("the capture panel has 1 listener and 1 startup read", async () => {
    const ipc = installSettingsIpc(SETTINGS);
    const { I18nRoot } = await import("./i18n-root");
    const { CapturePanel } = await import("@renderer/features/capture-panel/capture-panel");
    const element = await I18nRoot({ children: <CapturePanel /> });
    render(<StrictMode>{element}</StrictMode>);
    await settle(50);

    expect(ipc.activeSubscriptions()).toBe(1);
    expect(ipc.onSettingsChanged).toHaveBeenCalledTimes(1);
    expect(ipc.getSettings).toHaveBeenCalledTimes(1);
  });
});
