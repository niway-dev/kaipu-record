import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { WorkspacesState, WorkspaceView } from "@shared/types/workspaces";
import { WorkspaceSwitcher } from "./workspace-switcher";
import { WorkspaceNotConnectedNotice } from "./not-connected-notice";
import { useWorkspaces, WorkspacesProvider } from "./workspaces-context";

const DEFAULT: WorkspaceView = {
  id: "ws-default",
  name: "Default workspace",
  color: "rose",
  initials: "DW",
  path: "/Users/me/Movies/Kaipu Record",
  volume: null,
  state: "available",
  itemCount: 128,
};
const PERSONAL: WorkspaceView = {
  ...DEFAULT,
  id: "ws-personal",
  name: "Personal",
  color: "mint",
  initials: "P",
  path: "/Users/me/Movies/Personal",
  itemCount: 17,
};
const ARCHIVE: WorkspaceView = {
  ...DEFAULT,
  id: "ws-archive",
  name: "Archive 2025",
  color: "amber",
  initials: "A",
  path: "/Volumes/T7 Shield/Kaipu Archive",
  volume: "T7 Shield",
  state: "unavailable",
  reason: "missing",
  itemCount: null,
};

function state(overrides: Partial<WorkspacesState> = {}): WorkspacesState {
  return {
    activeId: DEFAULT.id,
    generation: 1,
    hintDismissed: true,
    busy: null,
    readOnly: false,
    workspaces: [DEFAULT],
    ...overrides,
  };
}

const realApi = window.electronAPI;
let changed: ((next: WorkspacesState) => void) | null;
let bridge: typeof realApi.workspaces;

function setup(initial: WorkspacesState): void {
  changed = null;
  bridge = {
    ...realApi.workspaces,
    list: vi.fn(async () => initial),
    switch: vi.fn(async () => ({ ok: true as const })),
    add: vi.fn(async () => ({ ok: false as const, reason: "cancelled" as const })),
    dismissHint: vi.fn(async () => {}),
    openFolder: vi.fn(async () => {}),
    onChanged: (callback) => {
      changed = callback;
      return () => (changed = null);
    },
  };
  window.electronAPI = { ...realApi, workspaces: bridge };
}

function EpochProbe(): React.JSX.Element {
  return <output data-testid="epoch">{useWorkspaces().epoch}</output>;
}

function renderSwitcher(): void {
  render(
    <MemoryRouter>
      <WorkspacesProvider>
        <WorkspaceSwitcher />
        <WorkspaceNotConnectedNotice />
        <EpochProbe />
      </WorkspacesProvider>
    </MemoryRouter>,
  );
}

const openMenu = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole("button", { name: /^Workspace:/ }));
};

beforeEach(() => setup(state()));
afterEach(() => {
  window.electronAPI = realApi;
});

describe("WorkspaceSwitcher with one workspace (spec decision 19)", () => {
  it("stays visible: the bar names the workspace and where it lives", async () => {
    renderSwitcher();
    const bar = await screen.findByRole("button", { name: "Workspace: Default workspace" });
    expect(bar).toHaveTextContent("Default workspace");
    expect(bar).toHaveTextContent("This Mac");
  });

  it("the menu shows the current workspace and Add / Manage, with nothing to switch to", async () => {
    renderSwitcher();
    await openMenu();
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent(DEFAULT.path);
    expect(menu).toHaveTextContent("128");
    expect(screen.queryByText("Switch to")).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: /Add workspace/ }));
    expect(bridge.add).toHaveBeenCalledOnce();
  });

  it("shows the one-time hint until it is dismissed, by its button or by Escape", async () => {
    setup(state({ hintDismissed: false }));
    renderSwitcher();
    expect(
      await screen.findByText("New: workspaces — keep work and personal captures apart"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(bridge.dismissHint).toHaveBeenCalledOnce();
    fireEvent.keyDown(screen.getByRole("button", { name: "Got it" }), { key: "Escape" });
    expect(bridge.dismissHint).toHaveBeenCalledTimes(2);
  });

  it("Escape pressed elsewhere does not dismiss the hint for good", async () => {
    setup(state({ hintDismissed: false }));
    renderSwitcher();
    await screen.findByText(/New: workspaces/);
    const elsewhere = document.createElement("input");
    document.body.append(elsewhere);

    fireEvent.keyDown(elsewhere, { key: "Escape" });
    fireEvent.keyDown(window, { key: "Escape" });

    expect(bridge.dismissHint).not.toHaveBeenCalled();
    elsewhere.remove();
  });

  it("an Escape something else already handled does not dismiss the hint either", async () => {
    setup(state({ hintDismissed: false }));
    renderSwitcher();
    const gotIt = await screen.findByRole("button", { name: "Got it" });

    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    event.preventDefault();
    gotIt.dispatchEvent(event);

    expect(bridge.dismissHint).not.toHaveBeenCalled();
  });

  it("does not show the hint once it was dismissed", async () => {
    renderSwitcher();
    await screen.findByRole("button", { name: /^Workspace:/ });
    expect(screen.queryByText(/New: workspaces/)).toBeNull();
  });
});

describe("the label of a workspace on the internal drive follows the host", () => {
  it("says This PC on Windows, in the bar and in the rows", async () => {
    setup(state({ workspaces: [DEFAULT, PERSONAL] }));
    window.electronAPI = { ...window.electronAPI, platform: "win32" };
    renderSwitcher();
    const bar = await screen.findByRole("button", { name: /^Workspace:/ });
    expect(bar).toHaveTextContent("This PC");
    expect(bar).not.toHaveTextContent("This Mac");
    fireEvent.click(bar);
    expect(screen.getByRole("menuitem", { name: /Personal/ })).toHaveTextContent(
      "17 items · This PC",
    );
  });

  it("says This Mac on macOS", async () => {
    window.electronAPI = { ...window.electronAPI, platform: "darwin" };
    renderSwitcher();
    expect(await screen.findByRole("button", { name: /^Workspace:/ })).toHaveTextContent(
      "This Mac",
    );
  });
});

describe("WorkspaceSwitcher with several workspaces", () => {
  it("lists the others under Switch to with their counts, and one click switches", async () => {
    setup(state({ workspaces: [DEFAULT, PERSONAL] }));
    renderSwitcher();
    await openMenu();
    const row = screen.getByRole("menuitem", { name: /Personal/ });
    expect(row).toHaveTextContent("17 items · This Mac");

    fireEvent.click(row);

    expect(bridge.switch).toHaveBeenCalledWith("ws-personal");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("a workspace that is not connected is listed, disabled, with its drive", async () => {
    setup(state({ workspaces: [DEFAULT, ARCHIVE] }));
    renderSwitcher();
    await openMenu();
    const row = screen.getByRole("menuitem", { name: /Archive 2025/ });
    expect(row).toBeDisabled();
    expect(row).toHaveTextContent("Not connected · T7 Shield");
  });

  it("LOCKED: while recording, every switch is disabled and the menu says why", async () => {
    setup(state({ workspaces: [DEFAULT, PERSONAL], busy: "recording" }));
    renderSwitcher();
    await openMenu();
    expect(screen.getByRole("note")).toHaveTextContent("Finish the recording to switch");
    expect(screen.getByRole("menuitem", { name: /Personal/ })).toBeDisabled();
  });

  it("NOT CONNECTED: the active workspace's bar and notice say captures are paused", async () => {
    setup(state({ activeId: ARCHIVE.id, workspaces: [ARCHIVE, DEFAULT] }));
    renderSwitcher();
    expect(await screen.findByRole("button", { name: /^Workspace:/ })).toHaveTextContent(
      "Not connected · Captures paused",
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Archive 2025 isn't connected");
    expect(alert).toHaveTextContent(
      "Reconnect T7 Shield, or switch workspace. Nothing is saved elsewhere.",
    );
  });

  it("NOT CONNECTED: the menu does not claim captures are saved here, and Finder is disabled", async () => {
    setup(state({ activeId: ARCHIVE.id, workspaces: [ARCHIVE, DEFAULT] }));
    renderSwitcher();
    await openMenu();
    const menu = screen.getByRole("menu");
    expect(menu).not.toHaveTextContent("Here");
    expect(menu).toHaveTextContent("Saving to");
    expect(menu).toHaveTextContent("Paused");
    expect(screen.getByRole("button", { name: "Finder" })).toBeDisabled();
  });

  it("a connected workspace says it saves here, and Finder opens its folder", async () => {
    renderSwitcher();
    await openMenu();
    expect(screen.getByRole("menu")).toHaveTextContent("Here");
    const finder = screen.getByRole("button", { name: "Finder" });
    expect(finder).toBeEnabled();
    fireEvent.click(finder);
    expect(bridge.openFolder).toHaveBeenCalledWith(DEFAULT.id);
  });

  it("remounts the pages on a new generation only, and closes the menu", async () => {
    setup(state({ workspaces: [DEFAULT, PERSONAL] }));
    renderSwitcher();
    await openMenu();
    expect(screen.getByTestId("epoch")).toHaveTextContent("0");

    // A lock change re-lists under the same generation: nothing remounts.
    act(() => changed?.(state({ workspaces: [DEFAULT, PERSONAL], busy: "recording" })));
    expect(screen.getByTestId("epoch")).toHaveTextContent("0");

    act(() =>
      changed?.(state({ workspaces: [DEFAULT, PERSONAL], activeId: PERSONAL.id, generation: 2 })),
    );
    expect(screen.getByTestId("epoch")).toHaveTextContent("1");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("button", { name: /^Workspace:/ })).toHaveTextContent("Personal");
  });
});
