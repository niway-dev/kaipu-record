import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";
import type { ScopedSettings } from "@shared/settings-scope";
import type { AppSettings } from "@shared/types";
import { CloudPage } from "./cloud-page";

vi.mock("@renderer/features/storage-cloud/storage-cloud-settings", () => ({
  StorageCloudSettings: ({
    uploadMode,
    onUploadModeChange,
  }: {
    uploadMode: string | null;
    onUploadModeChange(mode: "automatic"): void;
  }) => (
    <button type="button" onClick={() => onUploadModeChange("automatic")}>
      mode:{uploadMode}
    </button>
  ),
}));

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

describe("CloudPage (the save mode is per device and per workspace)", () => {
  let base: AppSettings;
  beforeEach(async () => {
    base = await realApi.getSettings();
  });

  function mount(overrides: Partial<AppSettings>, workspaces: 1 | 2) {
    const setOverride = vi.fn(async () => ({ ok: true as const, settings: base }));
    const updateSettings = vi.fn(async (patch: Partial<AppSettings>) => ({ ...base, ...patch }));
    const view = (id: string, name: string) => ({
      id,
      name,
      color: "rose" as const,
      initials: name.slice(0, 1),
      path: `/x/${name}`,
      volume: null,
      state: "available" as const,
      itemCount: 0,
      device: "1",
      sync: null,
    });
    const list = {
      activeId: "ws-a",
      generation: 1,
      hintDismissed: true,
      busy: null,
      readOnly: false,
      workspaces:
        workspaces === 1 ? [view("ws-a", "Alpha")] : [view("ws-a", "Alpha"), view("ws-b", "Bravo")],
    };
    window.electronAPI = {
      ...realApi,
      getSettings: async () => ({ ...base, ...overrides }),
      updateSettings,
      settingsScope: {
        ...realApi.settingsScope,
        setOverride,
        getScoped: async (scope) =>
          ({
            scope,
            all: base,
            overrides,
            effective: { ...base, ...overrides },
            folder: "none",
            pending: null,
            folderSha256: null,
            overriddenIn: {},
          }) satisfies ScopedSettings,
      },
      workspaces: { ...realApi.workspaces, list: async () => list },
    };
    render(
      <WorkspacesProvider>
        <CloudPage />
      </WorkspacesProvider>,
    );
    return { setOverride, updateSettings };
  }

  it("with one workspace and no override, the mode is written to the device level", async () => {
    const { updateSettings, setOverride } = mount({}, 1);
    fireEvent.click(await screen.findByRole("button", { name: /mode:local-only/ }));
    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ uploadMode: "automatic" }));
    expect(setOverride).not.toHaveBeenCalled();
  });

  it("with an override, the page shows it, says whose it is, and edits it", async () => {
    const { setOverride } = mount({ uploadMode: "manual" }, 1);
    expect(await screen.findByText("Set for this workspace")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /mode:manual/ }));
    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith("ws-a", "uploadMode", "automatic"),
    );
  });

  it("with two workspaces, the mode belongs to the active workspace", async () => {
    const { setOverride } = mount({}, 2);
    expect(await screen.findByText("Same as default")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: /mode:local-only/ }));
    await waitFor(() =>
      expect(setOverride).toHaveBeenCalledWith("ws-a", "uploadMode", "automatic"),
    );
  });
});
