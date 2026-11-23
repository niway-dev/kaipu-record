import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import type {
  CopyToAllResult,
  OverridableKey,
  ResetOverridesResult,
  ResolvePendingResult,
  ScopedSettings,
  SetOverrideResult,
  SettingsOverrides,
} from "@shared/settings-scope";
import type { AppSettings } from "@shared/types";
import type { WorkspacesState } from "@shared/types/workspaces";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";
import { SettingsLayout } from "../settings-layout";
import {
  RecordingQualitySettingsPage,
  RecordingSettingsPage,
  ScreenshotsSettingsPage,
} from "../settings-pages";
import { PendingSettingsHost } from "./scope-controls";
import { useSettingsScope } from "./settings-scope";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("@renderer/ui/toast-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/ui/toast-store")>()),
  showToast,
}));

const view = (id: string, name: string, state: "available" | "unavailable" = "available") => ({
  id,
  name,
  color: "rose" as const,
  initials: name.slice(0, 1),
  path: `/Users/me/${name}`,
  volume: null,
  state,
  itemCount: 1,
  device: "1",
  sync: null,
});

function stateOf(activeId: string, ...names: Array<[string, string]>): WorkspacesState {
  return {
    activeId,
    generation: 1,
    hintDismissed: true,
    busy: null,
    readOnly: false,
    workspaces: names.map(([id, name]) => view(id, name)),
  };
}

const realApi = window.electronAPI;
let base: AppSettings;
let all: AppSettings;
/** What the next scoped read answers, per workspace id. */
let overridesOf: Record<string, SettingsOverrides>;
let folderOf: Record<string, ScopedSettings["folder"]>;
let pendingOf: Record<string, SettingsOverrides | null>;
let overriddenIn: ScopedSettings["overriddenIn"];
let pushWorkspaces: (state: WorkspacesState) => void;
let pushSettings: (settings: AppSettings) => void;

const getScoped = vi.fn<(scope: string) => Promise<ScopedSettings>>();
const setOverride =
  vi.fn<(id: string, key: OverridableKey, value: unknown) => Promise<SetOverrideResult>>();
const resetOverrides =
  vi.fn<(id: string, keys: readonly OverridableKey[]) => Promise<ResetOverridesResult>>();
const copyToAll =
  vi.fn<(id: string, keys: readonly OverridableKey[]) => Promise<CopyToAllResult>>();
const resolvePending =
  vi.fn<
    (id: string, decision: "use" | "ignore", sha256: string) => Promise<ResolvePendingResult>
  >();
const updateSettings = vi.fn<(patch: Partial<AppSettings>) => Promise<AppSettings>>();

beforeEach(async () => {
  base = await realApi.getSettings();
  all = { ...base, screenshotCopy: "auto", showBrandBadge: false };
  overridesOf = {};
  folderOf = {};
  pendingOf = {};
  overriddenIn = {};
  showToast.mockClear();
  for (const fn of [
    getScoped,
    setOverride,
    resetOverrides,
    copyToAll,
    resolvePending,
    updateSettings,
  ]) {
    fn.mockReset();
  }
  getScoped.mockImplementation(async (scope) => {
    const overrides = scope === "all" ? {} : (overridesOf[scope] ?? {});
    return {
      scope,
      all,
      overrides,
      effective: { ...all, ...overrides },
      folder: scope === "all" ? "none" : (folderOf[scope] ?? "none"),
      pending: scope === "all" ? null : (pendingOf[scope] ?? null),
      folderSha256: pendingOf[scope] ? "a".repeat(64) : null,
      overriddenIn: scope === "all" ? overriddenIn : {},
    };
  });
  const ok = { ok: true as const, settings: all };
  setOverride.mockResolvedValue(ok);
  resetOverrides.mockResolvedValue(ok);
  copyToAll.mockResolvedValue({ ...ok, keptOwn: [] });
  resolvePending.mockResolvedValue(ok);
  updateSettings.mockImplementation(async (patch) => ({ ...all, ...patch }));
});

afterEach(() => {
  window.electronAPI = realApi;
});

function install(state: WorkspacesState): void {
  window.electronAPI = {
    ...realApi,
    getSettings: async () => ({ ...all, ...overridesOf[state.activeId] }),
    updateSettings,
    onSettingsChanged: (callback) => {
      pushSettings = callback;
      return () => {};
    },
    settingsScope: { getScoped, setOverride, resetOverrides, copyToAll, resolvePending },
    workspaces: {
      ...realApi.workspaces,
      list: async () => state,
      onChanged: (callback) => {
        pushWorkspaces = callback;
        return () => {};
      },
    },
  };
}

function mountPage(
  page: "screenshots" | "recording" | "quality",
  state: WorkspacesState,
  extra?: React.ReactNode,
) {
  install(state);
  const element =
    page === "screenshots" ? (
      <ScreenshotsSettingsPage />
    ) : page === "recording" ? (
      <RecordingSettingsPage />
    ) : (
      <RecordingQualitySettingsPage />
    );
  const router = createMemoryRouter(
    [
      {
        path: "/settings",
        element: <SettingsLayout />,
        // `extra` sits inside the layout, so it shares the page's scope.
        children: [
          {
            index: true,
            element: (
              <>
                {element}
                {extra}
              </>
            ),
          },
        ],
      },
    ],
    { initialEntries: ["/settings"] },
  );
  return render(
    <WorkspacesProvider>
      <RouterProvider router={router} />
    </WorkspacesProvider>,
  );
}

const ONE = stateOf("ws-a", ["ws-a", "Alpha"]);
const TWO = stateOf("ws-a", ["ws-a", "Alpha"], ["ws-b", "Bravo"]);

async function toggle(): Promise<HTMLElement> {
  return screen.findByRole("switch", { name: /copy screenshots/i });
}

describe("one workspace (the selector stays hidden)", () => {
  it("shows no selector, tag, dot or source line when nothing is overridden", async () => {
    mountPage("screenshots", ONE);
    await toggle();
    expect(screen.queryByText("Settings for")).toBeNull();
    expect(screen.queryByTestId("scope-dot")).toBeNull();
    expect(screen.queryByText("Per workspace")).toBeNull();
    expect(screen.queryByText("Same as default")).toBeNull();
  });

  it("a row without an override edits the All level, as before", async () => {
    mountPage("screenshots", ONE);
    fireEvent.click(await toggle());
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ screenshotCopy: "manual" }));
    expect(setOverride).not.toHaveBeenCalled();
  });

  it("an overridden row says so, edits the override and can be reset", async () => {
    overridesOf = { "ws-a": { screenshotCopy: "manual" } };
    mountPage("screenshots", ONE);
    expect(await screen.findByText("Set for this workspace")).toBeInTheDocument();
    expect(await toggle()).not.toBeChecked();

    fireEvent.click(await toggle());
    await waitFor(() => expect(setOverride).toHaveBeenCalledWith("ws-a", "screenshotCopy", "auto"));
    expect(updateSettings).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /reset copy screenshots/i }));
    await waitFor(() => expect(resetOverrides).toHaveBeenCalledWith("ws-a", ["screenshotCopy"]));
  });

  it("the banner counts the page's overridden settings and resets them, with no copy to all", async () => {
    overridesOf = { "ws-a": { recordingQuality: base.recordingQuality, exportQuality: "maximum" } };
    mountPage("quality", ONE);
    expect(await screen.findByText("2 settings here differ from the default.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy all to every workspace" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await waitFor(() =>
      expect(resetOverrides).toHaveBeenCalledWith("ws-a", ["recordingQuality", "exportQuality"]),
    );
  });
});

describe("two or more workspaces", () => {
  it("shows the selector, the dots on the per-workspace pages, the legend and the scope tag", async () => {
    mountPage("screenshots", TWO);
    expect(await screen.findByText("Settings for")).toBeInTheDocument();
    expect(screen.getByText("Changes with the workspace")).toBeInTheDocument();
    expect(screen.getAllByTestId("scope-dot")).toHaveLength(3);
    expect(screen.getByText("Per workspace")).toBeInTheDocument();
  });

  it("opens on the active workspace and labels an inherited row 'Same as default'", async () => {
    mountPage("screenshots", TWO);
    expect(await screen.findByText("Same as default")).toBeInTheDocument();
    expect(getScoped).toHaveBeenCalledWith("ws-a");
    expect(
      screen.getByText("Showing the values for Alpha. Other workspaces keep their own."),
    ).toBeInTheDocument();
  });

  it("edits the workspace's override, and labels the row 'Set for <workspace>'", async () => {
    mountPage("screenshots", TWO);
    fireEvent.click(await toggle());
    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith("ws-a", "screenshotCopy", "manual"),
    );
    expect(updateSettings).not.toHaveBeenCalled();

    overridesOf = { "ws-a": { screenshotCopy: "manual" } };
    act(() => pushSettings({ ...all, screenshotCopy: "manual" }));
    expect(await screen.findByText("Set for Alpha")).toBeInTheDocument();
  });

  it("Copy to all workspaces copies the row's key and says when a workspace kept its own", async () => {
    copyToAll.mockResolvedValueOnce({ ok: true, settings: all, keptOwn: ["Bravo"] });
    mountPage("screenshots", TWO);
    fireEvent.click(await screen.findByRole("button", { name: /copy copy screenshots/i }));
    await waitFor(() => expect(copyToAll).toHaveBeenCalledWith("ws-a", ["screenshotCopy"]));
    await waitFor(() =>
      expect(showToast).toHaveBeenCalledWith({
        message: "Copied. Bravo keeps its own value because it couldn't be changed.",
      }),
    );
  });

  it("the banner copies every overridden key of the page to every workspace, or resets them", async () => {
    overridesOf = { "ws-a": { recordingQuality: base.recordingQuality, exportQuality: "maximum" } };
    mountPage("quality", TWO);
    expect(await screen.findByText("2 settings here differ from the default.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy all to every workspace" }));
    await waitFor(() =>
      expect(copyToAll).toHaveBeenCalledWith("ws-a", ["recordingQuality", "exportQuality"]),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reset to default" }));
    await waitFor(() =>
      expect(resetOverrides).toHaveBeenCalledWith("ws-a", ["recordingQuality", "exportQuality"]),
    );
  });

  it("the All scope shows the default, edits the All level and names who overrides it", async () => {
    overriddenIn = { screenshotCopy: ["Bravo"] };
    let pick: ((scope: string) => void) | undefined;
    function Picker(): null {
      pick = useSettingsScope().setScope;
      return null;
    }
    mountPage("screenshots", TWO, <Picker />);
    await screen.findByText("Same as default");
    act(() => pick?.("all"));
    expect(await screen.findByText("Overridden in Bravo")).toBeInTheDocument();
    fireEvent.click(await toggle());
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ screenshotCopy: "manual" }));
    expect(setOverride).not.toHaveBeenCalled();
    // Copy to all and Reset make no sense on the defaults themselves.
    expect(screen.queryByRole("button", { name: /copy copy screenshots/i })).toBeNull();
  });

  it("marks the rows that stay app-wide", async () => {
    mountPage("recording", TWO);
    await screen.findByText("Per workspace");
    expect(screen.getAllByText("App-wide").length).toBeGreaterThan(0);
  });

  it("a switch moves the page to the new workspace's values", async () => {
    overridesOf = { "ws-b": { screenshotCopy: "manual" } };
    mountPage("screenshots", TWO);
    expect(await screen.findByText("Same as default")).toBeInTheDocument();
    expect(await toggle()).toBeChecked();

    act(() => pushWorkspaces({ ...TWO, activeId: "ws-b", generation: 2 }));
    expect(await screen.findByText("Set for Bravo")).toBeInTheDocument();
    expect(getScoped).toHaveBeenCalledWith("ws-b");
    await waitFor(async () => expect(await toggle()).not.toBeChecked());
  });
});

describe("a folder that brings its own settings", () => {
  beforeEach(() => {
    folderOf = { "ws-a": "pending" };
    pendingOf = { "ws-a": { screenshotCopy: "manual" } };
  });

  it("the page says the defaults apply, and the controls are off until the user answers", async () => {
    mountPage("screenshots", TWO);
    expect(
      await screen.findByText(
        "Alpha brings its own settings. Until you answer, the defaults apply.",
      ),
    ).toBeInTheDocument();
    expect(await toggle()).toBeDisabled();
  });

  it("the page's Review opens the sheet, and 'Use them' names the file the user saw", async () => {
    mountPage("screenshots", TWO);
    fireEvent.click(await screen.findByRole("button", { name: "Pending review" }));
    const sheet = await screen.findByRole("alertdialog");
    expect(
      within(sheet).getByText(/Copy screenshots to the clipboard automatically:/),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(/Manual/)).toBeInTheDocument();
    expect(within(sheet).getByText(/replaces Auto/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Use them" }));
    await waitFor(() => expect(resolvePending).toHaveBeenCalledWith("ws-a", "use", "a".repeat(64)));
  });

  it("the shell asks once on its own, and 'Ignore' sends the answer", async () => {
    install(TWO);
    render(
      <WorkspacesProvider>
        <PendingSettingsHost />
      </WorkspacesProvider>,
    );
    const sheet = await screen.findByRole("alertdialog");
    expect(within(sheet).getByText(/This workspace brings its own settings/)).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole("button", { name: "Ignore" }));
    await waitFor(() =>
      expect(resolvePending).toHaveBeenCalledWith("ws-a", "ignore", "a".repeat(64)),
    );
  });

  it("closing the sheet decides nothing and does not ask again for the same file", async () => {
    install(TWO);
    render(
      <WorkspacesProvider>
        <PendingSettingsHost />
      </WorkspacesProvider>,
    );
    const sheet = await screen.findByRole("alertdialog");
    fireEvent.keyDown(sheet, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(resolvePending).not.toHaveBeenCalled();
    // Another read of the same file does not bring the sheet back.
    act(() => pushSettings(all));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("asks again when the file changed (a different hash)", async () => {
    install(TWO);
    render(
      <WorkspacesProvider>
        <PendingSettingsHost />
      </WorkspacesProvider>,
    );
    fireEvent.keyDown(await screen.findByRole("alertdialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    getScoped.mockImplementation(async (scope) => ({
      scope,
      all,
      overrides: {},
      effective: all,
      folder: "pending",
      pending: { screenshotCopy: "manual", showBrandBadge: true },
      folderSha256: "b".repeat(64),
      overriddenIn: {},
    }));
    act(() => pushSettings(all));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("says nothing when the file is already answered", async () => {
    folderOf = { "ws-a": "active" };
    pendingOf = {};
    install(TWO);
    render(
      <WorkspacesProvider>
        <PendingSettingsHost />
      </WorkspacesProvider>,
    );
    await waitFor(() => expect(getScoped).toHaveBeenCalled());
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});

describe("a file that cannot be used", () => {
  it("explains an unreadable file and disables the controls", async () => {
    folderOf = { "ws-a": "unreadable" };
    mountPage("screenshots", TWO);
    expect(
      await screen.findByText(
        "This workspace's settings file can't be read, so its own settings are off.",
      ),
    ).toBeInTheDocument();
    expect(await toggle()).toBeDisabled();
  });

  it("offers Review on an ignored file", async () => {
    folderOf = { "ws-a": "ignored" };
    pendingOf = { "ws-a": { screenshotCopy: "manual" } };
    mountPage("screenshots", TWO);
    expect(await screen.findByText("Folder settings ignored")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Review" }));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });
});
