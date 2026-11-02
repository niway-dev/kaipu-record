import { afterEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { WorkspaceCloudState, WorkspacesState } from "@shared/types/workspaces";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";
import { WorkspaceCloudSection } from "./workspace-cloud-section";

const realApi = window.electronAPI;
afterEach(() => {
  window.electronAPI = realApi;
});

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

const list: WorkspacesState = {
  activeId: "ws-a",
  generation: 1,
  hintDismissed: true,
  busy: null,
  readOnly: false,
  workspaces: [view("ws-a", "Alpha"), view("ws-b", "Bravo")],
};

function mount(
  cloud: Partial<WorkspaceCloudState>,
  cloudState?: () => Promise<WorkspaceCloudState>,
  onLibraryChanged?: (callback: () => void) => () => void,
) {
  const state: WorkspaceCloudState = {
    workspaceId: "ws-a",
    location: "this-mac",
    signedIn: true,
    filter: "own",
    catalogKnown: true,
    unassigned: [],
    ...cloud,
  };
  const assignCloud = vi.fn(async (assetIds: string[]) => ({
    assigned: assetIds,
    queued: [],
    failed: [],
  }));
  window.electronAPI = {
    ...realApi,
    ...(onLibraryChanged ? { onLibraryChanged } : {}),
    workspaces: {
      ...realApi.workspaces,
      list: async () => list,
      cloudState: vi.fn(cloudState ?? (async () => state)),
      assignCloud,
    },
  };
  render(
    <WorkspacesProvider>
      <WorkspaceCloudSection />
    </WorkspacesProvider>,
  );
  return { assignCloud };
}

describe("WorkspaceCloudSection (Cloud → This workspace)", () => {
  it("says a Google Drive folder is synced by Google Drive, and that Kaipu does not sync to it", async () => {
    mount({ location: "google-drive" });
    const row = await screen.findByTestId("workspace-location");
    expect(row.textContent).toContain("Synced by Google Drive");
    expect(row.textContent).toContain("Kaipu doesn't sync to Google Drive");
  });

  it("says a plain folder lives on this Mac", async () => {
    mount({ location: "this-mac" });
    expect((await screen.findByTestId("workspace-location")).textContent).toContain("This Mac");
  });

  it("says whether Kaipu Cloud items are filtered to this workspace", async () => {
    mount({ filter: "own-and-unassigned" });
    const row = await screen.findByTestId("workspace-cloud-filter");
    expect(row.textContent).toContain("plus the unassigned ones");
    expect(row.textContent).toContain("Until you assign one");
  });

  it("lists the unassigned items and assigns one to the workspace the user picks", async () => {
    const { assignCloud } = mount({
      unassigned: [
        {
          assetId: "a1",
          title: "Old demo",
          kind: "recording",
          createdAt: 1,
          sizeBytes: 1,
          workspaceId: null,
        },
        {
          assetId: "a2",
          title: "From the old Mac",
          kind: "screenshot",
          createdAt: 2,
          sizeBytes: 1,
          workspaceId: "ws-gone",
        },
      ],
    });
    expect(await screen.findByText("Old demo")).toBeTruthy();
    expect(screen.getByText(/Uploaded before workspaces/)).toBeTruthy();
    expect(screen.getByText(/From a workspace that isn't on this Mac/)).toBeTruthy();
    expect(screen.getByText(/2 cloud items are not in any workspace on this Mac/)).toBeTruthy();

    const row = screen.getByText("Old demo").closest("li")!;
    fireEvent.click(within(row).getByRole("button", { name: "Assign to workspace…" }));
    const picker = await screen.findByRole("dialog", { name: "Assign to workspace" });
    // Nothing is assigned before the user picks a workspace.
    expect(assignCloud).not.toHaveBeenCalled();
    fireEvent.click(within(picker).getByRole("button", { name: /Bravo/ }));
    await waitFor(() => expect(assignCloud).toHaveBeenCalledWith(["a1"], "ws-b"));
    expect(await screen.findByRole("status")).toHaveProperty(
      "textContent",
      "1 item assigned to Bravo.",
    );
  });

  it("Assign all sends every unassigned item", async () => {
    const { assignCloud } = mount({
      unassigned: ["a1", "a2"].map((assetId) => ({
        assetId,
        title: assetId,
        kind: "recording" as const,
        createdAt: 1,
        sizeBytes: 1,
        workspaceId: null,
      })),
    });
    fireEvent.click(await screen.findByRole("button", { name: "Assign all to workspace…" }));
    fireEvent.click(
      within(await screen.findByRole("dialog")).getByRole("button", { name: /Alpha/ }),
    );
    await waitFor(() => expect(assignCloud).toHaveBeenCalledWith(["a1", "a2"], "ws-a"));
  });

  it("signed out, it says so and lists nothing", async () => {
    mount({ signedIn: false, catalogKnown: false });
    expect(await screen.findByText(/Sign in to Kaipu Cloud/)).toBeTruthy();
  });

  it("a failed read says so instead of loading forever", async () => {
    mount({}, async () => {
      throw new Error("vault-maintenance");
    });
    expect((await screen.findByRole("alert")).textContent).toContain("couldn't read");
  });

  it("an older answer arriving last never replaces the latest one", async () => {
    const base: WorkspaceCloudState = {
      workspaceId: "ws-a",
      location: "this-mac",
      signedIn: true,
      filter: "own",
      catalogKnown: true,
      unassigned: [],
    };
    let resolveFirst: (value: WorkspaceCloudState) => void = () => {};
    let calls = 0;
    let libraryChanged: () => void = () => {};
    mount(
      {},
      () => {
        calls += 1;
        // The first request hangs; the second (after a library broadcast) answers at once.
        return calls === 1
          ? new Promise((resolve) => (resolveFirst = resolve))
          : Promise.resolve(base);
      },
      (callback) => {
        libraryChanged = callback;
        return () => {};
      },
    );
    await waitFor(() => expect(calls).toBe(1));
    act(() => libraryChanged());
    expect((await screen.findByTestId("workspace-location")).textContent).toContain("This Mac");
    // The stale first answer (another workspace, in Google Drive) lands last: it is dropped.
    await act(async () => resolveFirst({ ...base, location: "google-drive" }));
    expect(screen.getByTestId("workspace-location").textContent).toContain("This Mac");
  });
});
