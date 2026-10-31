import { describe, expect, it } from "vitest";
import { VAULT_MAINTENANCE_MARKER } from "@shared/types/library-storage";
import {
  MaintenanceAlreadyRunningError,
  MaintenanceCancelledError,
  MaintenanceError,
  VaultActivity,
  VaultBusyError,
} from "./vault-activity";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("VaultActivity — the admission contract", () => {
  it("enters at once when idle, then refuses every admission until exit", async () => {
    const activity = new VaultActivity();
    const exit = await activity.enterMaintenance();
    expect(activity.inMaintenance).toBe(true);
    expect(() => activity.admit("library")).toThrow(MaintenanceError);
    expect(() => activity.admit("recording")).toThrow(VAULT_MAINTENANCE_MARKER);
    await expect(activity.run("library", async () => 1)).rejects.toBeInstanceOf(MaintenanceError);
    exit();
    expect(activity.inMaintenance).toBe(false);
    expect(await activity.run("library", async () => 1)).toBe(1);
  });

  it("waits for short operations in flight, and sets the flag in the step their last lease ends", async () => {
    const activity = new VaultActivity();
    const a = activity.admit("library");
    const b = activity.admit("screenshot");
    const waits: string[][] = [];
    let entered = false;
    const entering = activity
      .enterMaintenance({ onWaiting: (kinds) => waits.push(kinds) })
      .then((exit) => {
        entered = true;
        return exit;
      });
    await flush();
    expect(entered).toBe(false);
    expect(waits[0]).toEqual(["library", "screenshot"]);
    a.release();
    a.release(); // idempotent: never counts twice
    await flush();
    expect(entered).toBe(false);
    b.release();
    // Same synchronous step: nothing can be admitted between the last release and the flag.
    expect(activity.inMaintenance).toBe(true);
    expect(() => activity.admit("library")).toThrow(MaintenanceError);
    (await entering)();
  });

  it("does not start during a recording or an export", async () => {
    for (const kind of ["recording", "export"] as const) {
      const activity = new VaultActivity();
      const lease = activity.admit(kind);
      const error = await activity.enterMaintenance().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(VaultBusyError);
      expect((error as VaultBusyError).activity).toBe(kind);
      expect(activity.inMaintenance).toBe(false);
      lease.release();
    }
  });

  it("gives up waiting when a recording starts meanwhile", async () => {
    const activity = new VaultActivity();
    const short = activity.admit("library");
    const entering = activity.enterMaintenance();
    const recording = activity.admit("recording");
    await expect(entering).rejects.toBeInstanceOf(VaultBusyError);
    short.release();
    expect(activity.inMaintenance).toBe(false);
    recording.release();
  });

  it("the wait is cancellable and leaves no flag behind", async () => {
    const activity = new VaultActivity();
    const lease = activity.admit("library");
    const controller = new AbortController();
    const entering = activity.enterMaintenance({ signal: controller.signal });
    controller.abort();
    await expect(entering).rejects.toBeInstanceOf(MaintenanceCancelledError);
    lease.release();
    expect(activity.inMaintenance).toBe(false);
    // And a new run may start afterwards.
    (await activity.enterMaintenance())();
  });

  it("allows one run at a time", async () => {
    const activity = new VaultActivity();
    const exit = await activity.enterMaintenance();
    await expect(activity.enterMaintenance()).rejects.toBeInstanceOf(
      MaintenanceAlreadyRunningError,
    );
    exit();
  });

  it("exit is idempotent and tells listeners once that maintenance ended", async () => {
    const activity = new VaultActivity();
    let ended = 0;
    activity.onMaintenanceEnded(() => ended++);
    const exit = await activity.enterMaintenance();
    exit();
    exit();
    expect(ended).toBe(1);
  });

  it("run() releases its lease when the work throws", async () => {
    const activity = new VaultActivity();
    await expect(
      activity.run("library", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    expect(activity.active()).toEqual([]);
  });
});
