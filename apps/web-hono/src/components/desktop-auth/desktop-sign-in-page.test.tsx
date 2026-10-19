import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import type { AuthSession } from "@/lib/auth/types";

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  invalidate: vi.fn(async () => undefined),
  transferUser: vi.fn(),
  signOut: vi.fn(async () => ({})),
  formProps: vi.fn(),
}));

vi.mock("@tanstack/react-router", () => ({
  useRouter: () => ({ invalidate: mocks.invalidate, history: { push: mocks.push } }),
  Link: ({ to, search, children }: { to: string; search?: object; children: React.ReactNode }) => (
    <a href={`${to}${search ? `?${new URLSearchParams(search as Record<string, string>)}` : ""}`}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/auth/auth-client", () => ({ authClient: { signOut: mocks.signOut } }));
vi.mock("@/lib/auth/desktop-auth-client", () => ({
  desktopAuthClient: { electron: { transferUser: mocks.transferUser } },
}));
vi.mock("@/components/sign-in-form", () => ({
  default: (props: object) => {
    mocks.formProps(props);
    return <div>sign-in form</div>;
  },
}));

import { DesktopSignInPage } from "./desktop-sign-in-page";

const query = {
  client_id: "kaipu-desktop",
  state: "Ab12Cd34Ef56Gh78",
  code_challenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
};
const search = `client_id=kaipu-desktop&state=Ab12Cd34Ef56Gh78&code_challenge=${query.code_challenge}`;
const session = {
  user: { name: "Ada Lovelace", email: "ada@example.com" },
  session: {},
} as unknown as AuthSession;

beforeEach(() => {
  mocks.push.mockReset();
  mocks.invalidate.mockClear();
  mocks.signOut.mockClear();
  mocks.formProps.mockReset();
  mocks.transferUser.mockReset().mockResolvedValue({ data: {}, error: null });
});
afterEach(cleanup);

describe("DesktopSignInPage", () => {
  it("asks to start from the app when the query is missing", () => {
    renderWithProviders(<DesktopSignInPage query={null} session={session} />);
    expect(screen.getByRole("heading", { name: "Open sign-in from the Kaipu app" })).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the sign-in form with the query, and a sign-up link that keeps it", () => {
    renderWithProviders(<DesktopSignInPage query={query} session={null} />);
    expect(screen.getByText("sign-in form")).toBeTruthy();
    expect(mocks.formProps).toHaveBeenCalledWith(expect.objectContaining({ desktop: query }));
    expect(screen.getByRole("link", { name: "Create account" }).getAttribute("href")).toBe(
      `/auth/signup?${search}`,
    );
  });

  it("asks a signed-in visitor to confirm the account", () => {
    renderWithProviders(<DesktopSignInPage query={query} session={session} />);
    expect(
      screen.getByRole("heading", { name: "Sign in to Kaipu on this computer?" }),
    ).toBeTruthy();
    expect(screen.getByText("You're signed in as Ada Lovelace (ada@example.com).")).toBeTruthy();
    expect(screen.queryByText("sign-in form")).toBeNull();
  });

  it("Continue transfers the user with the query and goes to the done page", async () => {
    renderWithProviders(<DesktopSignInPage query={query} session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith(`/auth/desktop/done?${search}`));
    expect(mocks.transferUser).toHaveBeenCalledWith({ fetchOptions: { query } });
  });

  it("stays on the page with an error when the transfer fails", async () => {
    mocks.transferUser.mockResolvedValue({ data: null, error: { status: 400 } });
    renderWithProviders(<DesktopSignInPage query={query} session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("Switch account signs out and reloads the session without leaving the page", async () => {
    renderWithProviders(<DesktopSignInPage query={query} session={session} />);
    fireEvent.click(screen.getByRole("button", { name: "Switch account" }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
    expect(mocks.signOut).toHaveBeenCalled();
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it("renders the Spanish copy", () => {
    renderWithProviders(<DesktopSignInPage query={query} session={session} />, "es");
    expect(screen.getByRole("button", { name: "Cambiar de cuenta" })).toBeTruthy();
  });
});
