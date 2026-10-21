import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SourceCard } from "./source-card";

const base = {
  icon: <svg data-testid="icon" />,
  name: "Screen 1",
  meta: "Screen",
  actionLabel: "Change",
  onAction: () => {},
};

describe("SourceCard", () => {
  it("shows the name, the caption and the icon it is given", () => {
    render(<SourceCard {...base} />);
    expect(screen.getByText("Screen 1")).toBeInTheDocument();
    expect(screen.getByText("Screen")).toBeInTheDocument();
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("fires onAction from the action button", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    render(<SourceCard {...base} onAction={onAction} />);
    await user.click(screen.getByRole("button", { name: "Change" }));
    expect(onAction).toHaveBeenCalledOnce();
  });

  it("replaces the action with the locked badge while locked", () => {
    render(
      <SourceCard {...base} locked lockedIcon={<svg data-testid="lock" />} lockedLabel="Locked" />,
    );
    expect(screen.getByText("Locked")).toBeInTheDocument();
    expect(screen.getByTestId("lock")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("styles the compact variant differently from the full one", () => {
    const { container, rerender } = render(<SourceCard {...base} />);
    const full = (container.firstChild as HTMLElement).className;

    rerender(<SourceCard {...base} variant="compact" />);
    expect((container.firstChild as HTMLElement).className).not.toBe(full);
  });
});
