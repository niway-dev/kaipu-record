import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Input } from "./input";

describe("Input", () => {
  it("renders a bare field when it has no label", () => {
    render(<Input placeholder="Email" />);
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: /.+/ })).toBeNull();
  });

  it("associates the label with the field through id/htmlFor", async () => {
    // The pairing is the part people forget, and forgetting it produces a field
    // no screen reader can announce — which looks like nothing is wrong.
    render(<Input id="auth-email" label="Email" />);

    const field = screen.getByLabelText("Email");
    expect(field).toBe(screen.getByRole("textbox"));
    expect(field).toHaveAttribute("id", "auth-email");
  });

  it("forwards typing to onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Input id="x" label="Name" onChange={onChange} />);

    await user.type(screen.getByLabelText("Name"), "ab");

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("drops the interactive layer when disabled", () => {
    const { rerender } = render(<Input id="x" label="Name" />);
    const enabled = new Set(screen.getByLabelText("Name").className.split(" "));

    rerender(<Input id="x" label="Name" disabled />);
    const disabled = new Set(screen.getByLabelText("Name").className.split(" "));

    expect(screen.getByLabelText("Name")).toBeDisabled();
    expect([...enabled].filter((c) => !disabled.has(c))).not.toHaveLength(0);
    expect([...disabled].filter((c) => !enabled.has(c))).not.toHaveLength(0);
  });

  it("forwards native attributes like type and required", () => {
    render(<Input id="p" label="Password" type="password" required minLength={8} />);

    const field = screen.getByLabelText("Password");
    expect(field).toHaveAttribute("type", "password");
    expect(field).toBeRequired();
    expect(field).toHaveAttribute("minlength", "8");
  });
});
