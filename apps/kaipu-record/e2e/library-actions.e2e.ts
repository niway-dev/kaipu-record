import { test, expect } from "@playwright/test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { launchApp, dismissOnboarding, RECORDING_ID } from "./helpers/launch";

// Path to the seeded recording's on-disk metadata sidecar. rename() merges { title } into
// this file, so it is the deterministic boundary for the rename assertion (vs. the optimistic
// in-memory list update, which can pass even if persistence failed).
function sidecarPath(vaultDir: string): string {
  return path.join(vaultDir, ".kaipu", `${RECORDING_ID}.json`);
}

test("rename persists the new title to the vault sidecar", async () => {
  const { page, vaultDir, teardown } = await launchApp();
  try {
    // Onboarding's full-window modal intercepts pointer events, so it must go before any click.
    await dismissOnboarding(page);
    await page.evaluate((id) => {
      location.hash = `#/library/${id}`;
    }, RECORDING_ID);

    // The seeded title proves the detail page rendered before we start editing.
    await expect(page.getByRole("heading", { name: "E2E Sample" })).toBeVisible();

    // RecordingTitle exposes an inline pencil button (title="Rename") that swaps the heading
    // for an autoFocus <input>. Commit with Enter (the component's onKeyDown handler).
    await page.getByRole("button", { name: "Rename" }).click();
    const input = page.locator("input:focus");
    await input.fill("Renamed Clip");
    await input.press("Enter");

    // DOM reflects the new title (optimistic local update).
    await expect(page.getByRole("heading", { name: "Renamed Clip" })).toBeVisible();

    // Deterministic boundary: the sidecar on disk actually carries the new title. Poll because
    // the renameLocalRecording IPC writes the file asynchronously after the Enter keypress.
    await expect
      .poll(async () => {
        const raw = await readFile(sidecarPath(vaultDir), "utf-8");
        return JSON.parse(raw).title as string;
      })
      .toBe("Renamed Clip");
  } finally {
    await teardown();
  }
});

test("delete removes the vault file and navigates back to the list", async () => {
  const { page, vaultDir, teardown } = await launchApp();
  try {
    await dismissOnboarding(page);
    await page.evaluate((id) => {
      location.hash = `#/library/${id}`;
    }, RECORDING_ID);

    // The action-bar Delete button opens the in-renderer confirm dialog (no native dialog).
    await page.getByRole("button", { name: "Delete" }).click();

    // Confirm inside the alertdialog — scoping to it disambiguates from the action-bar Delete,
    // which is still mounted while the dialog is open (both are named "Delete").
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

    // doDelete() navigates back to the list after removing the file.
    await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/#\/library$/);

    // Deterministic boundary: the real .mp4 is gone from the vault (access rejects on ENOENT).
    await expect
      .poll(() =>
        access(path.join(vaultDir, `${RECORDING_ID}.mp4`)).then(
          () => true,
          () => false,
        ),
      )
      .toBe(false);
  } finally {
    await teardown();
  }
});

test("reveal asks the OS shell to show the recording's file", async () => {
  const { app, page, vaultDir, teardown } = await launchApp();
  try {
    // shell.showItemInFolder is a native OS effect with no renderer/vault signal, so stub it in
    // MAIN before clicking. The handler reads shell.showItemInFolder off the module at call time
    // (index.ts), so a pre-click property patch takes effect when Reveal fires.
    await app.evaluate(({ shell }) => {
      (globalThis as unknown as { __revealed: string[] }).__revealed = [];
      shell.showItemInFolder = (p: string) => {
        (globalThis as unknown as { __revealed: string[] }).__revealed.push(p);
      };
    });

    await dismissOnboarding(page);
    await page.evaluate((id) => {
      location.hash = `#/library/${id}`;
    }, RECORDING_ID);

    await page.getByRole("button", { name: "Reveal" }).click();

    // Assert at the IPC boundary: the handler resolved the seeded file's path and passed it to
    // the shell stub. Poll because reveal() → revealLocalRecording is an async round-trip.
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as unknown as { __revealed: string[] }).__revealed),
      )
      .toEqual([path.join(vaultDir, `${RECORDING_ID}.mp4`)]);
  } finally {
    await teardown();
  }
});
