import { cleanup, fireEvent, screen, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

vi.mock("@tanstack/react-router", () => ({
  // `activeOptions` is the router's; the shell decides `aria-current` itself.
  Link: ({
    to,
    children,
    activeOptions: _activeOptions,
    ...rest
  }: {
    to: string;
    children?: ReactNode;
    activeOptions?: unknown;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { AccountControls, DashboardShell } from "./dashboard-shell";

afterEach(cleanup);

function setup(overrides: Partial<React.ComponentProps<typeof DashboardShell>> = {}) {
  const props = {
    user: { name: "Ada Lovelace", email: "ada@example.com" },
    pathname: "/dashboard/settings",
    theme: "dark" as const,
    onToggleTheme: vi.fn(),
    onSignOut: vi.fn(),
    ...overrides,
  };
  const view = renderWithProviders(
    <DashboardShell {...props}>
      <p>page body</p>
    </DashboardShell>,
  );
  return { ...props, ...view };
}

const navs = () => screen.getAllByRole("navigation", { name: "Dashboard sections" });

describe("DashboardShell", () => {
  it("renders the page inside the landing palette, in the visitor's theme", () => {
    const { container } = setup({ theme: "light" });
    const root = container.querySelector("[data-kl]");
    expect(root?.getAttribute("data-kl-theme")).toBe("light");
    expect(screen.getByText("page body")).toBeTruthy();
  });

  it("has a sidebar and a phone tab bar, each marking only the open page", () => {
    setup();
    expect(navs()).toHaveLength(2);
    for (const nav of navs()) {
      const current = within(nav)
        .getAllByRole("link")
        .filter((link) => link.getAttribute("aria-current") === "page");
      expect(current.map((link) => link.textContent)).toEqual(["Settings"]);
      expect(within(nav).getByRole("link", { name: "Recordings" }).getAttribute("href")).toBe(
        "/dashboard/recordings",
      );
    }
  });

  it("marks Home only on /dashboard itself", () => {
    setup({ pathname: "/dashboard/" });
    const [sidebar] = navs();
    expect(within(sidebar!).getByRole("link", { name: "Home" }).getAttribute("aria-current")).toBe(
      "page",
    );
    expect(
      within(sidebar!).getByRole("link", { name: "Profile" }).getAttribute("aria-current"),
    ).toBeNull();
  });

  it("shows Devices and Billing as coming soon, not as links", () => {
    setup();
    const [sidebar] = navs();
    expect(within(sidebar!).queryByRole("link", { name: /Devices|Billing/ })).toBeNull();
    const devices = within(sidebar!).getByText("Devices").closest("li");
    expect(devices?.getAttribute("aria-disabled")).toBe("true");
    expect(within(sidebar!).getAllByText("Soon")).toHaveLength(2);
  });

  it("shows who is signed in, falling back to the email's local part", () => {
    setup({ user: { name: " ", email: "grace@example.com" } });
    expect(screen.getByText("grace")).toBeTruthy();
    expect(screen.getByText("grace@example.com")).toBeTruthy();
  });

  it("switches theme and signs out from the sidebar", () => {
    const { onToggleTheme, onSignOut } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });

  it("offers dark from the light theme", () => {
    setup({ theme: "light" });
    expect(screen.getByRole("button", { name: "Switch to dark theme" })).toBeTruthy();
  });

  it("marks the active language", () => {
    setup();
    const group = screen.getByRole("group", { name: "Language" });
    expect(within(group).getByRole("button", { name: "EN" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(within(group).getByRole("button", { name: "ES" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("speaks Spanish in the es locale", () => {
    renderWithProviders(
      <DashboardShell
        user={{ name: "Ada", email: "ada@example.com" }}
        pathname="/dashboard"
        theme="dark"
        onToggleTheme={vi.fn()}
        onSignOut={vi.fn()}
      >
        <p />
      </DashboardShell>,
      "es",
    );
    expect(screen.getAllByRole("link", { name: "Ajustes" })).toHaveLength(2);
    expect(screen.getByText("Dispositivos")).toBeTruthy();
  });
});

describe("AccountControls", () => {
  it("offers the theme switch and Sign out for phones", () => {
    const onToggleTheme = vi.fn();
    const onSignOut = vi.fn();
    renderWithProviders(
      <AccountControls theme="dark" onToggleTheme={onToggleTheme} onSignOut={onSignOut} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch to light theme" }));
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(onToggleTheme).toHaveBeenCalledTimes(1);
    expect(onSignOut).toHaveBeenCalledTimes(1);
  });
});
