import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { LocalRecording } from "@shared/types/library-storage";
import type {
  MoveItemsRequest,
  MoveItemsResult,
  WorkspacesState,
  WorkspaceView,
} from "@shared/types/workspaces";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { setHeaderEndElement } from "../header-slot";
import { registerItemPageCloser } from "../prepare-switch";
import { WorkspacesProvider } from "../workspaces-context";
import { ItemMoveMenu } from "./item-move-menu";
import { ItemWorkspaceChip } from "./item-workspace-chip";
import { resetMoveUi } from "./move-store";

const DEFAULT: WorkspaceView = {
  id: "ws-work",
  name: "Work",
  color: "rose",
  initials: "W",
  path: "/Users/me/Movies/Work",
  volume: null,
  state: "available",
  itemCount: 3,
  device: "1",
  sync: null,
};
const PERSONAL: WorkspaceView = { ...DEFAULT, id: "ws-personal", name: "Personal", device: "1" };
const USB: WorkspaceView = {
  ...DEFAULT,
  id: "ws-usb",
  name: "Client USB",
  path: "/Volumes/USB/Client",
  volume: "USB",
  device: "2",
  sync: null,
};
const ARCHIVE: WorkspaceView = {
  ...DEFAULT,
  id: "ws-archive",
  name: "Archive",
  state: "unavailable",
  reason: "missing",
  device: null,
  sync: null,
};

function state(overrides: Partial<WorkspacesState> = {}): WorkspacesState {
  return {
    activeId: DEFAULT.id,
    generation: 1,
    hintDismissed: true,
    busy: null,
    readOnly: false,
    workspaces: [DEFAULT, PERSONAL, USB, ARCHIVE],
    ...overrides,
  };
}

const recording = (over: Partial<LocalRecording> & { id: string }): LocalRecording =>
  ({
    assetId: `asset-${over.id}`,
    kind: "recording",
    title: over.id,
    derivedFromAssetId: null,
    ...over,
  }) as LocalRecording;

const LIBRARY = [
  recording({ id: "Demo" }),
  recording({ id: "Demo YouTube", derivedFromAssetId: "asset-Demo" }),
  recording({ id: "Demo Slack", derivedFromAssetId: "asset-Demo" }),
];

const realApi = window.electronAPI;
let moveItems: ReturnType<typeof vi.fn<(r: MoveItemsRequest) => Promise<MoveItemsResult>>>;
let close: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
let offCloser: () => void;

function setup(initial: WorkspacesState, result?: Partial<MoveItemsResult>): void {
  moveItems = vi.fn(async (request: MoveItemsRequest) => ({
    targetId: request.targetId,
    moved: request.items.map((i) => ({ id: i.id, newId: i.id })),
    failed: [],
    skipped: [],
    ...result,
  }));
  window.electronAPI = {
    ...realApi,
    listLocalRecordings: async () => LIBRARY,
    workspaces: {
      ...realApi.workspaces,
      list: vi.fn(async () => initial),
      moveItems,
      onMoveProgress: () => () => {},
    },
  };
  close = vi.fn(async () => true);
  offCloser = registerItemPageCloser(close);
}

function renderChip(): void {
  const header = document.createElement("div");
  document.body.append(header);
  setHeaderEndElement(header);
  render(
    <MemoryRouter>
      <WorkspacesProvider>
        <ItemWorkspaceChip assetId="asset-Demo" />
      </WorkspacesProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => resetMoveUi());

afterEach(() => {
  offCloser();
  setHeaderEndElement(null);
  window.electronAPI = realApi;
  for (const toast of getToasts()) dismissToast(toast.id);
});

describe("IN · Work ▾ (the editor chip)", () => {
  it("says where the item belongs and what a move to each workspace costs", async () => {
    setup(state());
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    const menu = screen.getByRole("menu");
    expect(menu).toHaveTextContent("Belongs here");
    expect(screen.getByRole("menuitem", { name: /Personal/ })).toHaveTextContent(
      "Same drive · instant",
    );
    expect(screen.getByRole("menuitem", { name: /Client USB/ })).toHaveTextContent(
      "Other drive · copies",
    );
    const archive = screen.getByRole("menuitem", { name: /Archive/ });
    expect(archive).toHaveTextContent("Not connected");
    expect(archive).toBeDisabled();
    expect(menu).toHaveTextContent("Moving closes this editor");
  });

  it("is locked while exporting, with the reason, and moves nothing", async () => {
    setup(state({ busy: "exporting" }));
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    expect(screen.getByRole("note")).toHaveTextContent("Wait for the export to finish");
    expect(screen.getByRole("menuitem", { name: /Personal/ })).toBeDisabled();
  });

  it("offers New workspace… when no other workspace exists", async () => {
    setup(state({ workspaces: [DEFAULT] }));
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    expect(screen.getByRole("menuitem", { name: /New workspace/ })).toBeEnabled();
  });
});

describe("moving a recording that has exports", () => {
  it("Move all 3 closes the editor, then moves the recording first and then its exports", async () => {
    setup(state());
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Personal/ }));
    expect(
      await screen.findByText("This recording has 2 exports in Work. Move them too?"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Move all 3" }));
    await waitFor(() => expect(moveItems).toHaveBeenCalled());
    expect(close).toHaveBeenCalled();
    expect(moveItems.mock.calls[0]![0]).toEqual({
      targetId: "ws-personal",
      items: [
        { id: "Demo", assetId: "asset-Demo" },
        { id: "Demo YouTube", assetId: "asset-Demo YouTube" },
        { id: "Demo Slack", assetId: "asset-Demo Slack" },
      ],
    });
    await waitFor(() => expect(getToasts().at(-1)?.message).toBe("Moved 3 items to Personal"));
    expect(getToasts().at(-1)?.action?.label).toBe("Switch");
  });

  it("Move only the recording leaves the exports where they are", async () => {
    setup(state());
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Personal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move only the recording" }));
    await waitFor(() => expect(moveItems).toHaveBeenCalled());
    expect(moveItems.mock.calls[0]![0].items).toEqual([{ id: "Demo", assetId: "asset-Demo" }]);
  });

  it("the result names what stayed and why", async () => {
    setup(state(), {
      moved: [{ id: "Demo", newId: "Demo" }],
      failed: [{ id: "Demo Slack", reason: "no-room" }],
    });
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Personal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move only the recording" }));
    await waitFor(() =>
      expect(getToasts().at(-1)?.message).toBe(
        "Moved 1 of 2 to Personal. 1 stayed in Work: Demo Slack — the destination drive is full",
      ),
    );
  });

  it("a lost IPC reply says the result is unknown, never 'changed workspace' or 'untouched'", async () => {
    setup(state());
    moveItems.mockRejectedValue(new Error("ipc went away"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Personal/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Move only the recording" }));
    await waitFor(() =>
      expect(getToasts().at(-1)?.message).toBe(
        "The result of the move could not be read. Check both workspaces.",
      ),
    );
    quiet.mockRestore();
  });

  it("an editor that stays open (Keep editing) moves nothing", async () => {
    setup(state());
    close.mockResolvedValue(false);
    renderChip();
    fireEvent.click(await screen.findByRole("button", { name: /In Work/ }));
    fireEvent.click(screen.getByRole("menuitem", { name: /Personal/ }));
    await act(async () => {
      fireEvent.click(await screen.findByRole("button", { name: "Move only the recording" }));
    });
    await waitFor(() => expect(close).toHaveBeenCalled());
    expect(moveItems).not.toHaveBeenCalled();
  });
});

describe("the ⋯ menu from the keyboard (PR 479)", () => {
  it("moves focus into the menu on open and back to the button on Escape", async () => {
    setup(state());
    render(
      <MemoryRouter>
        <WorkspacesProvider>
          <ItemMoveMenu
            item={{
              id: "Demo",
              assetId: "asset-Demo",
              title: "Demo",
              kind: "recording",
              derivedFromAssetId: null,
            }}
            onPick={() => {}}
          />
        </WorkspacesProvider>
      </MemoryRouter>,
    );
    const button = await screen.findByRole("button", { name: "More actions" });
    fireEvent.click(button);
    const first = await screen.findByRole("menuitem", { name: /Personal/ });
    expect(first).toHaveFocus();
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(button).toHaveFocus());
  });
});
