import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  signInEmail: vi.fn(),
  signUpEmail: vi.fn(),
  social: vi.fn(),
  sendVerificationEmail: vi.fn(async () => ({ data: { status: true }, error: null })),
  signOut: vi.fn(async () => ({})),
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
  authClient: {
    signIn: { email: mocks.signInEmail, social: mocks.social },
    signUp: { email: mocks.signUpEmail },
    sendVerificationEmail: mocks.sendVerificationEmail,
    signOut: mocks.signOut,
  },
}));

import { AuthPanel } from "./auth-panel";

const desktop = {
  client_id: "kaipu-desktop",
  state: "Ab12Cd34Ef56Gh78",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
};
const desktopSearch = `client_id=kaipu-desktop&state=Ab12Cd34Ef56Gh78&code_challenge=${desktop.code_challenge}`;

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockClear();
  mocks.signInEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.signUpEmail.mockReset().mockResolvedValue({ data: {}, error: null });
  mocks.social.mockReset().mockImplementation(() => new Promise(() => {}));
});
afterEach(cleanup);

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe("AuthPanel — sign in", () => {
  it("leads with Google, keeps email one step behind, and says an account is optional", () => {
    renderWithProviders(<AuthPanel mode="sign-in" />);
    expect(screen.getByRole("heading", { name: "Welcome back" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Continue with email" })).toBeTruthy();
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.getByText(/Recording never needs an account/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Terms" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Privacy Policy" })).toBeTruthy();
    expect(screen.queryByText(/Kaipu Record .*is waiting/)).toBeNull();
  });

  it("reveals the email form and goes back to Google", () => {
    renderWithProviders(<AuthPanel mode="sign-in" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
    expect(screen.getByLabelText("Email")).toBeTruthy();
    expect(screen.getByLabelText("Password")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(screen.queryByText(/Recording never needs an account/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Back to Google" }));
    expect(screen.getByRole("button", { name: "Continue with Google" })).toBeTruthy();
  });

  it("shows a closed Google window with the design's words, never the raw code", () => {
    renderWithProviders(<AuthPanel mode="sign-in" oauthError="access_denied" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe(
      "Google sign-in was closed. Nothing happened — try again, or use your email.",
    );
    cleanup();
    renderWithProviders(<AuthPanel mode="sign-in" oauthError="state_mismatch" />);
    expect(screen.getByRole("alert").textContent).toBe(
      "The Google sign-in was interrupted or took too long. Try again.",
    );
  });

  it("wrong credentials offer the sign-up tab with the email carried over", async () => {
    mocks.signInEmail.mockResolvedValue({ data: null, error: { status: 401 } });
    renderWithProviders(<AuthPanel mode="sign-in" redirectTo="/dashboard/settings" />);
    fireEvent.click(screen.getByRole("button", { name: "Continue with email" }));
    fill("Email", "new@example.com");
    fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "New to Kaipu? Create an account with this email",
      }),
    );
    expect(mocks.push).toHaveBeenCalledWith("/auth/signup?redirect=%2Fdashboard%2Fsettings");
    cleanup();

    // The sign-up route mounts the panel again: it opens on the email form, prefilled.
    renderWithProviders(<AuthPanel mode="sign-up" />);
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("new@example.com");
    cleanup();
    // Read once: the next visit starts empty.
    renderWithProviders(<AuthPanel mode="sign-up" />);
    expect(screen.queryByLabelText("Email")).toBeNull();
  });
});

describe("AuthPanel — tabs keep the query", () => {
  it("on the web, both tabs carry the redirect", () => {
    renderWithProviders(<AuthPanel mode="sign-in" redirectTo="/dashboard/recordings" />);
    const signIn = screen.getByRole("link", { name: "Sign in" });
    const signUp = screen.getByRole("link", { name: "Create account" });
    expect(signIn.getAttribute("href")).toBe("/auth/login?redirect=%2Fdashboard%2Frecordings");
    expect(signIn.getAttribute("aria-current")).toBe("page");
    expect(signUp.getAttribute("href")).toBe("/auth/signup?redirect=%2Fdashboard%2Frecordings");
    fireEvent.click(signUp);
    expect(mocks.push).toHaveBeenCalledWith("/auth/signup?redirect=%2Fdashboard%2Frecordings");
  });

  it("without a redirect, the tabs are the bare pages", () => {
    renderWithProviders(<AuthPanel mode="sign-up" />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth/login");
    expect(screen.getByRole("link", { name: "Create account" }).getAttribute("aria-current")).toBe(
      "page",
    );
  });

  it("from the desktop, both tabs keep client_id, state and code_challenge", () => {
    renderWithProviders(<AuthPanel mode="sign-in" desktop={desktop} />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe(
      `/auth/desktop?${desktopSearch}`,
    );
    expect(screen.getByRole("link", { name: "Create account" }).getAttribute("href")).toBe(
      `/auth/desktop?${desktopSearch}&intent=sign-up`,
    );
    expect(screen.getByText(/^Kaipu Record( for \w+)? is waiting$/)).toBeTruthy();
    expect(screen.getByText("Sign in here and we'll send you back to the app.")).toBeTruthy();
  });
});

describe("AuthPanel — sign up", () => {
  it("uses the sign-up words for the same layout", () => {
    renderWithProviders(<AuthPanel mode="sign-up" />);
    expect(screen.getByRole("heading", { name: "Create your account" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign up with Google" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Sign up with email" }));
    expect(screen.getByLabelText("Name")).toBeTruthy();
    expect(screen.getByText(/at least 18 years old/)).toBeTruthy();
  });

  it("after an email sign-up on the web, says to check the email and offers the library", async () => {
    renderWithProviders(<AuthPanel mode="sign-up" redirectTo="/dashboard/settings" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up with email" }));
    fill("Name", "Ada Lovelace");
    fill("Email", "ada@gmail.com");
    fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));

    expect(await screen.findByRole("heading", { name: "Check your email" })).toBeTruthy();
    expect(screen.getByText("ada@gmail.com")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to your library" }).getAttribute("href")).toBe(
      "/dashboard/settings",
    );
    expect(screen.getByRole("link", { name: "Open Gmail" }).getAttribute("href")).toBe(
      "https://mail.google.com/",
    );
  });

  it("Wrong email? Change it signs the new account out and reopens the form", async () => {
    renderWithProviders(<AuthPanel mode="sign-up" />);
    fireEvent.click(screen.getByRole("button", { name: "Sign up with email" }));
    fill("Name", "Ada Lovelace");
    fill("Email", "ada@exmaple.com");
    fill("Password", "correct horse battery");
    fireEvent.click(screen.getByRole("button", { name: "Create account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Wrong email? Change it" }));
    await waitFor(() => expect(screen.getByLabelText("Email")).toBeTruthy());
    expect(mocks.signOut).toHaveBeenCalled();
    expect((screen.getByLabelText("Email") as HTMLInputElement).value).toBe("ada@exmaple.com");
  });
});
