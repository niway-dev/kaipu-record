import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Popover, PopoverItem } from "./popover";

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByText("Menu"));
};

describe("Popover", () => {
  it("stays closed until its trigger is clicked", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Menu</span>}>
        <PopoverItem>Rename</PopoverItem>
      </Popover>,
    );
    expect(screen.queryByText("Rename")).toBeNull();

    await open(user);

    expect(screen.getByText("Rename")).toBeInTheDocument();
  });

  it("closes on a pointer outside it", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <Popover trigger={<span>Menu</span>}>
          <PopoverItem>Rename</PopoverItem>
        </Popover>
        <button>Elsewhere</button>
      </div>,
    );
    await open(user);

    await user.click(screen.getByRole("button", { name: "Elsewhere" }));

    expect(screen.queryByText("Rename")).toBeNull();
  });

  it("closes on scroll, because the anchor was measured once", async () => {
    // Without this the menu would hang where the trigger used to be.
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Menu</span>}>
        <PopoverItem>Rename</PopoverItem>
      </Popover>,
    );
    await open(user);

    // The listener is on document in the capture phase, and its setState runs
    // outside React's event system — hence act().
    await act(async () => {
      document.dispatchEvent(new Event("scroll"));
    });

    expect(screen.queryByText("Rename")).toBeNull();
  });

  it("toggles shut when the trigger is clicked again", async () => {
    const user = userEvent.setup();
    render(
      <Popover trigger={<span>Menu</span>}>
        <PopoverItem>Rename</PopoverItem>
      </Popover>,
    );
    await open(user);
    await open(user);

    expect(screen.queryByText("Rename")).toBeNull();
  });
});

describe("PopoverItem", () => {
  it("calls onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PopoverItem onClick={onClick}>Delete</PopoverItem>);

    await user.click(screen.getByRole("button", { name: "Delete" }));

    expect(onClick).toHaveBeenCalledOnce();
  });

  it("marks the danger variant differently", () => {
    const { unmount } = render(<PopoverItem>Rename</PopoverItem>);
    const plain = screen.getByRole("button").className;
    unmount();

    render(<PopoverItem danger>Delete</PopoverItem>);
    expect(screen.getByRole("button").className).not.toBe(plain);
  });

  it("is a button, so it never submits a surrounding form", () => {
    render(<PopoverItem>Rename</PopoverItem>);
    expect(screen.getByRole("button")).toHaveAttribute("type", "button");
  });
});
