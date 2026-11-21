import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AdminModeState } from "@shared/admin-mode";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { AdminModeSettings } from "./admin-mode-settings";

const BASE: AdminModeState = {
  isAdmin: true,
  adminModeSetting: true,
  effective: true,
  restartPending: false,
};

function stub(state: AdminModeState) {
  const api = window.electronAPI;
  const listeners = new Set<(next: AdminModeState) => void>();
  const unsubscribe = vi.fn();
  api.getAdminModeState = vi.fn().mockResolvedValue(state);
  api.setAdminMode = vi.fn().mockResolvedValue({ ...state, adminModeSetting: false });
  api.relaunchApp = vi.fn().mockResolvedValue(undefined);
  api.onAdminModeChanged = vi.fn((listener: (next: AdminModeState) => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      unsubscribe();
    };
  });
  return { api, listeners, unsubscribe };
}

afterEach(() => {
  cleanup();
  for (const toast of getToasts()) dismissToast(toast.id);
});

describe("AdminModeSettings", () => {
  it("renders nothing for an account that is not an admin and is not in Admin mode", async () => {
    const { api } = stub({
      isAdmin: false,
      adminModeSetting: false,
      effective: false,
      restartPending: false,
    });
    const { container } = render(<AdminModeSettings />);
    await waitFor(() => expect(api.getAdminModeState).toHaveBeenCalled());
    await act(async () => {});
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the switch for an admin account, on when the preference is on", async () => {
    stub(BASE);
    render(<AdminModeSettings />);
    const toggle = await screen.findByRole("switch", { name: "Admin mode" });
    expect(toggle).toBeChecked();
    expect(
      screen.getByText("Every release flag is on. Turn it off to see the app as users do."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Restart to apply")).toBeNull();
  });

  it("calls setAdminMode with the new value when the switch is toggled", async () => {
    const { api } = stub(BASE);
    render(<AdminModeSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Admin mode" }));
    expect(api.setAdminMode).toHaveBeenCalledWith(false);
  });

  it("shows Restart to apply and a Restart now button while a restart is pending", async () => {
    stub({ ...BASE, adminModeSetting: false, restartPending: true });
    render(<AdminModeSettings />);
    expect(await screen.findByText("Restart to apply")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Restart now" })).toBeInTheDocument();
  });

  it("Restart now calls relaunchApp", async () => {
    const { api } = stub({ ...BASE, restartPending: true });
    render(<AdminModeSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Restart now" }));
    expect(api.relaunchApp).toHaveBeenCalledTimes(1);
  });

  it("keeps the row after sign-out while Admin mode is still effective (AC12)", async () => {
    stub({ isAdmin: false, adminModeSetting: true, effective: true, restartPending: true });
    render(<AdminModeSettings />);
    expect(await screen.findByRole("switch", { name: "Admin mode" })).toBeInTheDocument();
    expect(screen.getByText("Restart to apply")).toBeInTheDocument();
  });

  it("follows a broadcast from main and unsubscribes on unmount", async () => {
    const { listeners, unsubscribe } = stub({
      isAdmin: false,
      adminModeSetting: false,
      effective: false,
      restartPending: false,
    });
    const view = render(<AdminModeSettings />);
    await waitFor(() => expect(listeners.size).toBe(1));
    act(() => listeners.forEach((listener) => listener(BASE)));
    expect(await screen.findByRole("switch", { name: "Admin mode" })).toBeInTheDocument();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("tells the user when the switch could not change the mode", async () => {
    const { api } = stub(BASE);
    api.setAdminMode = vi.fn().mockRejectedValue(new Error("ipc down"));
    render(<AdminModeSettings />);
    fireEvent.click(await screen.findByRole("switch", { name: "Admin mode" }));
    await waitFor(() =>
      expect(getToasts().map((toast) => toast.message)).toEqual([
        "Admin mode did not change. Try again.",
      ]),
    );
  });

  it("tells the user when Restart now could not restart the app", async () => {
    const { api } = stub({ ...BASE, restartPending: true });
    api.relaunchApp = vi.fn().mockRejectedValue(new Error("ipc down"));
    render(<AdminModeSettings />);
    fireEvent.click(await screen.findByRole("button", { name: "Restart now" }));
    await waitFor(() =>
      expect(getToasts().map((toast) => toast.message)).toEqual([
        "The app could not restart. Quit and open it again.",
      ]),
    );
  });
});
