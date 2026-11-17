import { test, expect } from "@playwright/test";
import { mkdir, symlink, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { startScenario } from "./helpers";

// Actual-app AC6/10. Uses the established short media fixture for a real export.
// Worker messages and blob revocations are observed; no product test hooks or fake export.
const OUT = process.env.KAIPU_VERIFY_OUT ?? path.join(homedir(), "kaipu-evidence/niw2-844/layer-4");
const TAKE = process.env.KAIPU_VERIFY_TAKE ?? path.resolve(__dirname, "../e2e/fixtures/sample.mp4");
const ID = "e2e0a5e7-0000-4000-8000-00000000d844";

test("filmstrip pauses for a real export and clears on a real workspace switch", async () => {
  test.setTimeout(240_000);
  await mkdir(OUT, { recursive: true });
  console.log("[lifecycle] launching");
  const s = await startScenario("filmstrip-lifecycle", {
    env: { KAIPU_FLAG_OVERRIDES: '{"zoom-filmstrip":true}' },
    seedVault: async (dir) => {
      const meta = path.join(dir, ".kaipu");
      await mkdir(meta, { recursive: true });
      await symlink(TAKE, path.join(dir, "Long take.mp4"));
      await writeFile(
        path.join(meta, "Long take.json"),
        JSON.stringify({
          sidecarVersion: 2,
          assetId: ID,
          title: "Long take",
          durationSeconds: 3,
          createdAt: 1_700_000_000_000,
        }),
      );
      await writeFile(
        path.join(meta, "Long take.edit.json"),
        JSON.stringify({
          version: 1,
          scene: {
            items: [{ id: "clip", kind: "clip", sourceStart: 0, sourceEnd: 3 }],
            overlays: [],
            zoomSegments: [],
            redactions: [],
            zoomSensitivity: 50,
            audioMuted: false,
            mutedRanges: [],
          },
        }),
      );
    },
  });
  console.log("[lifecycle] launched");
  const { page } = s;
  const result: Record<string, unknown> = {};
  let createdPath: string | null = null;
  try {
    await page.addInitScript(() => {
      const w = window as unknown as {
        __film: { requests: number[]; urls: string[]; revoked: string[] };
      };
      w.__film = { requests: [], urls: [], revoked: [] };
      const blobs = new WeakSet<Blob>();
      const Original = Worker;
      window.Worker = class extends Original {
        constructor(url: string | URL, options?: WorkerOptions) {
          super(url, options);
          if (!String(url).includes("filmstrip")) return;
          this.addEventListener("message", (event) => {
            if (event.data.type === "frame") blobs.add(event.data.blob);
          });
          const post = this.postMessage.bind(this);
          this.postMessage = ((m: { type: string; slots?: unknown[] }) => {
            if (m.type === "request" && m.slots?.length) w.__film.requests.push(performance.now());
            post(m);
          }) as typeof this.postMessage;
        }
      };
      const mint = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (blob) => {
        const url = mint(blob);
        if (blob instanceof Blob && blobs.has(blob)) w.__film.urls.push(url);
        return url;
      };
      const revoke = URL.revokeObjectURL.bind(URL);
      URL.revokeObjectURL = (url) => {
        w.__film.revoked.push(url);
        revoke(url);
      };
    });
    console.log("[lifecycle] reload");
    await page.reload();
    const dialog = page.getByRole("dialog", { name: /Onboarding|Introducción/ });
    if (
      await dialog.waitFor({ state: "visible", timeout: 10_000 }).then(
        () => true,
        () => false,
      )
    ) {
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
    }
    await page.evaluate((id) => {
      location.hash = `#/library/${id}`;
    }, ID);
    console.log("[lifecycle] open editor");
    await page.getByRole("button", { name: /Edit video|Editar video/ }).click();
    await page.locator("[data-ui-area='editorVideo.transport']").waitFor();
    await expect
      .poll(() => page.evaluate(() => document.querySelector("video")?.videoWidth ?? 0))
      .toBeGreaterThan(0);
    const zoom = page.getByRole("button", { name: "Zoom in the timeline", exact: true });
    for (let i = 0; i < 5; i++) await zoom.click();
    await page.waitForFunction(
      () => (window as unknown as { __film: { urls: string[] } }).__film.urls.length > 0,
    );
    await page.waitForTimeout(1200);
    await s.shot("zoomed-before-export");
    await page.evaluate(() => {
      const w = window as unknown as { __busy: { t: number; busy: string | null }[] };
      w.__busy = [];
      window.electronAPI.workspaces.onChanged((state) =>
        w.__busy.push({ t: performance.now(), busy: state.busy }),
      );
    });
    console.log("[lifecycle] start export");
    await page.getByRole("button", { name: "Export", exact: true }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: /^Export( |$)/ })
      .click();
    await expect
      .poll(() => page.evaluate(async () => (await window.electronAPI.workspaces.list()).busy))
      .toBe("exporting");
    // Keep changing the view during the export; each would otherwise ask for more frames.
    await page.evaluate(() => {
      (window as unknown as { __scrollTicks: number[] }).__scrollTicks = [];
      const el = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
      (window as unknown as { __scroll: number }).__scroll = window.setInterval(() => {
        (window as unknown as { __scrollTicks: number[] }).__scrollTicks.push(performance.now());
        el.scrollLeft = el.scrollLeft > 100 ? 0 : 600;
      }, 180);
    });
    await s.shot("export-running");
    await page.getByRole("region", { name: "Your export is ready" }).waitFor({ timeout: 120_000 });
    await page.evaluate(() => {
      clearInterval((window as unknown as { __scroll: number }).__scroll);
    });
    const busy = await page.evaluate(
      () => (window as unknown as { __busy: { t: number; busy: string | null }[] }).__busy,
    );
    const start = busy.find((e) => e.busy === "exporting")!.t;
    const end = busy.find((e) => e.t > start && e.busy !== "exporting")!.t;
    result.busyEvents = busy;
    const activeTicks = await page.evaluate(
      ({ start, end }) =>
        (window as unknown as { __scrollTicks: number[] }).__scrollTicks.filter(
          (t) => t >= start && t <= end,
        ).length,
      { start, end },
    );
    result.scrollTicksDuringExport = activeTicks;
    expect(activeTicks).toBeGreaterThan(0);
    const requests = await page.evaluate(
      ({ start, end }) =>
        (window as unknown as { __film: { requests: number[] } }).__film.requests.filter(
          (t) => t >= start && t <= end,
        ),
      { start, end },
    );
    result.export = { durationMs: end - start, requestsDuringExport: requests.length };
    expect(requests).toEqual([]);
    await s.shot("export-ready");
    // Use the real bridge transaction in this throwaway user profile, never the owner's registry.
    const oldId = await page.evaluate(() => window.electronAPI.workspaces.activeId());
    const before = await page.evaluate(
      () => (window as unknown as { __film: { urls: string[] } }).__film.urls,
    );
    expect(before.length).toBeGreaterThan(0);
    const created = await page.evaluate(() =>
      window.electronAPI.workspaces.create({
        name: `Filmstrip evidence ${Date.now()}`,
        color: "sky",
      }),
    );
    result.workspaceCreate = created;
    expect(created.ok).toBe(true);
    if (created.ok) createdPath = created.workspace.path;
    await expect
      .poll(() => page.evaluate(() => window.electronAPI.workspaces.activeId()))
      .not.toBe(oldId);
    const missing = await page.evaluate((urls) => {
      const revoked = (window as unknown as { __film: { revoked: string[] } }).__film.revoked;
      return urls.filter((url) => !revoked.includes(url));
    }, before);
    result.workspace = { urlsBeforeSwitch: before.length, unrevokedAfterSwitch: missing.length };
    expect(missing).toEqual([]);
    await s.shot("new-workspace");
  } catch (error) {
    await s.shot("failure").catch(() => undefined);
    result.error = String(error);
    throw error;
  } finally {
    result.error ??= null;
    try {
      await writeFile(path.join(OUT, "lifecycle.json"), JSON.stringify(result, null, 2));
    } finally {
      try {
        await s.finish();
      } finally {
        if (createdPath) await rm(createdPath, { recursive: true, force: true });
      }
    }
  }
});
