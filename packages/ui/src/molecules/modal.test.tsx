import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalActions, ModalButton, ModalOverlay, ModalTitle } from "./modal";

/**
 * The shell exists so five dialogs stop re-rolling the same overlay behavior,
 * so the behavior is what these cover: focus, the two dismissal paths, and the
 * one click that must NOT dismiss.
 */
describe("ModalOverlay", () => {
  it("announces itself as a modal alertdialog labelled by its title", () => {
    render(
      <ModalOverlay onCancel={() => {}} labelledBy="t">
        <ModalTitle id="t">Discard changes?</ModalTitle>
      </ModalOverlay>,
    );

    const dialog = screen.getByRole("alertdialog", { name: "Discard changes?" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
  });

  it("takes focus on mount, so Escape reaches it without a click first", () => {
    render(<ModalOverlay onCancel={() => {}}>body</ModalOverlay>);
    expect(screen.getByRole("alertdialog")).toHaveFocus();
  });

  it("cancels on Escape", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ModalOverlay onCancel={onCancel}>body</ModalOverlay>);

    await user.keyboard("{Escape}");

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("cancels on a backdrop click", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(<ModalOverlay onCancel={onCancel}>body</ModalOverlay>);

    await user.click(screen.getByRole("alertdialog"));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("does NOT cancel on a click inside the card", async () => {
    // The regression this guards: losing the stopPropagation turns every click
    // on the dialog's own buttons into a dismissal.
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <ModalOverlay onCancel={onCancel}>
        <ModalTitle>Delete</ModalTitle>
      </ModalOverlay>,
    );

    await user.click(screen.getByText("Delete"));

    expect(onCancel).not.toHaveBeenCalled();
  });
});

describe("ModalButton", () => {
  it("calls onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <ModalActions>
        <ModalButton variant="danger" onClick={onClick}>
          Delete
        </ModalButton>
      </ModalActions>,
    );

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("does not call onClick while disabled, and drops its hover layer", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const { rerender } = render(
      <ModalButton variant="primary" onClick={onClick}>
        Export
      </ModalButton>,
    );
    const enabled = new Set(screen.getByRole("button").className.split(" "));

    rerender(
      <ModalButton variant="primary" onClick={onClick} disabled>
        Export
      </ModalButton>,
    );
    await user.click(screen.getByRole("button"));

    expect(onClick).not.toHaveBeenCalled();
    const disabled = new Set(screen.getByRole("button").className.split(" "));
    expect([...enabled].filter((c) => !disabled.has(c))).not.toHaveLength(0);
  });

  it("gives each variant a different set of classes", () => {
    const variants = ["ghost", "primary", "danger"] as const;
    const seen = variants.map((variant) => {
      const { unmount } = render(
        <ModalButton variant={variant} onClick={() => {}}>
          {variant}
        </ModalButton>,
      );
      const classes = screen.getByRole("button").className.split(" ").sort().join(" ");
      unmount();
      return classes;
    });

    expect(new Set(seen).size).toBe(variants.length);
  });
});
