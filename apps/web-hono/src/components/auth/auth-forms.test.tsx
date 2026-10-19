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
  Link: ({ to, children, ...rest }: { to: string; children: React.ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/auth/auth-client", () => ({
  authClient: { signIn: { email: mocks.signInEmail }, signUp: { email: mocks.signUpEmail } },
}));

import SignInForm from "./sign-in-form";
import SignUpForm from "./sign-up-form";

const ok = async () => ({ data: {}, error: null });
const desktop = {
  client_id: "kaipu-desktop",
  state: "Ab12Cd34Ef56Gh78",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
};
const done = `/auth/desktop/done?client_id=kaipu-desktop&state=Ab12Cd34Ef56Gh78&code_challenge=${desktop.code_challenge}`;

beforeEach(() => {
  mocks.push.mockReset();
  mocks.invalidate.mockClear();
  mocks.signInEmail.mockReset().mockImplementation(ok);
  mocks.signUpEmail.mockReset().mockImplementation(ok);
});
afterEach(cleanup);

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

const noop = () => {};

function renderSignIn(props: Partial<Parameters<typeof SignInForm>[0]> = {}) {
  const onCreateAccount = vi.fn();
  const onBack = vi.fn();
  renderWithProviders(<SignInForm onBack={onBack} onCreateAccount={onCreateAccount} {...props} />);
  return { onCreateAccount, onBack };
}

async function signIn(props: Partial<Parameters<typeof SignInForm>[0]> = {}) {
  const handlers = renderSignIn(props);
  fill("Email", "ada@example.com");
  fill("Password", "correct horse battery");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  return handlers;
}

function renderSignUp(props: Partial<Parameters<typeof SignUpForm>[0]> = {}) {
  const onSignedUp = vi.fn();
  renderWithProviders(<SignUpForm onBack={noop} onSignedUp={onSignedUp} {...props} />);
  fill("Name", "Ada Lovelace");
  fill("Email", "ada@example.com");
  fill("Password", "correct horse battery");
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  return { onSignedUp };
}

describe("SignInForm", () => {
  it("ends on the dashboard by default", async () => {
    await signIn();
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard"));
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.signInEmail.mock.calls[0]![1].query).toBeUndefined();
  });

  it("follows a valid same-origin redirect and ignores one that leaves the site", async () => {
    await signIn({ redirectTo: "/dashboard/settings" });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith("/dashboard/settings"));
    cleanup();
    await signIn({ redirectTo: "https://evil.example" });
    await waitFor(() => expect(mocks.push).toHaveBeenLastCalledWith("/dashboard"));
  });

  it("checks the fields before calling the server", async () => {
    renderSignIn();
    fill("Email", "not-an-email");
    fill("Password", "short");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Invalid email address")).toBeTruthy();
    expect(screen.getByText("Password must be at least 8 characters")).toBeTruthy();
    expect(screen.getByLabelText("Email").getAttribute("aria-invalid")).toBe("true");
    expect(mocks.signInEmail).not.toHaveBeenCalled();
  });

  it("answers wrong credentials with one neutral error and a create-account offer", async () => {
    mocks.signInEmail.mockResolvedValue({
      data: null,
      error: { status: 401, code: "INVALID_EMAIL_OR_PASSWORD" },
    });
    const { onCreateAccount } = await signIn();
    const alert = await screen.findByRole("alert");
    // The same words whether the email has an account or not: nothing to enumerate.
    expect(alert.textContent).toContain("Wrong email or password.");
    expect(alert.textContent).not.toMatch(/no Kaipu account|doesn.t exist|not found/i);
    fireEvent.click(
      screen.getByRole("button", { name: "New to Kaipu? Create an account with this email" }),
    );
    expect(onCreateAccount).toHaveBeenCalledWith("ada@example.com");
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("says when the server cannot be reached", async () => {
    mocks.signInEmail.mockRejectedValue(new TypeError("Failed to fetch"));
    await signIn();
    expect((await screen.findByRole("alert")).textContent).toContain("Couldn't reach the server");
  });

  it("shows and hides the password, and links to the reset page", () => {
    renderSignIn();
    const input = screen.getByLabelText("Password") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: "Show password" }));
    expect(input.type).toBe("text");
    expect(screen.getByRole("button", { name: "Hide password" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe(
      "/auth/forgot-password",
    );
  });

  it("goes back to Google", () => {
    const { onBack } = renderSignIn();
    fireEvent.click(screen.getByRole("button", { name: "Back to Google" }));
    expect(onBack).toHaveBeenCalled();
  });

  it("from the desktop, sends the app's query and lands on the done page (NIW2-471)", async () => {
    await signIn({ desktop, redirectTo: "/dashboard/settings" });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(done));
    expect(mocks.signInEmail.mock.calls[0]![1]).toMatchObject({ query: desktop });
  });
});

describe("SignUpForm", () => {
  it("on the web, stays for Check your email instead of leaving", async () => {
    const { onSignedUp } = renderSignUp();
    await waitFor(() => expect(onSignedUp).toHaveBeenCalledWith("ada@example.com"));
    expect(mocks.push).not.toHaveBeenCalled();
    // Re-running the route would send the now signed-in visitor away from /auth/signup.
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.signUpEmail.mock.calls[0]![0]).toEqual({
      name: "Ada Lovelace",
      email: "ada@example.com",
      password: "correct horse battery",
    });
  });

  it("from the desktop, goes straight back to the app with the check-email note", async () => {
    const { onSignedUp } = renderSignUp({ desktop });
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`${done}&check_email=1`));
    expect(mocks.signUpEmail.mock.calls[0]![1]).toMatchObject({ query: desktop });
    expect(onSignedUp).not.toHaveBeenCalled();
  });

  it("shows a failure without leaving", async () => {
    mocks.signUpEmail.mockResolvedValue({ data: null, error: { status: 422 } });
    const { onSignedUp } = renderSignUp();
    expect((await screen.findByRole("alert")).textContent).toContain(
      "We couldn't create your account.",
    );
    expect(onSignedUp).not.toHaveBeenCalled();
  });

  it("keeps the details it is given, and says how long the password must be", () => {
    renderWithProviders(
      <SignUpForm onBack={noop} onSignedUp={noop} defaultValues={{ email: "ada@example.com" }} />,
    );
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ada@example.com");
    expect(screen.getByText("8+ characters")).toBeTruthy();
  });

  it("speaks Spanish", () => {
    renderWithProviders(<SignUpForm onBack={noop} onSignedUp={noop} />, "es");
    expect(screen.getByRole("button", { name: "Crear cuenta" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Volver a Google" })).toBeTruthy();
  });
});
