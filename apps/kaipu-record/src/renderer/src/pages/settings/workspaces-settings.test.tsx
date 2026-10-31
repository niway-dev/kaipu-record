import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { WorkspaceRemoveResult, WorkspacesState } from "@shared/types/workspaces";
import { WorkspacesProvider } from "@renderer/features/workspaces/workspaces-context";
import { WorkspacesSettingsPage } from "./settings-pages";

const showToast = vi.hoisted(() => vi.fn());
vi.mock("@renderer/ui/toast-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@renderer/ui/toast-store")>()),
  showToast,
}));

const view = (id: string, name: string): WorkspacesState["workspaces"][number] => ({
  id,
  name,
  color: "rose",
  initials: name.slice(0, 1),
  path: `/Users/me/${name}`,
  volume: null,
  state: "available",
  itemCount: 1,
});
const STATE: WorkspacesState = {
  activeId: "ws-a",
  generation: 1,
  hintDismissed: true,
  busy: null,
  readOnly: false,
  workspaces: [view("ws-a", "Alpha"), view("ws-b", "Bravo")],
};

const realApi = window.electronAPI;
let remove: ReturnType<typeof vi.fn<(id: string) => Promise<WorkspaceRemoveResult>>>;

function renderPage(result: WorkspaceRemoveResult): void {
  remove = vi.fn(async () => result);
  window.electronAPI = {
    ...realApi,
    workspaces: { ...realApi.workspaces, list: async () => STATE, remove },
  };
  render(
    <WorkspacesProvider>
      <WorkspacesSettingsPage />
    </WorkspacesProvider>,
  );
}

const confirmRemoval = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: "Remove from list" }));
  const dialog = await screen.findByRole("alertdialog");
  fireEvent.click(
    // The dialog's own confirm button, not the row's.
    Array.from(dialog.querySelectorAll("button")).find(
      (b) => b.textContent === "Remove from list",
    )!,
  );
};

beforeEach(() => showToast.mockClear());
afterEach(() => {
  window.electronAPI = realApi;
});

describe("Settings → Workspaces → Remove from list", () => {
  it("says why when main refuses (the workspace became active after the dialog opened)", async () => {
    renderPage({ ok: false, reason: "active" });
    await confirmRemoval();
    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    expect(showToast.mock.calls[0]?.[0].message).toBe(
      "Bravo is the active workspace. Switch to another one first.",
    );
  });

  it("says so when the workspace is already gone", async () => {
    renderPage({ ok: false, reason: "unknown" });
    await confirmRemoval();
    await vi.waitFor(() =>
      expect(showToast.mock.calls[0]?.[0].message).toBe("That workspace is no longer in the list."),
    );
  });

  it("explains the other refusals too", async () => {
    renderPage({ ok: false, reason: "last" });
    await confirmRemoval();
    await vi.waitFor(() =>
      expect(showToast.mock.calls[0]?.[0].message).toBe("Kaipu keeps at least one workspace."),
    );
  });

  it("stays quiet when the removal worked", async () => {
    renderPage({ ok: true });
    await confirmRemoval();
    await vi.waitFor(() => expect(remove).toHaveBeenCalledWith("ws-b"));
    expect(showToast).not.toHaveBeenCalled();
  });
});
