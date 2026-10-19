import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { MockLink } from "@/test/router-mock";
import { ENTITLEMENTS_FREE, STORAGE, envelope, orpcError } from "@/test/fixtures/account";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), entitlements: vi.fn() }));
vi.mock("@/lib/orpc-client", () => ({
  client: { me: { storage: mocks.storage, entitlements: mocks.entitlements } },
  orpc: {},
}));
vi.mock("@tanstack/react-router", () => ({ Link: MockLink }));

import { StorageSummary } from "./storage-summary";

beforeEach(() => {
  mocks.storage.mockReset();
  mocks.entitlements.mockReset();
  mocks.entitlements.mockResolvedValue(envelope(ENTITLEMENTS_FREE));
});
afterEach(cleanup);

describe("StorageSummary", () => {
  it("links to the settings page, where the breakdown lives", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    renderWithProviders(<StorageSummary />);
    const manage = await screen.findByRole("link", { name: "Manage" });
    expect(manage.getAttribute("href")).toBe("/dashboard/settings");
  });

  it("shows the plan line and one bar, without the detailed breakdown", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Plan Free · 1 GB")).toBeTruthy();
    expect(screen.getAllByRole("img")).toHaveLength(1);
    expect(screen.getAllByText("610 MB used and 130 MB reserved of 1 GB").length).toBeGreaterThan(
      0,
    );
    expect(screen.queryByText("In progress (reserved by uploads)")).toBeNull();
    expect(screen.queryByText("Up to 1 GB per video.")).toBeNull();
  });

  it("keeps the warnings that change what the user can do", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.overQuota));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("You're using more than your plan includes")).toBeTruthy();
  });

  it("shows no numbers while loading", () => {
    mocks.storage.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<StorageSummary />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.queryByText("0 B")).toBeNull();
  });

  it("shows an error with Retry on a failed request, never zeros", async () => {
    mocks.storage.mockRejectedValue(orpcError(500));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Couldn't load your cloud space")).toBeTruthy();
    expect(screen.queryByText("0 B")).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();

    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Plan Free · 1 GB")).toBeTruthy();
  });

  it("treats an empty answer as a fault", async () => {
    mocks.storage.mockResolvedValue({ data: null, error: null });
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Couldn't load your cloud space")).toBeTruthy();
    expect(screen.queryByText("0 B")).toBeNull();
  });

  it("asks to verify the email instead of drawing a bar when cloud is not on", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.betaUnavailable));
    renderWithProviders(<StorageSummary />);
    expect(await screen.findByText("Verify your email to use cloud")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("asks to sign in again on a 401, returning to the dashboard", async () => {
    mocks.storage.mockRejectedValue(orpcError(401));
    renderWithProviders(<StorageSummary />);
    const link = await screen.findByRole("link", { name: "Sign in again" });
    expect(link.getAttribute("href")).toBe("/auth/login?redirect=%2Fdashboard");
  });
});
