import { test, expect } from "@playwright/test";
import { mkdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { startScenario } from "./helpers";

// AC9: identical real-app workload on main, flag-off and flag-on, on the idle Mac mini.
// No screenshots/video assertions substitute for the rAF and long-task measurements here.
const SIDE = process.env.KAIPU_VERIFY_SIDE ?? "on";
const OUT = path.join(homedir(), "kaipu-evidence/niw2-844/layer-4");
const TAKE = path.join(homedir(), "kaipu-evidence/niw2-844/take/take-1440p-10gb.mp4");
const ID = "e2e0a5e7-0000-4000-8000-00000000d844";
test(`filmstrip scroll and zoom frame times (${SIDE})`, async () => {
  test.setTimeout(240_000);
  await mkdir(OUT, { recursive: true });
  const s = await startScenario(`filmstrip-performance-${SIDE}`, {
    ...(SIDE === "on" ? { env: { KAIPU_FLAG_OVERRIDES: '{"zoom-filmstrip":true}' } } : {}),
    seedVault: async (dir) => {
      await mkdir(path.join(dir, ".kaipu"), { recursive: true });
      await symlink(TAKE, path.join(dir, "Long take.mp4"));
      await writeFile(
        path.join(dir, ".kaipu/Long take.json"),
        JSON.stringify({
          sidecarVersion: 2,
          assetId: ID,
          title: "Long take",
          durationSeconds: 3249.029,
          createdAt: 1_700_000_000_000,
        }),
      );
    },
  });
  const result: Record<string, unknown> = { side: SIDE };
  try {
    const { page } = s;
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
    await page.getByRole("button", { name: /Edit video|Editar video/ }).click();
    await page.locator("[data-ui-area='editorVideo.transport']").waitFor();
    await expect
      .poll(() => page.locator("[data-ui-area='editorVideo.timeline'] img").count(), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);
    const zoom = page.getByRole("button", { name: "Zoom in the timeline", exact: true });
    for (let i = 0; i < 5; i++) await zoom.click();
    await page.waitForTimeout(2500);
    const runs = [];
    for (let run = 0; run < 3; run++) {
      runs.push(
        await page.evaluate(async () => {
          const body = document.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')!;
          const buttons = [...document.querySelectorAll<HTMLButtonElement>("button")];
          const plus = buttons.find(
            (b) => b.getAttribute("aria-label") === "Zoom in the timeline",
          )!;
          const minus = buttons.find(
            (b) => b.getAttribute("aria-label") === "Zoom out the timeline",
          )!;
          const frames: number[] = [];
          const longTasks: number[] = [];
          const observer = new PerformanceObserver((list) => {
            for (const e of list.getEntries()) longTasks.push(e.duration);
          });
          observer.observe({ type: "longtask" });
          let running = true;
          let last = performance.now();
          const raf = (now: number): void => {
            frames.push(now - last);
            last = now;
            if (running) requestAnimationFrame(raf);
          };
          requestAnimationFrame(raf);
          const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
          // Continuous scroll, then settled jumps (which decode only with the flag enabled).
          for (let i = 0; i < 50; i++) {
            body.scrollLeft = ((body.scrollWidth - body.clientWidth) * i) / 50;
            await wait(30);
          }
          for (const f of [0.15, 0.35, 0.65, 0.85]) {
            body.scrollLeft = (body.scrollWidth - body.clientWidth) * f;
            await wait(650);
          }
          for (let i = 0; i < 12; i++) {
            (i % 2 ? plus : minus).click();
            await wait(220);
          }
          await wait(800);
          running = false;
          observer.disconnect();
          const sorted = frames.slice(1).sort((a, b) => a - b);
          return {
            samples: sorted.length,
            p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
            maxMs: sorted.at(-1),
            longTasksMs: longTasks,
          };
        }),
      );
    }
    result.runs = runs;
    result.medianP95Ms = runs.map((r) => r.p95Ms).sort((a, b) => a - b)[1];
    await s.shot("after-scroll-and-zoom");
  } catch (error) {
    result.error = String(error);
    throw error;
  } finally {
    result.error ??= null;
    await writeFile(path.join(OUT, `performance-${SIDE}.json`), JSON.stringify(result, null, 2));
    await s.finish();
  }
});
