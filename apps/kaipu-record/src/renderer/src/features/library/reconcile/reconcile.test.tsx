import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReconcileFinding,
  ReconcileFixResult,
  ReconcileProgress,
  ReconcileScanResult,
} from "@shared/types/library-reconcile";
import { ReconcileBanner } from "./reconcile-banner";
import { ReconcileDialogHost } from "./reconcile-dialog";
import {
  __resetReconcileForTests,
  checkOnce,
  getReconcileState,
  LISTED_SEEN_KEY,
} from "./reconcile-store";

const rename: ReconcileFinding = {
  kind: "stale-auto-title",
  fixable: true,
  path: "recording-2026-10-30-00-57-30.mp4",
  title: "Recording — 10/29/2026, 7:57:30 PM",
  newTitle: "Kaipu Recording 2026-10-29 at 19.57.30",
  newName: "Kaipu Recording 2026-10-29 at 19.57.30.mp4",
};
const conflict: ReconcileFinding = { kind: "stem-conflict", fixable: false, path: "Pair.png" };

const ok = (findings: ReconcileFinding[]): ReconcileScanResult => ({
  status: "ok",
  findings,
  fixableCount: findings.filter((f) => f.fixable).length,
  listedSignature: findings
    .filter((f) => !f.fixable)
    .map((f) => `${f.kind}:${f.path}`)
    .join("\n"),
});

let scanResult: ReconcileScanResult;
let progress: ((p: ReconcileProgress) => void) | null;
let finishFix: (result: ReconcileFixResult) => void;

beforeEach(() => {
  __resetReconcileForTests();
  localStorage.clear();
  scanResult = ok([rename, conflict]);
  progress = null;
  window.electronAPI.getVaultDirectory = vi.fn(async () => ({ path: "/vault", isCustom: false }));
  window.electronAPI.reconcileScan = vi.fn(async () => scanResult);
  window.electronAPI.reconcileCancel = vi.fn(async () => {});
  window.electronAPI.onReconcileProgress = (callback) => {
    progress = callback;
    return () => (progress = null);
  };
  window.electronAPI.reconcileFix = vi.fn(
    () => new Promise<ReconcileFixResult>((resolve) => (finishFix = resolve)),
  );
});
afterEach(() => __resetReconcileForTests());

function mount() {
  return render(
    <>
      <ReconcileBanner />
      <ReconcileDialogHost />
    </>,
  );
}

describe("reconcile banner", () => {
  it("offers Check and fix when the folder disagrees, and scans once per session and folder", async () => {
    mount();
    expect(
      await screen.findByText("1 file in your folder doesn't match Kaipu."),
    ).toBeInTheDocument();
    await act(() => checkOnce());
    expect(window.electronAPI.reconcileScan).toHaveBeenCalledTimes(1);
    window.electronAPI.getVaultDirectory = vi.fn(async () => ({ path: "/other", isCustom: true }));
    await act(() => checkOnce());
    expect(window.electronAPI.reconcileScan).toHaveBeenCalledTimes(2);
  });

  it("Not now hides it for the session", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Not now" }));
    expect(screen.queryByText(/doesn't match Kaipu/)).toBeNull();
  });

  it("with only listed findings, says so once and stays hidden until that set changes", async () => {
    scanResult = ok([conflict]);
    const first = mount();
    expect(await screen.findByText("1 file needs your attention.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(localStorage.getItem(LISTED_SEEN_KEY)).toBe("stem-conflict:Pair.png");
    first.unmount();
    __resetReconcileForTests();
    mount();
    await waitFor(() => expect(window.electronAPI.reconcileScan).toHaveBeenCalled());
    await act(async () => {});
    expect(screen.queryByText(/needs your attention/)).toBeNull();
  });

  it("shows nothing while a recording runs, and checks again on the next visit", async () => {
    scanResult = { status: "busy", activity: "recording" };
    mount();
    await waitFor(() => expect(getReconcileState().scan).not.toBeNull());
    expect(screen.queryByRole("status")).toBeNull();
    scanResult = ok([rename]);
    await act(() => checkOnce());
    expect(
      await screen.findByText("1 file in your folder doesn't match Kaipu."),
    ).toBeInTheDocument();
  });
});

describe("reconcile dialog", () => {
  it("lists current → new names, runs Fix all with progress, and reports the result", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    expect(
      await screen.findByText(
        "recording-2026-10-30-00-57-30.mp4 → Kaipu Recording 2026-10-29 at 19.57.30.mp4",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/Pair\.png: another file has the same name/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Fix all" }));
    act(() => progress!({ phase: "waiting", waitingFor: ["screenshot"] }));
    expect(screen.getByText("Waiting for a screenshot to finish…")).toBeInTheDocument();
    act(() => progress!({ phase: "fixing", done: 1, total: 3 }));
    expect(screen.getByText("Fixing files… 1 of 3")).toBeInTheDocument();
    // Not dismissible while files are being fixed.
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();

    scanResult = ok([conflict]);
    await act(async () =>
      finishFix({
        status: "done",
        report: {
          counts: {},
          fixed: 1,
          movedToOrphans: 0,
          kept: [],
          failed: [],
          remaining: [conflict],
          orphansDir: null,
          logPath: null,
        },
      }),
    );
    expect(
      screen.getByText("Done. 1 item fixed, 0 files moved to the orphans folder."),
    ).toBeInTheDocument();
    expect(window.electronAPI.reconcileScan).toHaveBeenCalledTimes(3);
  });

  it("a second check after a complete fix says everything matches", async () => {
    scanResult = ok([]);
    mount();
    await waitFor(() => expect(getReconcileState().scan).not.toBeNull());
    const { openReconcileDialog } = await import("./reconcile-store");
    act(() => openReconcileDialog());
    expect(await screen.findByText("Everything matches.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Fix all" })).toBeNull();
  });

  it("a refusal during a recording leaves the dialog open and dismissible", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fix all" }));
    await act(async () => finishFix({ status: "busy", activity: "recording" }));
    expect(
      screen.getByText("A recording is in progress. Check again when it ends."),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("closing while it waits cancels the wait", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    fireEvent.click(await screen.findByRole("button", { name: "Fix all" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(window.electronAPI.reconcileCancel).toHaveBeenCalled();
    await act(async () => finishFix({ status: "cancelled" }));
    expect(screen.getByRole("button", { name: "Fix all" })).toBeInTheDocument();
  });
});
