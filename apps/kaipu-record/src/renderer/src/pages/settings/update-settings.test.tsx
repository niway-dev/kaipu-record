import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UpdateSettings } from "./update-settings";
import { writeDevUpdateScenario } from "@renderer/features/updater/dev-update-simulator";
import type { UpdateStatus } from "@shared/types";

/** Drive the section through the real status push, as the main process would. */
function withStatus(status: UpdateStatus): void {
  window.electronAPI.getUpdateStatus = async () => status;
  window.electronAPI.getAppVersion = async () => "0.8.0";
}

describe("UpdateSettings", () => {
  beforeEach(() => {
    writeDevUpdateScenario("off");
    withStatus({ state: "idle" });
  });
  afterEach(() => writeDevUpdateScenario("off"));

  it("shows the installed version", async () => {
    render(<UpdateSettings />);
    expect(await screen.findByText(/0\.8\.0/)).toBeInTheDocument();
  });

  // The updater is inert in an unpackaged app; a live button would be a no-op.
  it("says updates are off in a development build", async () => {
    render(<UpdateSettings />);
    expect(await screen.findByText(/disabled in development/i)).toBeInTheDocument();
  });

  it("renders the forced state instead, once the simulator is on", async () => {
    writeDevUpdateScenario("downloading");
    render(<UpdateSettings />);
    expect(await screen.findByText(/Downloading 0\.9\.0/)).toBeInTheDocument();
    expect(screen.queryByText(/disabled in development/i)).toBeNull();
  });

  it("offers Restart and install once a build is ready", async () => {
    const install = vi.fn();
    window.electronAPI.installUpdate = install;
    writeDevUpdateScenario("ready");
    render(<UpdateSettings />);
    fireEvent.click(await screen.findByRole("button", { name: /restart and install/i }));
    expect(install).toHaveBeenCalledTimes(1);
  });

  it("offers Try again after a failed check, and reports the reason", async () => {
    const check = vi.fn(async (): Promise<UpdateStatus> => ({ state: "checking" }));
    window.electronAPI.checkForUpdates = check;
    writeDevUpdateScenario("error");
    render(<UpdateSettings />);
    expect(await screen.findByText(/ERR_INTERNET_DISCONNECTED/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /try again/i }));
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it("shows no button while a check or a download is running", async () => {
    writeDevUpdateScenario("checking");
    render(<UpdateSettings />);
    expect(await screen.findByText(/Checking/)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("pairs the version with a last-checked time once a check has completed", async () => {
    writeDevUpdateScenario("up-to-date");
    render(<UpdateSettings />);
    expect(await screen.findByText(/0\.8\.0 · checked just now/)).toBeInTheDocument();
  });

  // Never a stale timestamp: `ready` carries none, so the line must be version only.
  it("omits the last-checked time when the state carries none", async () => {
    writeDevUpdateScenario("ready");
    render(<UpdateSettings />);
    expect(await screen.findByText("0.8.0")).toBeInTheDocument();
    expect(screen.queryByText(/checked/i)).toBeNull();
  });
});
