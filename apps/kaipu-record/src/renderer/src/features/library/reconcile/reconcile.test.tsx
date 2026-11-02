import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ReconcileFinding,
  ReconcileFixResult,
  ReconcileFindingKind,
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
  rescan,
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
let activeWorkspace: string | null;
let progress: ((p: ReconcileProgress) => void) | null;
let finishFix: (result: ReconcileFixResult) => void;

beforeEach(() => {
  __resetReconcileForTests();
  localStorage.clear();
  scanResult = ok([rename, conflict]);
  progress = null;
  activeWorkspace = "ws-a";
  window.electronAPI.workspaces = {
    ...window.electronAPI.workspaces,
    activeId: () => activeWorkspace,
  };
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
  it("offers Check and fix when the folder disagrees, and scans once per session and workspace", async () => {
    mount();
    expect(
      await screen.findByText("1 file in your folder doesn't match Kaipu."),
    ).toBeInTheDocument();
    await act(() => checkOnce());
    expect(window.electronAPI.reconcileScan).toHaveBeenCalledTimes(1);
    activeWorkspace = "ws-b";
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
  it("groups findings by what happens to them, runs Fix all with progress, and reports the result", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    expect(await screen.findByText("Nothing is deleted.")).toBeInTheDocument();
    const groups = document.querySelectorAll("section[data-group]");
    expect([...groups].map((g) => g.getAttribute("data-group"))).toEqual(["rename", "listed"]);
    // The first group opens, so the most common change is visible without a click.
    expect(groups[0]!.hasAttribute("data-open")).toBe(true);
    expect(groups[1]!.hasAttribute("data-open")).toBe(false);
    const renames = groups[0] as HTMLElement;
    expect(within(renames).getByText("Names that don't match their title")).toBeInTheDocument();
    expect(within(renames).getByText("1 file")).toBeInTheDocument();
    const renameRow = within(renames).getAllByRole("listitem")[0]!;
    expect(within(renameRow).getByText("recording-2026-10-30-00-57-30")).toBeInTheDocument();
    expect(within(renameRow).getByLabelText("renamed to")).toBeInTheDocument();
    expect(
      within(renameRow).getByText("Kaipu Recording 2026-10-29 at 19.57.30"),
    ).toBeInTheDocument();
    // One group open at a time: opening "Left as they are" closes the renames.
    fireEvent.click(within(groups[1] as HTMLElement).getByRole("button", { expanded: false }));
    expect(groups[0]!.hasAttribute("data-open")).toBe(false);
    const listed = groups[1] as HTMLElement;
    expect(within(listed).getByText("Left as they are")).toBeInTheDocument();
    expect(within(listed).getByText("Pair.png")).toBeInTheDocument();
    expect(within(listed).getByText(/Another file has the same name/)).toBeInTheDocument();
    expect(screen.getByText("1 change · 1 left as it is")).toBeInTheDocument();

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

describe("finding groups", () => {
  it("every finding kind lands in a group, and each row says what happens to it", async () => {
    const kinds: ReconcileFindingKind[] = [
      "stale-auto-title",
      "untitled-legacy",
      "name-mismatch",
      "missing-sidecar",
      "missing-media",
      "orphan-companion",
      "stem-conflict",
      "shared-companion",
      "duplicate-identity",
      "unreadable-record",
      "not-recognized",
      "unreadable-orphan-run",
    ];
    scanResult = ok(
      kinds.map((kind, i) => ({
        kind,
        fixable: i < 6,
        path: `item-${i}.mp4`,
        newName: `Item ${i}.mp4`,
      })),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    await screen.findByText("Left as they are");
    const groups = [...document.querySelectorAll("section[data-group]")];
    expect(groups.map((g) => g.getAttribute("data-group"))).toEqual([
      "rename",
      "adopt",
      "gone",
      "listed",
    ]);
    // Only the open group renders its rows: open each one in turn.
    const rowText = (g: Element) => {
      if (!g.hasAttribute("data-open")) {
        fireEvent.click(within(g as HTMLElement).getByRole("button", { expanded: false }));
      }
      return [...g.querySelectorAll("li")].map((li) => li.textContent);
    };
    expect(rowText(groups[0]!)).toEqual(["item-0Item 0", "item-1Item 1", "item-2Item 2"]);
    expect(rowText(groups[1]!)).toEqual(["item-3Added to the library"]);
    expect(rowText(groups[2]!)).toEqual([
      "item-4.mp4No file. Its record moves to the orphans folder",
      "item-5.mp4Belongs to no item. Moves to the orphans folder",
    ]);
    expect(rowText(groups[3]!).every((text) => (text ?? "").length > "item-0.mp4".length)).toBe(
      true,
    );
  });
});

describe("intro", () => {
  it("only describes a Fix all plan above an actual list", async () => {
    scanResult = ok([]);
    mount();
    await waitFor(() => expect(getReconcileState().scan).not.toBeNull());
    const { openReconcileDialog } = await import("./reconcile-store");
    act(() => openReconcileDialog());
    expect(await screen.findByText("Everything matches.")).toBeInTheDocument();
    expect(screen.queryByText(/Kaipu compared this folder/)).toBeNull();
    expect(screen.queryByText("Nothing is deleted.")).toBeNull();
  });

  it("with only listed findings, does not promise a Fix all", async () => {
    scanResult = ok([conflict]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Review" }));
    expect(await screen.findByText(/Nothing here can be fixed automatically/)).toBeInTheDocument();
    expect(screen.queryByText(/what Fix all would do/)).toBeNull();
  });
});

describe("choosing what to fix", () => {
  const adopt: ReconcileFinding = {
    kind: "missing-sidecar",
    fixable: true,
    path: "Loose.png",
    newTitle: "Loose",
  };
  const rename2: ReconcileFinding = {
    ...rename,
    path: "recording-2026-10-30-01-00-00.mp4",
    newName: "Kaipu Recording 2026-10-29 at 20.00.00.mp4",
  };

  it("everything starts ticked; unticking a file or a group changes the count and the button", async () => {
    scanResult = ok([rename, rename2, adopt, conflict]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    const renames = (await screen.findByText("Names that don't match their title")).closest(
      "section",
    )!;
    expect(screen.getByText("3 changes · 1 left as it is")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix all" })).toBeEnabled();

    fireEvent.click(
      within(renames).getByRole("checkbox", {
        name: "Rename recording-2026-10-30-00-57-30 to Kaipu Recording 2026-10-29 at 19.57.30",
      }),
    );
    const groupBox = within(renames).getByRole("checkbox", {
      name: "Fix: Names that don't match their title",
    }) as HTMLInputElement;
    expect(groupBox.indeterminate).toBe(true);
    expect(within(renames).getByText("1 of 2 files")).toBeInTheDocument();
    expect(screen.getByText("2 of 3 selected · 2 files left as they are")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Fix 2 files" })).toBeInTheDocument();

    // The group box clears the whole group; the listed group has none.
    fireEvent.click(groupBox);
    fireEvent.click(screen.getByRole("checkbox", { name: "Fix: Files Kaipu doesn't know yet" }));
    expect(screen.getByRole("button", { name: "Fix 0 files" })).toBeDisabled();
    const listed = screen.getByText("Left as they are").closest("section")!;
    expect(within(listed).queryByRole("checkbox")).toBeNull();

    // Ticking the group again ticks every file in it.
    fireEvent.click(groupBox);
    fireEvent.click(screen.getByRole("button", { name: "Fix 2 files" }));
    expect(window.electronAPI.reconcileFix).toHaveBeenCalledWith(["Loose.png"]);
  });

  it("every file in a long group has its own checkbox, so none is fixed out of sight", async () => {
    scanResult = ok(
      Array.from({ length: 250 }, (_, i) => ({ ...rename, path: `recording-${i}.mp4` })),
    );
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    const renames = (await screen.findByText("Names that don't match their title")).closest(
      "section",
    )!;
    expect(within(renames).getAllByRole("listitem")).toHaveLength(250);
    fireEvent.click(within(renames).getByRole("checkbox", { name: /^Rename recording-249 to / }));
    fireEvent.click(screen.getByRole("button", { name: "Fix 249 files" }));
    expect(window.electronAPI.reconcileFix).toHaveBeenCalledWith(["recording-249.mp4"]);
  });

  it("a click anywhere on a selectable row toggles it, not only on the 16 px box", async () => {
    scanResult = ok([rename, { ...rename, path: "other.mp4" }]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    const renames = (await screen.findByText("Names that don't match their title")).closest(
      "section",
    )!;
    const [first] = within(renames).getAllByRole("listitem");
    const box = within(first!).getByRole("checkbox");
    expect(box).toBeChecked();
    // A near miss lands on the row's padding or its text, not on the input.
    fireEvent.click(first!);
    expect(box).not.toBeChecked();
    fireEvent.click(within(first!).getByLabelText("renamed to"));
    expect(box).toBeChecked();
    // Selecting a name to copy it ends in a click on the row: that is not a toggle.
    const selection = vi.spyOn(window, "getSelection").mockReturnValue({
      toString: () => "Kaipu Recording",
    } as Selection);
    fireEvent.click(within(first!).getByLabelText("renamed to"));
    expect(box).toBeChecked();
    selection.mockRestore();
    // The box itself still toggles once, not twice.
    fireEvent.click(box);
    expect(box).not.toBeChecked();
  });

  it("a new scan forgets what was unticked", async () => {
    scanResult = ok([rename, adopt]);
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Check and fix" }));
    fireEvent.click(
      await screen.findByRole("checkbox", { name: "Fix: Names that don't match their title" }),
    );
    expect(getReconcileState().skipped.size).toBe(1);
    await act(() => rescan());
    expect(getReconcileState().skipped.size).toBe(0);
    expect(await screen.findByRole("button", { name: "Fix all" })).toBeInTheDocument();
  });
});
