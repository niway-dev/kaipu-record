import type { CloudControl } from "@kaipu/domain/repositories";
import { describe, expect, it } from "vitest";
import { CLOUD_UPLOADS_USAGE, runCloudUploadsCommand } from "./cloud-uploads-command";

function store(initial: boolean | null) {
  // null = no row yet (the repository then reports enabled).
  const state = { row: initial };
  return {
    state,
    async getControl(): Promise<CloudControl> {
      return { uploadsEnabled: state.row ?? true };
    },
    async setUploadsEnabled(enabled: boolean): Promise<CloudControl> {
      state.row = enabled;
      return { uploadsEnabled: enabled };
    },
  };
}

async function run(command: string | undefined, s = store(null)) {
  const lines: string[] = [];
  const code = await runCloudUploadsCommand(command, s, (l) => lines.push(l));
  return { code, lines, s };
}

describe("cloud:uploads", () => {
  it("status reads without writing", async () => {
    const { code, lines, s } = await run("status", store(false));
    expect(code).toBe(0);
    expect(lines).toEqual(["cloud uploads: PAUSED"]);
    expect(s.state.row).toBe(false);
  });

  it("status on a fresh database reports enabled and creates no row", async () => {
    const { lines, s } = await run("status");
    expect(lines).toEqual(["cloud uploads: enabled"]);
    expect(s.state.row).toBeNull();
  });

  it("off pauses and says what it does not cut", async () => {
    const { code, lines, s } = await run("off");
    expect(code).toBe(0);
    expect(s.state.row).toBe(false);
    expect(lines[0]).toBe("cloud uploads: PAUSED");
    expect(lines[1]).toMatch(/not cut/);
  });

  it("on restores uploads", async () => {
    const { lines, s } = await run("on", store(false));
    expect(s.state.row).toBe(true);
    expect(lines).toEqual(["cloud uploads: enabled"]);
  });

  it.each([undefined, "", "enable", "ON"])("rejects %j with usage and exit 2", async (cmd) => {
    const { code, lines, s } = await run(cmd);
    expect(code).toBe(2);
    expect(lines).toEqual([CLOUD_UPLOADS_USAGE]);
    expect(s.state.row).toBeNull();
  });
});
