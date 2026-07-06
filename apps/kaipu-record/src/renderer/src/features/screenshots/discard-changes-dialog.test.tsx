import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DiscardChangesDialog } from "./discard-changes-dialog";

describe("DiscardChangesDialog", () => {
  it("warns that a never-saved capture is lost, and wires discard + cancel", async () => {
    const onDiscard = vi.fn();
    const onCancel = vi.fn();
    render(<DiscardChangesDialog neverSaved onDiscard={onDiscard} onCancel={onCancel} />);

    expect(screen.getByRole("heading", { name: /discard unsaved changes/i })).toBeInTheDocument();
    // Fresh-capture copy: the shot is gone if discarded.
    expect(screen.getByText(/isn't saved|it's lost/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /discard/i }));
    expect(onDiscard).toHaveBeenCalledOnce();

    await userEvent.click(screen.getByRole("button", { name: /keep editing/i }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("uses edit-loss copy when the shot was already saved", () => {
    render(<DiscardChangesDialog neverSaved={false} onDiscard={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText(/unsaved edits/i)).toBeInTheDocument();
  });

  it("cancels on Escape (keeps the user in the editor)", () => {
    const onCancel = vi.fn();
    render(<DiscardChangesDialog neverSaved onDiscard={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
