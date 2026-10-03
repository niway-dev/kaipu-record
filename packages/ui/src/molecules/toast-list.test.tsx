import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastList } from "./toast-list";

const toast = (over: Partial<Parameters<typeof ToastList>[0]["toasts"][number]> = {}) => ({
  id: "t1",
  message: "Saved",
  ...over,
});

describe("ToastList", () => {
  it("announces each toast", () => {
    render(<ToastList toasts={[toast()]} onDismiss={() => {}} closeLabel="Close" />);
    expect(screen.getByRole("alert")).toHaveTextContent("Saved");
  });

  it("dismisses by id from the close button", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ToastList toasts={[toast()]} onDismiss={onDismiss} closeLabel="Close" />);

    await user.click(screen.getByRole("button", { name: "Close" }));

    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("runs an action and then dismisses the toast that carried it", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    const onClick = vi.fn();
    render(
      <ToastList
        toasts={[toast({ action: { label: "Undo", onClick } })]}
        onDismiss={onDismiss}
        closeLabel="Close"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Undo" }));

    expect(onClick).toHaveBeenCalledOnce();
    expect(onDismiss).toHaveBeenCalledWith("t1");
  });

  it("takes its close label from the caller, not from a catalog of its own", () => {
    render(<ToastList toasts={[toast()]} onDismiss={() => {}} closeLabel="Cerrar" />);
    expect(screen.getByRole("button", { name: "Cerrar" })).toBeInTheDocument();
  });

  it("hides the stack when empty, so it cannot block clicks behind it", () => {
    const { container, rerender } = render(
      <ToastList toasts={[]} onDismiss={() => {}} closeLabel="Close" />,
    );
    const empty = container.firstElementChild!.className;

    rerender(<ToastList toasts={[toast()]} onDismiss={() => {}} closeLabel="Close" />);

    expect(container.firstElementChild!.className).not.toBe(empty);
  });

  it("renders every toast in the stack", () => {
    render(
      <ToastList
        toasts={[toast(), toast({ id: "t2", message: "Deleted" })]}
        onDismiss={() => {}}
        closeLabel="Close"
      />,
    );
    expect(screen.getAllByRole("alert")).toHaveLength(2);
  });
});
