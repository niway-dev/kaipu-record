import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

// Only the active workspace's `sync` matters to the dialog.
const workspace = vi.hoisted(() => ({ sync: null as string | null }));
vi.mock("@renderer/features/workspaces/workspaces-context", () => ({
  useOptionalWorkspaces: () => ({ active: { id: "w", name: "Work", sync: workspace.sync } }),
}));

describe("DeleteConfirmDialog", () => {
  beforeEach(() => {
    workspace.sync = null;
  });

  it("shows the recording title and wires confirm + cancel", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog title="My Clip" onConfirm={onConfirm} onCancel={onCancel} />);

    expect(screen.getByRole("heading", { name: /delete recording/i })).toBeInTheDocument();
    expect(screen.getByText(/My Clip/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels on Escape", () => {
    const onCancel = vi.fn();
    render(<DeleteConfirmDialog title="X" onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows a busy label and disables confirm while deleting", () => {
    render(<DeleteConfirmDialog title="X" isDeleting onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole("button", { name: /deleting/i })).toBeDisabled();
  });

  it("warns that a delete reaches the cloud on every device, naming no provider, in a synced workspace", () => {
    workspace.sync = "google-drive";
    render(<DeleteConfirmDialog title="X" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    const warning = screen.getByText(/deleted from the cloud on every device/i);
    expect(warning).toBeInTheDocument();
    expect(warning.textContent).not.toMatch(/google|drive|onedrive|icloud/i);
  });

  it("says nothing extra in a plain workspace", () => {
    render(<DeleteConfirmDialog title="X" onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/deleted from the cloud/i)).toBeNull();
  });
});
