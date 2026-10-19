import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { MockLink } from "@/test/router-mock";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  Link: MockLink,
  useRouter: () => ({ invalidate: mocks.invalidate, history: { push: mocks.push } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signIn: { email: mocks.signInEmail }, signUp: { email: mocks.signUpEmail } },
}));

import SignInForm from "./sign-in-form";
import SignUpForm from "./sign-up-form";

/** Better Auth's client calls `onSuccess` from its second argument when the request succeeds. */
const succeed = async (_body: unknown, callbacks: { onSuccess: () => Promise<void> | void }) => {
  await callbacks.onSuccess();
};

beforeEach(() => {
  mocks.push.mockReset();
  mocks.invalidate.mockClear();
  mocks.signInEmail.mockReset().mockImplementation(succeed);
  mocks.signUpEmail.mockReset().mockImplementation(succeed);
});
afterEach(cleanup);

function fillSignIn() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
}

function fillSignUp() {
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Ada Lovelace" } });
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "ada@example.com" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "correct horse" } });
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
}

describe("SignInForm", () => {
  it("lands on the dashboard after an email sign-in", async () => {
    renderWithProviders(<SignInForm />);
    fillSignIn();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it("goes where the visitor asked when the redirect is a safe path", async () => {
    renderWithProviders(<SignInForm redirectTo="/dashboard/settings" />);
    fillSignIn();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/settings"));
  });

  it("ignores an unsafe redirect that reached the form", async () => {
    renderWithProviders(<SignInForm redirectTo="https://evil.example" />);
    fillSignIn();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
    expect(mocks.push).not.toHaveBeenCalledWith("https://evil.example");
  });
});

describe("SignUpForm", () => {
  it("lands on the dashboard after an email sign-up", async () => {
    renderWithProviders(<SignUpForm />);
    fillSignUp();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
  });

  it("goes where the visitor asked when the redirect is a safe path", async () => {
    renderWithProviders(<SignUpForm redirectTo="/dashboard/profile" />);
    fillSignUp();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/profile"));
  });

  it("ignores an unsafe redirect that reached the form", async () => {
    renderWithProviders(<SignUpForm redirectTo="//evil.example" />);
    fillSignUp();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
    expect(mocks.push).not.toHaveBeenCalledWith("//evil.example");
  });
});
