import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  requestPasswordReset: vi.fn(async () => ({ data: { status: true }, error: null })),
  resetPassword: vi.fn(),
  sendVerificationEmail: vi.fn(async () => ({ data: { status: true }, error: null })),
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => mocks.navigate,
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: {
    requestPasswordReset: mocks.requestPasswordReset,
    resetPassword: mocks.resetPassword,
    sendVerificationEmail: mocks.sendVerificationEmail,
  },
}));

import { EmailVerified } from "./email-verified";
import { ForgotPassword, ResetPassword } from "./password-reset";

beforeEach(() => {
  mocks.navigate.mockReset();
  mocks.requestPasswordReset.mockClear();
  mocks.sendVerificationEmail.mockClear();
  mocks.resetPassword.mockReset().mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("ForgotPassword", () => {
  it("sends a reset link and gives the same answer for any email", async () => {
    renderWithProviders(<ForgotPassword />);
    expect(screen.getByRole("heading", { name: "Reset your password" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Back to sign in" }).getAttribute("href")).toBe(
      "/auth/login",
    );
    fill("Email", "ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText(/If that email has a Kaipu account/)).toBeTruthy();
    expect(mocks.requestPasswordReset).toHaveBeenCalledWith({
      email: "ada@example.com",
      redirectTo: "/auth/reset-password",
    });
  });

  it("checks the email first", async () => {
    renderWithProviders(<ForgotPassword />);
    fill("Email", "nope");
    fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));
    expect(await screen.findByText("Invalid email address")).toBeTruthy();
    expect(mocks.requestPasswordReset).not.toHaveBeenCalled();
  });
});

describe("ResetPassword", () => {
  it("asks for the emailed link when there is no token", () => {
    renderWithProviders(<ResetPassword />);
    expect(screen.getByText("This page needs the link from your email.")).toBeTruthy();
  });

  it("sets the new password and goes to sign in", async () => {
    renderWithProviders(<ResetPassword token="tok" />);
    fill("Password", "a brand new password");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith({ to: "/auth/login" }));
    expect(mocks.resetPassword).toHaveBeenCalledWith({
      newPassword: "a brand new password",
      token: "tok",
    });
  });

  it("says when the link has expired", async () => {
    mocks.resetPassword.mockResolvedValue({ data: null, error: { status: 400 } });
    renderWithProviders(<ResetPassword token="old" />);
    fill("Password", "a brand new password");
    fireEvent.click(screen.getByRole("button", { name: "Set new password" }));
    expect((await screen.findByRole("alert")).textContent).toContain("invalid or has expired");
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});

describe("EmailVerified", () => {
  it("confirms a verified email", () => {
    renderWithProviders(<EmailVerified />);
    expect(screen.getByRole("heading", { name: "Email verified" })).toBeTruthy();
  });

  it("offers a new link when the old one failed", async () => {
    renderWithProviders(<EmailVerified error="token_expired" />);
    fill("Email", "ada@example.com");
    fireEvent.click(screen.getByRole("button", { name: "Send a new verification email" }));
    expect(await screen.findByText("A new verification email is on its way.")).toBeTruthy();
    expect(mocks.sendVerificationEmail).toHaveBeenCalledWith({
      email: "ada@example.com",
      callbackURL: "/auth/email-verified",
    });
  });
});
