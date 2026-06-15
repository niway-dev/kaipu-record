import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DeleteConfirmDialog } from "./delete-confirm-dialog";

describe("DeleteConfirmDialog", () => {
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
});
