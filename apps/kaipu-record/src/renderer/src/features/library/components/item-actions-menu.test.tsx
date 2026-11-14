import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ItemActionsMenu } from "./item-actions-menu";

vi.mock("@renderer/features/workspaces/workspaces-context", () => ({
  useOptionalWorkspaces: () => ({
    state: { workspaces: [] },
    active: { id: "ws-1" },
  }),
}));
vi.mock("@renderer/features/workspaces/move/move-target-list", () => ({
  MoveTargetList: () => null,
  useMoveLock: () => null,
}));
vi.mock("@renderer/features/workspaces/move/use-move-items", () => ({
  useMoveItems: () => vi.fn(),
}));

function renderMenu(movable: boolean) {
  render(
    <ItemActionsMenu
      assetId="a"
      canRemoveLocalCopy={false}
      movable={movable}
      onCopyPath={() => {}}
      onRemoveLocalCopy={() => {}}
      onDelete={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "More actions" }));
}

afterEach(cleanup);

describe("ItemActionsMenu — Move to workspace", () => {
  it("is offered for a movable item", () => {
    renderMenu(true);
    expect(screen.getByRole("menuitem", { name: /Move to workspace/ })).toBeTruthy();
  });

  it("is hidden for an item that cannot be moved", () => {
    renderMenu(false);
    expect(screen.getByRole("menuitem", { name: /Copy path/ })).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Move to workspace/ })).toBeNull();
  });
});

describe("ItemActionsMenu — Copy image", () => {
  it("is not in the menu: the screenshot preview has its own copy button", () => {
    renderMenu(true);
    expect(screen.queryByRole("menuitem", { name: /Copy image/ })).toBeNull();
    expect(screen.getByRole("menuitem", { name: /Copy path/ })).toBeTruthy();
  });
});
