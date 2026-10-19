import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import {
  ENTITLEMENTS_FREE,
  ENTITLEMENTS_PRO_UNTIL,
  STORAGE,
  envelope,
  orpcError,
} from "@/test/fixtures/account";
import { accountKeys } from "@/hooks/use-account-storage";

const mocks = vi.hoisted(() => ({ storage: vi.fn(), entitlements: vi.fn() }));
vi.mock("@/lib/orpc-client", () => ({
  client: { me: { storage: mocks.storage, entitlements: mocks.entitlements } },
  orpc: {},
}));

import { StorageSection } from "./storage-section";

beforeEach(() => {
  mocks.storage.mockReset();
  mocks.entitlements.mockReset();
  mocks.entitlements.mockResolvedValue(envelope(ENTITLEMENTS_FREE));
});
afterEach(cleanup);

const bar = () => screen.getByRole("img");
const noZeroUsage = () => expect(screen.queryByText("0 B")).toBeNull();

describe("StorageSection", () => {
  it("shows a loading state with no numbers while the first answer is in flight", () => {
    mocks.storage.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<StorageSection />);
    expect(container.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(screen.getByText("Checking your cloud space…")).toBeTruthy();
    noZeroUsage();
  });

  it("shows the server's exact numbers, the plan line and the in-progress label", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("610 MB")).toBeTruthy();
    expect(screen.getByText("130 MB")).toBeTruthy();
    expect(screen.getByText("260 MB")).toBeTruthy();
    expect(screen.getByText("Plan Free · 1 GB")).toBeTruthy();
    expect(screen.getByText("In progress (reserved by uploads)")).toBeTruthy();
    expect(screen.getByText("1 upload in progress")).toBeTruthy();
    expect(screen.getByText("Up to 1 GB per video.")).toBeTruthy();
    expect(bar().getAttribute("aria-label")).toBe("610 MB used and 130 MB reserved of 1 GB");
    expect(screen.queryByText("Not up to date")).toBeNull();
  });

  it("names the plan end date when the plan has one", async () => {
    mocks.storage.mockResolvedValue(envelope({ ...STORAGE.usage, capacityBytes: 25_000_000_000 }));
    mocks.entitlements.mockResolvedValue(envelope(ENTITLEMENTS_PRO_UNTIL));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText(/Plan Pro · 25 GB · until Jan 15, 2027/)).toBeTruthy();
  });

  it("promotes no cloud access to its own state instead of drawing a bar", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.betaUnavailable));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("Verify your email to use cloud")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("keeps the numbers and adds a notice while uploads are suspended", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.suspended));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("Uploads are paused right now")).toBeTruthy();
    expect(screen.getByText("610 MB")).toBeTruthy();
  });

  it("says cloud is not available on a 404, without numbers", async () => {
    mocks.storage.mockRejectedValue(orpcError(404));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("Cloud storage isn't available yet")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    noZeroUsage();
  });

  it("asks to sign in again on a 401, returning to the settings page", async () => {
    mocks.storage.mockRejectedValue(orpcError(401));
    renderWithProviders(<StorageSection />);
    const link = await screen.findByRole("link", { name: "Sign in again" });
    expect(link.getAttribute("href")).toBe("/auth/login?redirect=%2Fdashboard%2Fsettings");
    noZeroUsage();
  });

  it("shows an error with Retry on a 500, never zeros, and recovers on retry", async () => {
    mocks.storage.mockRejectedValue(orpcError(500));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("Couldn't load your cloud space")).toBeTruthy();
    noZeroUsage();
    expect(screen.queryByRole("img")).toBeNull();

    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("610 MB")).toBeTruthy();
  });

  it("treats an empty answer as a fault, not as zero usage", async () => {
    mocks.storage.mockResolvedValue({ data: null, error: { message: "bad" } });
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("Couldn't load your cloud space")).toBeTruthy();
    noZeroUsage();
  });

  it("keeps the last numbers, marked not up to date, when a refetch fails", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    const { queryClient } = renderWithProviders(<StorageSection />);
    expect(await screen.findByText("610 MB")).toBeTruthy();

    mocks.storage.mockRejectedValue(orpcError(500));
    await act(async () => {
      await queryClient.refetchQueries({ queryKey: accountKeys.storage() });
    });
    await waitFor(() => expect(screen.getByText("Not up to date")).toBeTruthy());
    expect(screen.getByText("610 MB")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Refresh" })).toBeTruthy();
  });

  it("warns when over quota: available is the server's 0 B and the bar is clamped", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.overQuota));
    renderWithProviders(<StorageSection />);
    expect(await screen.findByText("You're using more than your plan includes")).toBeTruthy();
    expect(screen.getByText("0 B")).toBeTruthy();
    expect(screen.getByText("1.4 GB")).toBeTruthy();
    const used = bar().querySelector<HTMLElement>("[data-segment='used']");
    expect(used?.style.width).toBe("100%");
    expect(bar().querySelector<HTMLElement>("[data-segment='reserved']")?.style.width).toBe("0%");
    expect(bar().getAttribute("data-over-quota")).toBe("true");
    expect(screen.queryByText("Almost full")).toBeNull();
  });

  it("shows a passive almost-full notice from 90%, and not before", async () => {
    mocks.storage.mockResolvedValue(envelope(STORAGE.almostFull));
    const { unmount } = renderWithProviders(<StorageSection />);
    expect(await screen.findByText("Almost full")).toBeTruthy();
    unmount();

    mocks.storage.mockResolvedValue(envelope(STORAGE.usage));
    renderWithProviders(<StorageSection />);
    await screen.findByText("610 MB");
    expect(screen.queryByText("Almost full")).toBeNull();
  });

  it("formats bytes with the locale's decimal separator in Spanish", async () => {
    mocks.storage.mockResolvedValue(envelope({ ...STORAGE.usage, usedBytes: 1_300_000 }));
    renderWithProviders(<StorageSection />, "es");
    expect(await screen.findByText("1,3 MB")).toBeTruthy();
  });
});
