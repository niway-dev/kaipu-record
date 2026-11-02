import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type {
  LocationCheck,
  WorkspaceEditRequest,
  WorkspaceCreateResult,
  WorkspaceEditResult,
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
  onClose = vi.fn();
  onUseExisting = vi.fn();
  onCreated = vi.fn();
  onSaved = vi.fn();
  window.electronAPI = {
    ...realApi,
    workspaces: { ...realApi.workspaces, checkLocation, create, edit },
  };
  render(
    <WorkspaceDialog
      state={state}
      editing={editing}
      onClose={onClose}
      onUseExisting={onUseExisting}
      onCreated={onCreated}
      onSaved={onSaved}
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
    expect(await screen.findByText(`${PARENT}/Kaipu Record — Work`)).toBeInTheDocument();
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
    expect(screen.getByText(`${PARENT}/Kaipu Record — Work`)).toBeInTheDocument();
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
    expect(await screen.findByText(`${PARENT}/Kaipu Record — Work`)).toBeInTheDocument();
    // Resolve inside act and let React flush: without the guard the stale path would render.
    await act(async () => {
      answerFirst({ path: `${PARENT}/Kaipu Record — Wo`, state: "not-empty" });
    });
    expect(screen.queryByText(`${PARENT}/Kaipu Record — Wo`)).toBeNull();
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
    expect(screen.getByText(ACME.path)).toBeInTheDocument();
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
