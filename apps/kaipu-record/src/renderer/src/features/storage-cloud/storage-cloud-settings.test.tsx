import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { FREE_ENTITLEMENTS } from "@shared/entitlements";
import { StorageCloudSettings } from "./storage-cloud-settings";

function renderSection(uploadMode: "local-only" | "manual" = "local-only") {
  const onUploadModeChange = vi.fn();
  render(
    <MemoryRouter>
      <StorageCloudSettings uploadMode={uploadMode} onUploadModeChange={onUploadModeChange} />
    </MemoryRouter>,
  );
  return { onUploadModeChange };
}

describe("StorageCloudSettings", () => {
  it("signed out: cloud modes wait, sign-in offered, no capacity query", async () => {
    const getStorageUsage = vi.spyOn(window.electronAPI, "getStorageUsage");
    renderSection();
    expect(screen.getByRole("radio", { name: /local only/i })).toBeEnabled();
    expect(screen.getByRole("radio", { name: /manual upload/i })).toBeDisabled();
    expect(await screen.findByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(getStorageUsage).not.toHaveBeenCalled();
    getStorageUsage.mockRestore();
  });

  it("signed in: enables cloud modes and renders the queried capacity", async () => {
    const status = vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
      kind: "signed-in",
      userId: "u1",
      email: "me@example.com",
      name: "Me",
      entitlements: FREE_ENTITLEMENTS,
    });
    const usage = vi.spyOn(window.electronAPI, "getStorageUsage").mockResolvedValue({
      kind: "ok",
      fetchedAt: Date.now(),
      usage: {
        capacityBytes: 1_000_000_000,
        usedBytes: 100_000_000,
        reservedBytes: 0,
        availableBytes: 900_000_000,
        pendingUploads: 0,
        uploadsEnabled: true,
        cloudUploads: true,
      },
    });
    const { onUploadModeChange } = renderSection();

    expect(
      await screen.findByRole("img", { name: "100 MB used and 0 B reserved of 1 GB" }),
    ).toBeInTheDocument();
    const manual = screen.getByRole("radio", { name: /manual upload/i });
    await waitFor(() => expect(manual).toBeEnabled());
    fireEvent.click(manual);
    expect(onUploadModeChange).toHaveBeenCalledWith("manual");
    status.mockRestore();
    usage.mockRestore();
  });
});
