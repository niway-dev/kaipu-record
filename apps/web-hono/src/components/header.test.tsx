import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, className }: { to: string; children: unknown; className?: string }) => (
    <a href={to} className={className}>
      {children as never}
    </a>
  ),
}));
vi.mock("@kaipu/brand", () => ({ KaipuLogo: () => null }));
vi.mock("./user-menu", () => ({ default: () => null }));
vi.mock("./locale-switcher", () => ({ LocaleSwitcher: () => null }));

import Header from "./header";

afterEach(cleanup);

function brandLinkHref(isAuthenticated: boolean) {
  renderWithProviders(
    <Header isAuthenticated={isAuthenticated} userName="Ada" userEmail="ada@example.com" />,
  );
  return screen.getAllByRole("link")[0]?.getAttribute("href");
}

describe("Header brand link", () => {
  it("opens the dashboard when signed in", () => {
    expect(brandLinkHref(true)).toBe("/dashboard");
  });

  it("opens the landing page when signed out", () => {
    expect(brandLinkHref(false)).toBe("/");
  });
});
