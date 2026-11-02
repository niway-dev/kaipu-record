import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import type { TagColor } from "@kaipu/domain/constants";
import type {
  WorkspaceCreateResult,
  WorkspaceEditRequest,
  WorkspaceEditResult,
  WorkspaceRelocateResult,
  WorkspaceRemoveResult,
  WorkspacesState,
} from "@shared/types/workspaces";
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
  device: "1",
  sync: null,
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

describe("Settings → Workspaces → Edit and New workspace", () => {
  let edit: ReturnType<typeof vi.fn<(input: WorkspaceEditRequest) => Promise<WorkspaceEditResult>>>;
  let create: ReturnType<
    typeof vi.fn<(input: { name: string; color: TagColor }) => Promise<WorkspaceCreateResult>>
  >;
  let emit: ((state: WorkspacesState) => void) | null;

  function renderEditable(
    editResult: WorkspaceEditResult,
    createResult?: WorkspaceCreateResult,
  ): void {
    emit = null;
    edit = vi.fn(async () => editResult);
    create = vi.fn(async () => createResult ?? { ok: false as const, reason: "exists" as const });
    window.electronAPI = {
      ...realApi,
      workspaces: {
        ...realApi.workspaces,
        list: async () => STATE,
        edit,
        create,
        checkLocation: async (name: string) => ({
          path: `/Users/me/Kaipu Record — ${name.trim()}`,
          state: "free" as const,
        }),
        onChanged: (callback) => {
          emit = callback;
          return () => (emit = null);
        },
      },
    };
    render(
      <WorkspacesProvider>
        <WorkspacesSettingsPage />
      </WorkspacesProvider>,
    );
  }

  it("edits a workspace from its row, prefilled, and sends only what changed", async () => {
    renderEditable({
      ok: true,
      workspace: { ...view("ws-b", "Bravo 2"), color: "rose" },
      savedToFolder: true,
    });
    fireEvent.click(await screen.findByRole("button", { name: "Edit Bravo" }));
    const dialog = await screen.findByRole("alertdialog", { name: "Edit workspace" });
    const input = dialog.querySelector("input")!;
    expect(input).toHaveValue("Bravo");

    fireEvent.change(input, { target: { value: "Bravo 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(edit).toHaveBeenCalledWith({ id: "ws-b", name: "Bravo 2" }));
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(showToast).not.toHaveBeenCalled();
  });

  it("the row shows the new name and initials once main broadcasts the change", async () => {
    renderEditable({ ok: true, workspace: view("ws-b", "Bravo"), savedToFolder: true });
    await screen.findByText("Bravo");

    act(() => {
      emit?.({
        ...STATE,
        workspaces: [view("ws-a", "Alpha"), { ...view("ws-b", "Studio B"), initials: "SB" }],
      });
    });

    expect(await screen.findByText("Studio B")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).toBeNull();
    expect(screen.getByText("SB")).toBeInTheDocument();
  });

  it("says where the change went when the workspace is not connected", async () => {
    renderEditable({ ok: true, workspace: view("ws-b", "Bravo 2"), savedToFolder: false });
    fireEvent.click(await screen.findByRole("button", { name: "Edit Bravo" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(dialog.querySelector("input")!, { target: { value: "Bravo 2" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    expect(showToast.mock.calls[0]?.[0].message).toBe(
      "Saved. Bravo 2 isn't connected, so the change reaches its folder when you reconnect it.",
    );
  });

  it("creating a workspace closes the dialog, and a refused switch is explained", async () => {
    renderEditable(
      { ok: true, workspace: view("ws-b", "Bravo"), savedToFolder: true },
      {
        ok: true,
        workspace: view("ws-c", "Charlie"),
        switchResult: { ok: false, reason: "recording" },
      },
    );
    fireEvent.click(await screen.findByRole("button", { name: "New workspace" }));
    const dialog = await screen.findByRole("alertdialog", { name: "New workspace" });
    fireEvent.change(dialog.querySelector("input")!, { target: { value: "Charlie" } });
    const submit = screen.getByRole("button", { name: "Create workspace" });
    await vi.waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await vi.waitFor(() =>
      expect(create).toHaveBeenCalledWith({ name: "Charlie", color: "coral" }),
    );
    await vi.waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(showToast.mock.calls[0]?.[0].message).toBe("Finish the recording or export first");
  });
});

describe("Settings → Workspaces → Change folder…", () => {
  const away: WorkspacesState["workspaces"][number] = {
    ...view("ws-b", "Bravo"),
    state: "unavailable",
    reason: "missing",
    path: "/Volumes/Old drive/Bravo",
  };
  let relocate: ReturnType<typeof vi.fn<(id: string) => Promise<WorkspaceRelocateResult>>>;

  function renderPageWith(result: WorkspaceRelocateResult, bravo = away): void {
    relocate = vi.fn(async () => result);
    window.electronAPI = {
      ...realApi,
      workspaces: {
        ...realApi.workspaces,
        list: async () => ({ ...STATE, workspaces: [view("ws-a", "Alpha"), bravo] }),
        relocate,
      },
    };
    render(
      <WorkspacesProvider>
        <WorkspacesSettingsPage />
      </WorkspacesProvider>,
    );
  }

  it("a disconnected workspace's row offers Change folder… as the fix", async () => {
    renderPageWith({ ok: false, reason: "cancelled" });
    fireEvent.click(await screen.findByRole("button", { name: "Change folder…" }));

    await vi.waitFor(() => expect(relocate).toHaveBeenCalledWith("ws-b"));
    // Closing the picker is the user's own answer: no toast.
    expect(showToast).not.toHaveBeenCalled();
  });

  it("a connected workspace's row does not (it is in its Edit dialog)", async () => {
    renderPageWith({ ok: false, reason: "cancelled" }, view("ws-b", "Bravo"));
    await screen.findByText("Bravo");
    expect(screen.queryByRole("button", { name: "Change folder…" })).toBeNull();
  });

  it("says when the workspace points at the new folder", async () => {
    renderPageWith({ ok: true, workspace: view("ws-b", "Bravo") });
    fireEvent.click(await screen.findByRole("button", { name: "Change folder…" }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    expect(showToast.mock.calls[0]?.[0].message).toBe("Done. Bravo now points to the new folder.");
  });

  it("explains a refused folder in a toast, naming the other workspace", async () => {
    renderPageWith({ ok: false, reason: "different", workspaceName: "Personal" });
    fireEvent.click(await screen.findByRole("button", { name: "Change folder…" }));

    await vi.waitFor(() => expect(showToast).toHaveBeenCalledOnce());
    expect(showToast.mock.calls[0]?.[0].message).toContain("“Personal”");
  });

  it("says a changed folder in the Edit dialog the same way", async () => {
    renderPageWith({ ok: true, workspace: view("ws-b", "Bravo") }, view("ws-b", "Bravo"));
    fireEvent.click(await screen.findByRole("button", { name: "Edit Bravo" }));
    await screen.findByRole("alertdialog", { name: "Edit workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    await vi.waitFor(() => expect(relocate).toHaveBeenCalledWith("ws-b"));
    await vi.waitFor(() =>
      expect(showToast.mock.calls[0]?.[0].message).toBe(
        "Done. Bravo now points to the new folder.",
      ),
    );
    // The folder is already changed; the dialog stays for the name and color.
    expect(screen.getByRole("alertdialog", { name: "Edit workspace" })).toBeInTheDocument();
  });
});

describe("Settings → Workspaces: a synced folder (decision 15)", () => {
  it("labels a workspace inside Google Drive as synced by it", async () => {
    window.electronAPI = {
      ...realApi,
      workspaces: {
        ...realApi.workspaces,
        list: async () => ({
          ...STATE,
          workspaces: [view("ws-a", "Alpha"), { ...view("ws-b", "Bravo"), sync: "google-drive" }],
        }),
      },
    };
    render(
      <WorkspacesProvider>
        <WorkspacesSettingsPage />
      </WorkspacesProvider>,
    );
    expect(await screen.findByText(/\/Users\/me\/Bravo · Synced by Google Drive/)).toBeTruthy();
    expect(screen.queryByText(/\/Users\/me\/Alpha.*Synced/)).toBeNull();
  });
});
