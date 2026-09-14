import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import type { StorageUsage } from "@shared/types/cloud-storage";
import { CapacityCard, type CapacityCardProps } from "./capacity-card";
import type { CapacityView } from "./capacity-view";

const USAGE: StorageUsage = {
  capacityBytes: 1_000_000_000,
  usedBytes: 610_000_000,
  reservedBytes: 130_000_000,
  availableBytes: 260_000_000,
  pendingUploads: 1,
  uploadsEnabled: true,
  cloudUploads: true,
};
const SIGNED_IN: CapacityCardProps["status"] = {
  kind: "signed-in",
  userId: "u1",
  email: "cristian@example.com",
  name: "C",
  entitlements: FREE_ENTITLEMENTS,
};
const NOW = 1_800_000_000_000;

function renderCard(view: CapacityView, overrides: Partial<CapacityCardProps> = {}) {
  const onRefresh = vi.fn();
  render(
    <MemoryRouter>
      <CapacityCard
        status={SIGNED_IN}
        view={view}
        refreshing={false}
        onRefresh={onRefresh}
        onSignOut={() => {}}
        now={NOW}
        {...overrides}
      />
    </MemoryRouter>,
  );
  return { onRefresh };
}

describe("CapacityCard", () => {
  it("shows the account, plan and capacity", () => {
    renderCard({ kind: "usage", usage: USAGE, staleSince: null, suspended: false });
    expect(screen.getByText("cristian@example.com")).toBeInTheDocument();
    expect(screen.getByText("Plan Free · 1 GB")).toBeInTheDocument();
  });

  it("draws used, reserved and available with an accessible summary", () => {
    renderCard({ kind: "usage", usage: USAGE, staleSince: null, suspended: false });
    expect(
      screen.getByRole("img", { name: "610 MB used and 130 MB reserved of 1 GB" }),
    ).toBeInTheDocument();
    expect(screen.getByText("260 MB")).toBeInTheDocument();
    expect(screen.getByText("Up to 1 GB per video.")).toBeInTheDocument();
  });

  it("shows a skeleton and no figures while loading", () => {
    renderCard({ kind: "loading" });
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/MB/)).not.toBeInTheDocument();
    expect(screen.getByText(/checking your cloud space/i)).toBeInTheDocument();
  });

  it("marks stale figures with their age and offers a refresh", () => {
    const { onRefresh } = renderCard({
      kind: "usage",
      usage: USAGE,
      staleSince: NOW - 3 * 60 * 60 * 1000,
      suspended: false,
    });
    expect(screen.getByText("Not up to date")).toBeInTheDocument();
    expect(screen.getByText(/last checked 3 h ago/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("shows a recoverable error with retry — never 0 GB", () => {
    const { onRefresh } = renderCard({ kind: "error" });
    expect(screen.getByText(/couldn't load your cloud space/i)).toBeInTheDocument();
    expect(screen.queryByText(/0 B|0 GB/)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRefresh).toHaveBeenCalledOnce();
  });

  it("asks to sign in again when the session expired", () => {
    renderCard({ kind: "session-expired" });
    expect(screen.getByText(/your session expired/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in again/i })).toBeInTheDocument();
  });

  it("says cloud storage is not offered yet on a server without the endpoint, without retry", () => {
    renderCard({ kind: "not-available" });
    expect(screen.getByText(/cloud storage isn't available yet/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("asks to verify the email when the account has no cloud access", () => {
    renderCard({ kind: "beta-unavailable" });
    expect(screen.getByText(/verify your email to use cloud/i)).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("keeps the figures and adds a notice when uploads are suspended", () => {
    renderCard({ kind: "usage", usage: USAGE, staleSince: null, suspended: true });
    expect(screen.getByRole("img")).toBeInTheDocument();
    expect(screen.getByText(/uploads are paused/i)).toBeInTheDocument();
  });

  it("uses the last known email for an unverified session", () => {
    renderCard(
      { kind: "loading" },
      {
        status: {
          kind: "unknown",
          lastKnownEmail: "old@example.com",
          entitlements: FREE_ENTITLEMENTS,
        },
      },
    );
    expect(screen.getByText("old@example.com")).toBeInTheDocument();
    expect(screen.getByText(/couldn't verify your session/i)).toBeInTheDocument();
  });
});
