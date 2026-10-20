import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const context = vi.hoisted(() => ({ hasSessionCookie: false }));

vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ landingTheme: "dark", hasSessionCookie: context.hasSessionCookie }),
  useRouter: () => ({ invalidate: vi.fn() }),
}));
vi.mock("@kaipu/brand", () => ({ KaipuLogo: () => null }));
vi.mock("@/server-functions/set-landing-theme", () => ({ setLandingTheme: vi.fn() }));

import { TopNav } from "./top-nav";

afterEach(cleanup);

function accountLinks(hasSessionCookie: boolean) {
  context.hasSessionCookie = hasSessionCookie;
  renderWithProviders(<TopNav />);
  return {
    signIn: screen.queryAllByRole("link", { name: "Sign in" }),
    dashboard: screen.queryAllByRole("link", { name: "Dashboard" }),
  };
}

describe("TopNav account link", () => {
  it("offers Sign in, desktop and mobile, when there is no session cookie", () => {
    const { signIn, dashboard } = accountLinks(false);
    expect(signIn).toHaveLength(2);
    for (const link of signIn) expect(link.getAttribute("href")).toBe("/auth/login");
    expect(dashboard).toHaveLength(0);
  });

  it("offers Dashboard, desktop and mobile, when a session cookie is present", () => {
    const { signIn, dashboard } = accountLinks(true);
    expect(dashboard).toHaveLength(2);
    for (const link of dashboard) expect(link.getAttribute("href")).toBe("/dashboard");
    expect(signIn).toHaveLength(0);
  });
});
