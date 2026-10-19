import { cleanup, fireEvent, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { ENTITLEMENTS_FREE, STORAGE, envelope, orpcError } from "@/test/fixtures/account";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), entitlements: vi.fn() }));
vi.mock("@/lib/orpc-client", () => ({
  client: { me: { storage: mocks.storage, entitlements: mocks.entitlements } },
  orpc: {},
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ to, children, ...rest }: { to: string; children?: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

import { StorageSummary } from "./storage-summary";

beforeEach(() => {
  mocks.storage.mockReset();
  mocks.entitlements.mockReset();
  mocks.entitlements.mockResolvedValue(envelope(ENTITLEMENTS_FREE));
});
afterEach(cleanup);

const noZeroUsage = () => expect(screen.queryByText(/^0 B/)).toBeNull();

describe("StorageSummary", () => {
  it("links to the settings page where the detail lives", () => {
    mocks.storage.mockReturnValue(new Promise(() => undefined));
    renderWithProviders(<StorageSummary />);
    expect(screen.getByRole("link", { name: "Manage" }).getAttribute("href")).toBe(
      "/dashboard/settings",
    );
  });

  it("shows no numbers while loading", () => {
    mocks.storage.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<StorageSummary />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    noZeroUsage();
  });

  it("shows the plan line, one bar and used of capacity", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Plan Free · 1 GB")).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "610 MB used and 130 MB reserved of 1 GB",
    );
    expect(screen.getByText("610 MB used of 1 GB")).toBeTruthy();
  });

  it("falls back to the full notices when the usage needs attention", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.overQuota));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("You're using more than your plan includes")).toBeTruthy();
  });

  it("explains beta-unavailable, without a bar", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.betaUnavailable));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Verify your email to use cloud")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("says cloud is not available on a 404", async () => {
    mocks.storage.mockRejectedValue(orpcError(404));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Cloud storage isn't available yet")).toBeTruthy();
    noZeroUsage();
  });

  it("asks to sign in again on a 401 and returns to the dashboard", async () => {
    mocks.storage.mockRejectedValue(orpcError(401));
    renderWithProviders(<StorageSummary />);
    const link = await screen.findByRole("link", { name: "Sign in again" });
    expect(link.getAttribute("href")).toBe("/auth/login?redirect=%2Fdashboard");
  });

  it("shows an error with Retry on a failure, never zeros, and recovers", async () => {
    mocks.storage.mockRejectedValue(orpcError(500));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Couldn't load your cloud space")).toBeTruthy();
    noZeroUsage();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText(/used of/)).toBeNull();

    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Plan Free · 1 GB")).toBeTruthy();
  });
});
