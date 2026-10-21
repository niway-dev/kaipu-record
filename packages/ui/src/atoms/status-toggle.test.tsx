import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatusToggle } from "./status-toggle";

describe("StatusToggle", () => {
  it("reads ON when active and OFF when not", () => {
    const { rerender } = render(<StatusToggle icon={null} isActive={false} onToggle={() => {}} />);
    expect(screen.getByText("OFF")).toBeInTheDocument();

    rerender(<StatusToggle icon={null} isActive onToggle={() => {}} />);
    expect(screen.getByText("ON")).toBeInTheDocument();
  });

  it("uses the readout words it is given", () => {
    render(<StatusToggle icon={null} isActive onText="Sí" offText="No" onToggle={() => {}} />);
    expect(screen.getByText("Sí")).toBeInTheDocument();
  });

  it("shows the label only when one is given", () => {
    const { rerender } = render(
      <StatusToggle icon={null} label="Mic" isActive onToggle={() => {}} />,
    );
    expect(screen.getByText("Mic")).toBeInTheDocument();

    rerender(<StatusToggle icon={null} isActive onToggle={() => {}} />);
    expect(screen.queryByText("Mic")).not.toBeInTheDocument();
  });

  it("fires onToggle when clicked", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(<StatusToggle icon={null} label="Mic" isActive={false} onToggle={onToggle} />);
    await user.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("marks the active state and styles it differently", () => {
    const { rerender } = render(<StatusToggle icon={null} isActive={false} onToggle={() => {}} />);
    const off = screen.getByRole("button").className;
    expect(screen.getByRole("button")).not.toHaveAttribute("data-active");

    rerender(<StatusToggle icon={null} isActive onToggle={() => {}} />);
    expect(screen.getByRole("button")).toHaveAttribute("data-active", "true");
    expect(screen.getByRole("button").className).not.toBe(off);
  });
});
