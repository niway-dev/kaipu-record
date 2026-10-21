import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

const context = vi.hoisted(() => ({ hasSessionCookie: false }));

vi.mock("@tanstack/react-router", () => ({
  useRouteContext: () => ({ hasSessionCookie: context.hasSessionCookie }),
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));
vi.mock("@kaipu/brand", () => ({ KaipuLogo: () => null }));
vi.mock("../locale-switcher", () => ({ LocaleSwitcher: () => null }));
vi.mock("../theme-toggle", () => ({ ThemeToggle: () => null }));

import { LandingNav } from "./landing-nav";

afterEach(cleanup);

describe("LandingNav account link", () => {
  it("shows Sign in without a session cookie", () => {
    context.hasSessionCookie = false;
    renderWithProviders(<LandingNav />);
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/auth/login");
    expect(screen.queryByRole("link", { name: "Dashboard" })).toBeNull();
  });

  it("shows Dashboard with a session cookie", () => {
    context.hasSessionCookie = true;
    renderWithProviders(<LandingNav />);
    expect(screen.getByRole("link", { name: "Dashboard" }).getAttribute("href")).toBe("/dashboard");
    expect(screen.queryByRole("link", { name: "Sign in" })).toBeNull();
  });
});
