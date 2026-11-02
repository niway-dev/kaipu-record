import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  LocationCheck,
  WorkspaceEditRequest,
  WorkspaceCreateResult,
  WorkspaceEditResult,
  WorkspaceRelocateResult,
  WorkspacesState,
  WorkspaceView,
} from "@shared/types/workspaces";
import type { TagColor } from "@kaipu/domain/constants";
import { WorkspaceDialog, type WorkspaceDialogProps } from "./workspace-dialog";

const view = (id: string, name: string, color: WorkspaceView["color"]): WorkspaceView => ({
  id,
  name,
  color,
  initials: name.slice(0, 1),
  path: `/Users/me/Movies/${name}`,
  volume: null,
  state: "available",
  itemCount: 1,
  device: "1",
  sync: null,
});
const DEFAULT = view("ws-default", "Default workspace", "kaipu");
const ACME = view("ws-acme", "Client Acme", "sky");
const STATE: WorkspacesState = {
  activeId: DEFAULT.id,
  generation: 1,
  hintDismissed: true,
  busy: null,
  readOnly: false,
  workspaces: [DEFAULT, ACME],
};

const PARENT = "/Users/me/Movies";
const free = (name: string): LocationCheck => ({
  path: `${PARENT}/Kaipu Record — ${name}`,
  state: "free",
});

const realApi = window.electronAPI;
let checkLocation: ReturnType<typeof vi.fn<(name: string) => Promise<LocationCheck>>>;
let create: ReturnType<
  typeof vi.fn<(input: { name: string; color: TagColor }) => Promise<WorkspaceCreateResult>>
>;
let edit: ReturnType<typeof vi.fn<(input: WorkspaceEditRequest) => Promise<WorkspaceEditResult>>>;
let relocate: ReturnType<typeof vi.fn<(id: string) => Promise<WorkspaceRelocateResult>>>;
let openFolder: ReturnType<typeof vi.fn<(id: string) => Promise<void>>>;
let onRelocated: ReturnType<typeof vi.fn<WorkspaceDialogProps["onRelocated"]>>;
let onClose: ReturnType<typeof vi.fn<() => void>>;
let onUseExisting: ReturnType<typeof vi.fn<() => void>>;
let onCreated: ReturnType<typeof vi.fn<WorkspaceDialogProps["onCreated"]>>;
let onSaved: ReturnType<typeof vi.fn<WorkspaceDialogProps["onSaved"]>>;

const createdOk: WorkspaceCreateResult = {
  ok: true,
  workspace: view("ws-new", "Work", "rose"),
  switchResult: { ok: true },
};

function renderDialog(editing: WorkspaceView | null = null, state = STATE): void {
  checkLocation = vi.fn(async (name: string) => free(name.trim()));
  create = vi.fn(async () => createdOk);
  edit = vi.fn(async () => ({ ok: true as const, workspace: ACME, savedToFolder: true }));
  relocate = vi.fn(async () => ({ ok: false as const, reason: "cancelled" as const }));
  openFolder = vi.fn(async () => {});
  onRelocated = vi.fn();
  onClose = vi.fn();
  onUseExisting = vi.fn();
  onCreated = vi.fn();
  onSaved = vi.fn();
  window.electronAPI = {
    // The current bridge, not `realApi`: a test may have set the platform first.
    ...window.electronAPI,
    workspaces: { ...realApi.workspaces, checkLocation, create, edit, relocate, openFolder },
  };
  render(
    <WorkspaceDialog
      state={state}
      editing={editing}
      onClose={onClose}
      onUseExisting={onUseExisting}
      onCreated={onCreated}
      onSaved={onSaved}
      onRelocated={onRelocated}
    />,
  );
}

const nameInput = (): HTMLInputElement => screen.getByLabelText("Name");
const type = (value: string): void => {
  fireEvent.change(nameInput(), { target: { value } });
};
const createButton = (): HTMLElement => screen.getByRole("button", { name: "Create workspace" });

afterEach(() => {
  window.electronAPI = realApi;
});

describe("New workspace dialog", () => {
  beforeEach(() => renderDialog());

  it("opens empty, with a color already picked and nothing to create yet", () => {
    expect(screen.getByRole("alertdialog", { name: "New workspace" })).toBeInTheDocument();
    expect(nameInput()).toHaveValue("");
    // The first color no workspace uses (kaipu and sky are taken).
    expect(screen.getByRole("radio", { name: "Rose" })).toBeChecked();
    expect(createButton()).toBeDisabled();
    expect(checkLocation).not.toHaveBeenCalled();
  });

  it("shows the full path of the new folder as the name is typed", async () => {
    type("  Work ");
    expect(await screen.findByTitle(`${PARENT}/Kaipu Record — Work`)).toBeInTheDocument();
    expect(checkLocation).toHaveBeenLastCalledWith("  Work ");
    expect(screen.getByText("Kaipu creates this folder.")).toBeInTheDocument();
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it("refuses a name already in use, ignoring case, and says so", async () => {
    type("client ACME");
    expect(
      await screen.findByText("Another workspace is already called that."),
    ).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
    expect(checkLocation).not.toHaveBeenCalled();
  });

  it("refuses a folder that already exists and is not empty, with the path and the way out", async () => {
    checkLocation.mockResolvedValue({
      path: `${PARENT}/Kaipu Record — Work`,
      state: "not-empty",
    });
    type("Work");
    expect(await screen.findByText(/already exists and isn't an empty folder/)).toBeInTheDocument();
    expect(screen.getByTitle(`${PARENT}/Kaipu Record — Work`)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("uses an existing empty folder of that name", async () => {
    checkLocation.mockResolvedValue({ path: `${PARENT}/Kaipu Record — Work`, state: "empty" });
    type("Work");
    expect(await screen.findByText(/already exists and is empty/)).toBeInTheDocument();
    await waitFor(() => expect(createButton()).toBeEnabled());
  });

  it("explains a Default workspace folder it cannot reach", async () => {
    checkLocation.mockResolvedValue({ path: null, state: "parent-missing" });
    type("Work");
    expect(await screen.findByText(/can't reach the folder next to/)).toBeInTheDocument();
    expect(createButton()).toBeDisabled();
  });

  it("ignores a slow answer for a name that is no longer in the box", async () => {
    let answerFirst!: (value: LocationCheck) => void;
    checkLocation.mockImplementationOnce(
      () => new Promise<LocationCheck>((resolve) => (answerFirst = resolve)),
    );
    type("Wo");
    type("Work");
    expect(await screen.findByTitle(`${PARENT}/Kaipu Record — Work`)).toBeInTheDocument();
    // Resolve inside act and let React flush: without the guard the stale path would render.
    await act(async () => {
      answerFirst({ path: `${PARENT}/Kaipu Record — Wo`, state: "not-empty" });
    });
    expect(screen.queryByTitle(`${PARENT}/Kaipu Record — Wo`)).toBeNull();
    expect(createButton()).toBeEnabled();
  });

  it("creates with the trimmed name and the chosen color, then hands the result on", async () => {
    type("  Work  ");
    fireEvent.click(screen.getByRole("radio", { name: "Mint" }));
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());

    await waitFor(() => expect(create).toHaveBeenCalledWith({ name: "Work", color: "mint" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(createdOk));
  });

  it("stays open and says why when main refuses (the folder appeared meanwhile)", async () => {
    create.mockResolvedValue({ ok: false, reason: "exists" } satisfies WorkspaceCreateResult);
    type("Work");
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());

    expect(await screen.findByRole("alert")).toHaveTextContent(/already exists/);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(createButton()).toBeEnabled();
  });

  it("a rejected create says the result is unknown and to check before retrying, never 'failed'", async () => {
    create.mockRejectedValue(new Error("ipc closed"));
    type("Work");
    await waitFor(() => expect(createButton()).toBeEnabled());
    fireEvent.click(createButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/can't tell whether the workspace was created/);
    expect(alert).toHaveTextContent(/Check the Workspaces list before trying again/);
    expect(alert).not.toHaveTextContent(/couldn't create|failed/i);
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(createButton()).toBeEnabled();
  });

  it("offers an existing folder (Google Drive, OneDrive) as a secondary way", () => {
    fireEvent.click(screen.getByRole("button", { name: "Use an existing folder…" }));
    expect(onUseExisting).toHaveBeenCalledOnce();
  });

  it("closes on Cancel and on Escape", () => {
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("the folder is text, never a fake input", () => {
  it("New workspace: the computed path is plain selectable text beside the existing-folder button", async () => {
    renderDialog();
    type("Work");
    const path = await screen.findByTitle(`${PARENT}/Kaipu Record — Work`);

    // Whole path in the text (the middle ellipsis is CSS), so copying it gives the full path.
    expect(path).toHaveTextContent(`${PARENT}/Kaipu Record — Work`);
    expect(path.closest("input,textarea")).toBeNull();
    // The name is the only box you can type in.
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Use an existing folder…" })).toBeInTheDocument();
  });

  it("New workspace: 'Use an existing folder…' still hands over to the adopt flow", () => {
    renderDialog();
    fireEvent.click(screen.getByRole("button", { name: "Use an existing folder…" }));
    expect(onUseExisting).toHaveBeenCalledOnce();
  });

  it("Edit workspace: the folder is read-only text with the full path as its tooltip", () => {
    renderDialog(ACME);
    const path = screen.getByTitle(ACME.path);

    expect(path).toHaveTextContent(ACME.path);
    expect(path.closest("input,textarea")).toBeNull();
    expect(screen.getAllByRole("textbox")).toHaveLength(1);
  });
});

describe("Edit workspace: Show in Finder and Change folder…", () => {
  afterEach(() => {
    window.electronAPI = realApi;
  });

  it("reveals the folder from Show in Finder", () => {
    renderDialog(ACME);
    fireEvent.click(screen.getByRole("button", { name: "Show in Finder" }));
    expect(openFolder).toHaveBeenCalledWith("ws-acme");
  });

  it("says Explorer on Windows", () => {
    window.electronAPI = { ...realApi, platform: "win32" };
    renderDialog(ACME);
    expect(screen.getByRole("button", { name: "Show in Explorer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Show in Finder" })).toBeNull();
  });

  it("Change folder… asks main to pick (the picker lives there) for this workspace", async () => {
    renderDialog(ACME);
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));
    await waitFor(() => expect(relocate).toHaveBeenCalledWith("ws-acme"));
    // The user closed the picker: no message, nothing to report.
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onRelocated).not.toHaveBeenCalled();
  });

  it("hands the result on when the workspace now points at the new folder, and stays open", async () => {
    renderDialog(ACME);
    const moved = { ...ACME, path: "/Volumes/Drive/Client Acme" };
    relocate.mockResolvedValue({ ok: true, workspace: moved });
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    await waitFor(() => expect(onRelocated).toHaveBeenCalledWith({ ok: true, workspace: moved }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("an empty folder is refused with the way out: it is for a moved workspace, Move to is for items", async () => {
    renderDialog(ACME);
    relocate.mockResolvedValue({ ok: false, reason: "not-a-workspace" });
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("a workspace folder that was moved");
    expect(alert).toHaveTextContent("“Move to”");
    expect(onRelocated).not.toHaveBeenCalled();
  });

  it("another workspace's folder is refused, naming that workspace", async () => {
    renderDialog(ACME);
    relocate.mockResolvedValue({ ok: false, reason: "different", workspaceName: "Personal" });
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("“Personal”");
  });

  it("a folder that is another registered workspace is refused, naming it", async () => {
    renderDialog(ACME);
    relocate.mockResolvedValue({
      ok: false,
      reason: "already-registered",
      workspaceName: "Default workspace",
    });
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "already the workspace “Default workspace”",
    );
  });

  it("explains each remaining refusal", async () => {
    renderDialog(ACME);
    const cases: Array<[WorkspaceRelocateResult & { ok: false }, RegExp]> = [
      [{ ok: false, reason: "has-items-no-identity" }, /has Kaipu items but isn't one of your/],
      [{ ok: false, reason: "unreadable" }, /can't be read/],
      [{ ok: false, reason: "not-a-folder" }, /isn't a folder/],
      [{ ok: false, reason: "recording" }, /Finish the recording/],
      [{ ok: false, reason: "exporting" }, /Wait for the export/],
      [{ ok: false, reason: "read-only" }, /preferences file/],
      [{ ok: false, reason: "not-writable" }, /nothing changed/],
    ];
    for (const [result, message] of cases) {
      relocate.mockResolvedValue(result);
      fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(message);
    }
  });

  it("is not available while preferences are read-only", () => {
    renderDialog(ACME, { ...STATE, readOnly: true });
    expect(screen.getByRole("button", { name: "Change folder…" })).toBeDisabled();
  });

  it("Save does not depend on the folder: only name and color enable it", async () => {
    renderDialog(ACME);
    const moved = { ...ACME, path: "/Volumes/Drive/Client Acme" };
    relocate.mockResolvedValue({ ok: true, workspace: moved });
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));
    await waitFor(() => expect(onRelocated).toHaveBeenCalled());

    // The folder changed at once, so Save has nothing of its own to save yet.
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Kaipu" }));
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("a rejected relocate says the result is unknown and to check the folder, and frees the button", async () => {
    renderDialog(ACME);
    relocate.mockRejectedValue(new Error("ipc closed"));
    fireEvent.click(screen.getByRole("button", { name: "Change folder…" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/can't tell whether the folder was changed/);
    expect(alert).not.toHaveTextContent(/couldn't change|failed/i);
    expect(onRelocated).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Change folder…" })).toBeEnabled();
  });
});

describe("Edit workspace that is not connected", () => {
  const away: WorkspaceView = {
    ...ACME,
    state: "unavailable",
    reason: "missing",
    path: "/Volumes/Old drive/Client Acme",
  };

  it("offers Change folder… as the fix, says why, and cannot reveal a folder that is not there", () => {
    renderDialog(away, { ...STATE, workspaces: [DEFAULT, away] });

    expect(screen.getByRole("button", { name: "Change folder…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Show in Finder" })).toBeDisabled();
    expect(screen.getByText(/This folder isn't connected/)).toBeInTheDocument();
  });

  it("does not say it is disconnected for a connected workspace", () => {
    renderDialog(ACME);
    expect(screen.queryByText(/This folder isn't connected/)).toBeNull();
  });
});

describe("New workspace dialog when preferences are read-only", () => {
  it("cannot create", () => {
    renderDialog(null, { ...STATE, readOnly: true });
    type("Work");
    expect(createButton()).toBeDisabled();
  });
});

describe("Edit workspace dialog", () => {
  beforeEach(() => renderDialog(ACME));

  it("opens on the workspace's name and color, with no location to choose", () => {
    expect(screen.getByRole("alertdialog", { name: "Edit workspace" })).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Client Acme");
    expect(screen.getByRole("radio", { name: "Sky" })).toBeChecked();
    expect(screen.getByTitle(ACME.path)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use an existing folder…" })).toBeNull();
    expect(checkLocation).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("saves only what changed", async () => {
    type("Acme Studio");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(edit).toHaveBeenCalledWith({ id: "ws-acme", name: "Acme Studio" }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  });

  it("saves a color alone", async () => {
    fireEvent.click(screen.getByRole("radio", { name: "Kaipu" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(edit).toHaveBeenCalledWith({ id: "ws-acme", color: "kaipu" }));
  });

  it("lets the workspace keep its own name but not take another's", () => {
    type("CLIENT acme");
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
    type("default workspace");
    expect(screen.getByText("Another workspace is already called that.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("a rejected edit says the result is unknown and to check the workspace before retrying", async () => {
    edit.mockRejectedValue(new Error("ipc closed"));
    type("Acme Studio");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/can't tell whether the changes were saved/);
    expect(alert).toHaveTextContent(/Check this workspace before trying again/);
    expect(alert).not.toHaveTextContent(/couldn't save|failed/i);
    expect(onSaved).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("stays open and says so when the folder cannot take the change", async () => {
    edit.mockResolvedValue({ ok: false, reason: "not-writable" } satisfies WorkspaceEditResult);
    type("Acme Studio");
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Kaipu couldn't write to this workspace's folder, so nothing changed.",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
