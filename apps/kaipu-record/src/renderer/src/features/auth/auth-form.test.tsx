import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AuthForm, type AuthFormProps } from "./auth-form";

function renderForm(overrides: Partial<AuthFormProps> = {}) {
  const props: AuthFormProps = {
    mode: "sign-in",
    pending: false,
    error: null,
    onSignIn: vi.fn(),
    onSignUp: vi.fn(),
    ...overrides,
  };
  render(<AuthForm {...props} />);
  return props;
}

function fill(values: { email?: string; password?: string; name?: string }): void {
  if (values.email !== undefined)
    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: values.email } });
  if (values.name !== undefined)
    fireEvent.change(screen.getByLabelText(/name/i), { target: { value: values.name } });
  if (values.password !== undefined)
    fireEvent.change(screen.getByLabelText(/password/i), { target: { value: values.password } });
}

describe("AuthForm", () => {
  it("submits email + password through onSignIn in sign-in mode, with no name field", () => {
    const { onSignIn, onSignUp } = renderForm();
    expect(screen.queryByLabelText(/name/i)).not.toBeInTheDocument();

    fill({ email: "a@b.com", password: "pw" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSignIn).toHaveBeenCalledWith({ email: "a@b.com", password: "pw" });
    expect(onSignUp).not.toHaveBeenCalled();
  });

  it("submits email + name + password through onSignUp in sign-up mode", () => {
    const { onSignIn, onSignUp } = renderForm({ mode: "sign-up" });

    fill({ email: "a@b.com", name: "Ada", password: "longenough" });
    fireEvent.click(screen.getByRole("button", { name: /continue/i }));

    expect(onSignUp).toHaveBeenCalledWith({
      email: "a@b.com",
      name: "Ada",
      password: "longenough",
    });
    expect(onSignIn).not.toHaveBeenCalled();
  });

  // The 8-character rule mirrors better-auth's default. It applies only to sign-up: an existing
  // account may predate it, and blocking sign-in client-side would hide the real answer.
  it("enforces the 8-character minimum on sign-up only", () => {
    renderForm({ mode: "sign-up" });
    expect(screen.getByLabelText(/password/i)).toHaveAttribute("minlength", "8");
  });

  it("puts no minimum on the sign-in password", () => {
    renderForm();
    expect(screen.getByLabelText(/password/i)).not.toHaveAttribute("minlength");
  });

  it("renders the specific copy for a structured AuthError", () => {
    renderForm({ error: { kind: "invalid-credentials" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/wrong email or password/i);
    expect(screen.queryByText(/something went wrong/i)).not.toBeInTheDocument();
  });

  it("disables submit while pending", () => {
    renderForm({ pending: true });
    expect(screen.getByRole("button", { name: /continue/i })).toBeDisabled();
  });
});
