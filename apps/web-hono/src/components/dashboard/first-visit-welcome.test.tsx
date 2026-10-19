import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import { ENTITLEMENTS_FREE, STORAGE, envelope, orpcError } from "@/test/fixtures/account";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), entitlements: vi.fn() }));
vi.mock("@/lib/orpc-client", () => ({
  client: { me: { storage: mocks.storage, entitlements: mocks.entitlements } },
  orpc: {},
}));

import { FirstVisitWelcome } from "./first-visit-welcome";

beforeEach(() => {
  window.localStorage.clear();
  mocks.storage.mockReset();
  mocks.entitlements.mockReset();
  mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
  mocks.entitlements.mockResolvedValue(envelope(ENTITLEMENTS_FREE));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("FirstVisitWelcome", () => {
  it("welcomes the user with the plan on the first visit, and only then", async () => {
    const first = renderWithProviders(<FirstVisitWelcome userId="user-1" />);
    expect(screen.getByText("Your account is ready")).toBeTruthy();
    expect(
      await screen.findByText("You're on the Free plan with 1 GB of cloud space."),
    ).toBeTruthy();
    first.unmount();

    renderWithProviders(<FirstVisitWelcome userId="user-1" />);
    expect(screen.queryByText("Your account is ready")).toBeNull();
  });

  it("tracks each user separately", () => {
    renderWithProviders(<FirstVisitWelcome userId="user-1" />).unmount();
    renderWithProviders(<FirstVisitWelcome userId="user-2" />);
    expect(screen.getByText("Your account is ready")).toBeTruthy();
  });

  it("can be dismissed", () => {
    renderWithProviders(<FirstVisitWelcome userId="user-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Got it" }));
    expect(screen.queryByText("Your account is ready")).toBeNull();
  });

  it("leaves the plan line out when the storage request fails", async () => {
    mocks.storage.mockRejectedValue(orpcError(500));
    renderWithProviders(<FirstVisitWelcome userId="user-1" />);
    expect(screen.getByText("Your account is ready")).toBeTruthy();
    await Promise.resolve();
    expect(screen.queryByText(/cloud space/)).toBeNull();
    expect(screen.queryByText(/0 B/)).toBeNull();
  });

  it("renders nothing, without throwing, when localStorage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(() => renderWithProviders(<FirstVisitWelcome userId="user-1" />)).not.toThrow();
    expect(screen.queryByText("Your account is ready")).toBeNull();
  });
});
