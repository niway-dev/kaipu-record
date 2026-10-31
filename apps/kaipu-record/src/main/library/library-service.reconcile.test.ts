import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ReconcileProgress } from "@shared/types/library-reconcile";
import { CatalogCache } from "../cloud/catalog-cache";
import { LibraryService } from "./library-service";
import { LibraryVault } from "./library-vault";
import { VaultActivity } from "./vault-activity";

describe("LibraryService — Check and fix files", () => {
  let vaultDir: string;
  let userData: string;
  let activity: VaultActivity;
  let service: LibraryService;
  let account: { userId: string; token: string } | null;
  let cache: CatalogCache;

  beforeEach(async () => {
    vaultDir = await mkdtemp(join(tmpdir(), "kaipu-svc-rec-"));
    userData = await mkdtemp(join(tmpdir(), "kaipu-svc-rec-data-"));
    activity = new VaultActivity();
    account = null;
    cache = new CatalogCache(userData);
    service = new LibraryService({
      vault: () => new LibraryVault(vaultDir),
      vaultDir: () => vaultDir,
      cache,
      account: () => account,
      fetchCatalog: async () => [],
      activity,
    });
    await mkdir(join(vaultDir, ".kaipu"), { recursive: true });
    await writeFile(join(vaultDir, "old.mp4"), "v");
    await writeFile(
      join(vaultDir, ".kaipu", "old.json"),
      JSON.stringify({ assetId: "a", title: "New name" }),
    );
    await writeFile(join(vaultDir, "Pair.mp4"), "v");
    await writeFile(join(vaultDir, "Pair.png"), "p");
  });
  afterEach(async () => {
    await rm(vaultDir, { recursive: true, force: true });
    await rm(userData, { recursive: true, force: true });
  });

  it("scan reports fixable and listed findings, with a stable signature for the listed ones", async () => {
    const first = await service.reconcileScan();
    expect(first).toMatchObject({ status: "ok", fixableCount: 1 });
    if (first.status !== "ok") throw new Error("scan failed");
    expect(first.findings.map((f) => f.kind).sort()).toEqual([
      "name-mismatch",
      "stem-conflict",
      "stem-conflict",
    ]);
    expect(first.findings[0]).not.toHaveProperty("stem");
    const second = await service.reconcileScan();
    expect(second.status === "ok" && second.listedSignature).toBe(first.listedSignature);
  });

  it("scan does not run during a recording or an export, nor during a fix", async () => {
    const lease = activity.admit("export");
    expect(await service.reconcileScan()).toEqual({ status: "busy", activity: "export" });
    lease.release();
    const exit = await activity.enterMaintenance();
    expect(await service.reconcileScan()).toEqual({ status: "maintenance" });
    exit();
  });

  it("scan of an unreachable folder is an error, never 'no findings' (F7)", async () => {
    await rm(vaultDir, { recursive: true, force: true });
    expect((await service.reconcileScan()).status).toBe("error");
  });

  it("fix waits, runs in maintenance mode and reports; the flag is cleared afterwards", async () => {
    const progress: ReconcileProgress[] = [];
    const short = activity.admit("library");
    const fixing = service.reconcileFix({ onProgress: (p) => progress.push(p) });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(progress[0]).toEqual({ phase: "waiting", waitingFor: ["library"] });
    short.release();
    const result = await fixing;
    expect(result.status).toBe("done");
    expect(progress.some((p) => p.phase === "fixing")).toBe(true);
    expect(activity.inMaintenance).toBe(false);
    expect(await readdir(vaultDir)).toContain("New name.mp4");
  });

  it("fix refuses during a recording, and can be cancelled while it waits", async () => {
    const recording = activity.admit("recording");
    expect(await service.reconcileFix({})).toEqual({ status: "busy", activity: "recording" });
    recording.release();

    const short = activity.admit("library");
    const controller = new AbortController();
    const fixing = service.reconcileFix({ signal: controller.signal });
    controller.abort();
    expect(await fixing).toEqual({ status: "cancelled" });
    short.release();
    expect(activity.inMaintenance).toBe(false);
    expect(await readdir(vaultDir)).toContain("old.mp4");
  });

  it("uses the cached catalog when signed in, and 'unknown' when signed out", async () => {
    await writeFile(join(vaultDir, ".kaipu", "Gone.json"), JSON.stringify({ assetId: "c1" }));
    const actionOfGone = async (): Promise<string | undefined> => {
      const scan = await service.reconcileScan();
      if (scan.status !== "ok") throw new Error(scan.status);
      return scan.findings.find((f) => f.path === ".kaipu/Gone.json")?.action;
    };
    expect(await actionOfGone()).toBe("to-orphans");
    account = { userId: "u1", token: "t" };
    await cache.write("u1", [{ assetId: "c1" } as never]);
    expect(await actionOfGone()).toBe("cloud-only");
  });
});
