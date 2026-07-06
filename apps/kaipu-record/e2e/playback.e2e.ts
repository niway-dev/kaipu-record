import { test, expect, type Page } from "@playwright/test";
import { launchApp, openEditor, RECORDING_ID } from "./helpers/launch";

/** Read the live <video> element's playback state from the renderer. */
async function videoState(page: Page) {
  return page.evaluate(() => {
    const v = document.querySelector("video");
    if (!v) return null;
    return {
      currentTime: v.currentTime,
      paused: v.paused,
      seeking: v.seeking,
      error: v.error?.code ?? null,
    };
  });
}

/**
 * The real guard for the seek-wedge regression (commit f41706f): the media protocol must
 * answer a `Range` request with `206` + `Content-Range`. When it instead returns `200`/full
 * (the bug), Chromium's media stack treats a `200` answer to the `bytes=<offset>-` request
 * it issues while seeking as a fatal resource error, and the <video> wedges (`seeking`
 * stays true, `play()` never resumes).
 *
 * We assert the protocol directly because it is deterministic. A fixture small enough to
 * commit cheaply buffers whole on the first load, so a real <video> seek stays in-buffer and
 * never issues the offset request that reproduces the wedge — the seek smoke below cannot
 * catch this regression on its own, but this fetch can.
 */
test("media protocol serves Range requests as 206 (seeking stays alive)", async () => {
  const { page, teardown } = await launchApp();
  try {
    const res = await page.evaluate(async (id) => {
      const r = await fetch(`kaipu-media://recording/${id}`, {
        headers: { Range: "bytes=1000-" },
      });
      const body = await r.arrayBuffer();
      return {
        status: r.status,
        contentRange: r.headers.get("content-range"),
        acceptRanges: r.headers.get("accept-ranges"),
        byteLength: body.byteLength,
      };
    }, RECORDING_ID);

    expect(res.status).toBe(206);
    expect(res.contentRange).toMatch(/^bytes 1000-\d+\/\d+$/);
    expect(res.acceptRanges).toBe("bytes");
    expect(res.byteLength).toBeGreaterThan(0);
  } finally {
    await teardown();
  }
});

/**
 * Realistic user-flow smoke: after seeking on the timeline ruler, pressing Play advances the
 * <video> without wedging. (Complements the protocol guard above with the real end-to-end
 * path a user takes.)
 */
test("seeking on the ruler then pressing play resumes playback", async () => {
  const { page, teardown } = await launchApp();
  try {
    await openEditor(page);

    // Click the timeline ruler ~60% across to seek there.
    const ruler = page.getByTestId("ruler");
    const box = await ruler.boundingBox();
    if (!box) throw new Error("ruler not found");
    await page.mouse.click(box.x + box.width * 0.6, box.y + box.height / 2);

    // The seek must settle: not stuck seeking, no media error.
    await expect
      .poll(async () => (await videoState(page))?.seeking, { timeout: 10_000 })
      .toBe(false);
    expect((await videoState(page))?.error).toBeNull();

    // Press Play and assert currentTime actually advances (the bug: it never did).
    await page.getByRole("button", { name: "Reproducir" }).click();
    const t0 = (await videoState(page))!.currentTime;
    await expect
      .poll(async () => (await videoState(page))?.currentTime, { timeout: 10_000 })
      .toBeGreaterThan(t0 + 0.3);
    expect((await videoState(page))?.paused).toBe(false);
  } finally {
    await teardown();
  }
});
