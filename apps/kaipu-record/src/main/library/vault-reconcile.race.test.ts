import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

// Fifth review of NIW2-561: Finder or a sync tool creates a file under the name Fix all is
// renaming a recording to, after the plan and before the commit. A real disk cannot be timed
// that precisely, so the file is written right before the call that targets the new name.
const arrival = vi.hoisted(() => ({ path: "", content: "" }));

vi.mock("node:fs/promises", async (importActual) => {
  const actual = await importActual<typeof import("node:fs/promises")>();
  const arrive = async (to: string) => {
    if (arrival.path && to === arrival.path) {
      arrival.path = "";
      await actual.writeFile(to, arrival.content);
    }
  };
  return {
    ...actual,
    link: async (from: string, to: string) => {
      await arrive(to);
      return actual.link(from, to);
    },
    rename: async (from: string, to: string) => {
      await arrive(to);
      return actual.rename(from, to);
    },
  };
});

import { fixVault } from "./vault-reconcile";
import { makeVault, sidecar } from "./vault-reconcile.test-helpers";

let directory = "";
afterEach(async () => {
  arrival.path = "";
  await rm(directory, { recursive: true, force: true });
});

it("Fix all never replaces a recording that arrives under the new name before the commit", async () => {
  directory = await makeVault({
    "Old.mp4": "original",
    ".kaipu/Old.json": sidecar({ assetId: "old", title: "Renamed" }),
  });
  arrival.path = join(directory, "Renamed.mp4");
  arrival.content = "other recording";
  const report = await fixVault(directory, { cloud: "unknown" });

  expect(await readFile(join(directory, "Renamed.mp4"), "utf-8")).toBe("other recording");
  expect(await readFile(join(directory, "Old.mp4"), "utf-8")).toBe("original");
  expect((await readdir(directory)).filter((n) => n.endsWith(".mp4")).sort()).toEqual([
    "Old.mp4",
    "Renamed.mp4",
  ]);
  // Kept under its old name, with the title saved; the arrival is the user's to sort out.
  expect(report.kept).toEqual([{ path: "Old.mp4", reason: "taken" }]);
});
