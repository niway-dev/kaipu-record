import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const MAIN_ENTRY = path.resolve(__dirname, "..", "out", "main", "index.js");

test("app launches and opens a window", async () => {
  const userDataDir = await mkdtemp(path.join(tmpdir(), "kaipu-e2e-smoke-"));
  const app = await electron.launch({
    args: [MAIN_ENTRY, `--user-data-dir=${userDataDir}`],
  });
  try {
    const page = await app.firstWindow();
    await expect(page).toHaveTitle(/Kaipu Record/);
  } finally {
    await app.close();
    await rm(userDataDir, { recursive: true, force: true });
  }
});
