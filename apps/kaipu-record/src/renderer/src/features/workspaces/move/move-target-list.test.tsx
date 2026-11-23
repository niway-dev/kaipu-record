import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { WorkspacesState, WorkspaceView } from "@shared/types/workspaces";
import { MoveTargetList } from "./move-target-list";

const syncedFlag = vi.hoisted(() => ({ on: false }));
vi.mock("@renderer/features/analytics/use-flag", () => ({
  useFlag: (name: string) => name === "synced-workspaces" && syncedFlag.on,
}));

const view = (id: string, name: string, sync: WorkspaceView["sync"] = null): WorkspaceView => ({
  id,
  name,
  color: "rose",
  initials: name.slice(0, 1),
  path: `/Users/me/${name}`,
  volume: null,
  state: "available",
  itemCount: 1,
  device: "1",
  sync,
});

const ACTIVE = view("ws-a", "Alpha");
const STATE: WorkspacesState = {
  activeId: ACTIVE.id,
  generation: 1,
  hintDismissed: true,
  busy: null,
  readOnly: false,
  workspaces: [ACTIVE, view("ws-b", "Bravo", "google-drive")],
};

function renderList(): void {
  render(<MoveTargetList state={STATE} active={ACTIVE} lock={null} onPick={vi.fn()} />);
}

beforeEach(() => {
  syncedFlag.on = false;
});

describe("MoveTargetList: a move to a synced workspace (decision 13)", () => {
  it("says Synced folder · copies only with synced-workspaces on", () => {
    syncedFlag.on = true;
    renderList();
    expect(screen.getByRole("menuitem", { name: /Bravo/ })).toHaveTextContent(
      "Synced folder · copies",
    );
  });

  it("with synced-workspaces off, reads as any copying move", () => {
    renderList();
    const row = screen.getByRole("menuitem", { name: /Bravo/ });
    expect(row).toHaveTextContent("Other drive · copies");
    expect(row).not.toHaveTextContent(/Synced|Google Drive/);
  });
});
