import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, history: { push: mocks.push } }),
}));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signIn: { email: mocks.signInEmail }, signUp: { email: mocks.signUpEmail } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/cloud-promotion", () => ({ default: () => null }));
vi.mock("@/components/legal/signup-legal-notice", () => ({ SignupLegalNotice: () => null }));

import SignInForm from "./sign-in-form";
import SignUpForm from "./sign-up-form";

/** The auth client calls `onSuccess` once the server accepts the credentials. */
const succeed = async (_body: unknown, callbacks: { onSuccess: () => Promise<void> }) =>
  callbacks.onSuccess();

beforeEach(() => {
  mocks.push.mockReset();
  mocks.invalidate.mockClear();
  mocks.signInEmail.mockReset().mockImplementation(succeed);
  mocks.signUpEmail.mockReset().mockImplementation(succeed);
});
afterEach(cleanup);

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

async function signIn(redirectTo?: string) {
  renderWithProviders(<SignInForm redirectTo={redirectTo} />);
  fill("Email", "ada@example.com");
  fill("Password", "correct horse battery");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
}

async function signUp(redirectTo?: string) {
  renderWithProviders(<SignUpForm redirectTo={redirectTo} />);
  fill("Name", "Ada Lovelace");
  fill("Email", "ada@example.com");
  fill("Password", "correct horse battery");
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  await waitFor(() => expect(mocks.push).toHaveBeenCalledTimes(1));
}

describe("SignInForm", () => {
  it("ends on the dashboard by default", async () => {
    await signIn();
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it("follows a valid same-origin redirect", async () => {
    await signIn("/dashboard/settings");
    expect(mocks.push).toHaveBeenCalledWith("/dashboard/settings");
  });

  it("ignores a redirect that would leave the site", async () => {
    await signIn("https://evil.example");
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});

describe("SignUpForm", () => {
  it("ends on the dashboard by default", async () => {
    await signUp();
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });

  it("follows a valid same-origin redirect", async () => {
    await signUp("/dashboard/recordings");
    expect(mocks.push).toHaveBeenCalledWith("/dashboard/recordings");
  });

  it("ignores a protocol-relative redirect", async () => {
    await signUp("//evil.example");
    expect(mocks.push).toHaveBeenCalledWith("/dashboard");
  });
});
