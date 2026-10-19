import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";
import {
  MOCK_ACCOUNT_PASSWORD,
  createMockAccountDeletionClient,
  type AccountDeletionClient,
} from "@/lib/account-deletion";
import { USER_VERIFIED } from "@/test/fixtures/account";
import { DangerZone } from "./danger-zone";

afterEach(cleanup);

// Midday UTC, so the date reads the same in the app's fixed time zone (America/Lima).
const NOW = Date.parse("2026-10-11T12:00:00Z");

function setup(
  overrides: Partial<{
    client: AccountDeletionClient;
    enabled: boolean;
    hasPassword: boolean;
  }> = {},
) {
  const client = overrides.client ?? createMockAccountDeletionClient({ now: () => NOW });
  renderWithProviders(
    <DangerZone
      email={USER_VERIFIED.email}
      hasPassword={overrides.hasPassword ?? true}
      enabled={overrides.enabled ?? true}
      client={client}
    />,
  );
  return client;
}

async function openDialog() {
  fireEvent.click(await screen.findByRole("button", { name: "Delete account" }));
  return screen.findByRole("dialog");
}

const confirmButton = () => screen.getByRole("button", { name: "Delete my account" });

describe("DangerZone", () => {
  it("renders a disabled Delete account button tagged Coming soon while the flag is off, and never asks the client", () => {
    const client = createMockAccountDeletionClient();
    const spy = vi.spyOn(client, "getDeletionStatus");
    setup({ client, enabled: false });
    const button = screen.getByRole("button", { name: "Delete account" }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(screen.getByText("Coming soon")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it("closes the dialog on Escape without scheduling anything", async () => {
    const client = createMockAccountDeletionClient({ now: () => NOW });
    const request = vi.spyOn(client, "requestDeletion");
    setup({ client });
    const dialog = await openDialog();
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });

  it("lists what is deleted, that local files stay, and the mock's counts", async () => {
    setup();
    const dialog = await openDialog();
    expect(dialog.textContent).toContain("your profile");
    expect(dialog.textContent).toContain("all your cloud recordings and screenshots");
    expect(dialog.textContent).toContain("your sign-in methods");
    expect(dialog.textContent).toContain("Files saved on your devices are not deleted.");
    await waitFor(() =>
      expect(dialog.textContent).toContain("12 cloud files and 3 uploads in progress"),
    );
  });

  it("keeps the confirm button disabled until the email matches exactly and a password is typed", async () => {
    setup();
    await openDialog();
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.co" },
    });
    fireEvent.change(screen.getByLabelText("Your password"), {
      target: { value: MOCK_ACCOUNT_PASSWORD },
    });
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.com" },
    });
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);

    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "" } });
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it("calls requestDeletion, then shows the scheduled banner with Restore", async () => {
    const client = createMockAccountDeletionClient({ now: () => NOW });
    const request = vi.spyOn(client, "requestDeletion");
    setup({ client });
    await openDialog();
    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Your password"), {
      target: { value: MOCK_ACCOUNT_PASSWORD },
    });
    fireEvent.click(confirmButton());

    expect(await screen.findByText("Deletion scheduled for October 18, 2026")).toBeTruthy();
    expect(request).toHaveBeenCalledWith({ password: MOCK_ACCOUNT_PASSWORD });
    expect(screen.getByRole("button", { name: "Restore" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete account" })).toBeNull();
  });

  it("restores the account from the banner", async () => {
    setup();
    await openDialog();
    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Your password"), {
      target: { value: MOCK_ACCOUNT_PASSWORD },
    });
    fireEvent.click(confirmButton());
    fireEvent.click(await screen.findByRole("button", { name: "Restore" }));

    expect(await screen.findByText("Your account was restored")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Delete account" })).toBeTruthy();
  });

  it("shows the banner straight away for an account already scheduled", async () => {
    const client = createMockAccountDeletionClient({
      initial: {
        status: "scheduled",
        requestedAt: "2026-10-10T12:00:00.000Z",
        scheduledAt: "2026-10-17T12:00:00.000Z",
      },
    });
    setup({ client });
    expect(await screen.findByText("Deletion scheduled for October 17, 2026")).toBeTruthy();
  });

  it("keeps the dialog open with a field error for a wrong password", async () => {
    setup();
    await openDialog();
    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "nope" } });
    fireEvent.click(confirmButton());

    expect(await screen.findByText("Wrong password.")).toBeTruthy();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByText(/Deletion scheduled/)).toBeNull();
  });

  it("asks to sign in again when the session is not fresh", async () => {
    const client: AccountDeletionClient = {
      ...createMockAccountDeletionClient(),
      requestDeletion: async () => ({ ok: false, reason: "session-not-fresh" }),
    };
    setup({ client });
    await openDialog();
    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByLabelText("Your password"), { target: { value: "x" } });
    fireEvent.click(confirmButton());

    const link = await screen.findByRole("link", { name: "Sign in again" });
    expect(link.getAttribute("href")).toBe("/auth/login?redirect=%2Fdashboard%2Fsettings");
  });

  it("asks only for the email on an account without a password, and sends no password", async () => {
    const client = createMockAccountDeletionClient({ now: () => NOW });
    const request = vi.spyOn(client, "requestDeletion");
    setup({ client, hasPassword: false });
    await openDialog();
    expect(screen.queryByLabelText("Your password")).toBeNull();
    fireEvent.change(screen.getByLabelText(/Type ada@example.com to confirm/), {
      target: { value: "ada@example.com" },
    });
    fireEvent.click(confirmButton());
    await screen.findByText(/Deletion scheduled/);
    expect(request).toHaveBeenCalledWith({ password: undefined });
  });

  it("still offers deletion when the status cannot be read", async () => {
    const client: AccountDeletionClient = {
      ...createMockAccountDeletionClient(),
      getDeletionStatus: async () => {
        throw new Error("offline");
      },
    };
    setup({ client });
    expect(await screen.findByRole("button", { name: "Delete account" })).toBeTruthy();
  });
});
