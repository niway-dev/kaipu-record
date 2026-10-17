import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SignHook = ((configuration: { path: string }, packager?: unknown) => Promise<void>) & {
  signWithEnv: (configuration: { path: string }, env: NodeJS.ProcessEnv) => Promise<void>;
  readSigningEnv: (env?: NodeJS.ProcessEnv) => Record<string, string>;
};

const nodeRequire = createRequire(import.meta.url);
const HOOK_PATH = nodeRequire.resolve("../../../scripts/sign-windows.cjs");

/** Fresh module per test: the "warn once" flags live at module scope. */
function loadHook(): SignHook {
  delete nodeRequire.cache[HOOK_PATH];
  return nodeRequire(HOOK_PATH) as SignHook;
}

const file = { path: "kaipu-record.exe" };

describe("sign-windows hook", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("no-ops without a vendor and warns once even when called twice", async () => {
    const { signWithEnv } = loadHook();
    await expect(signWithEnv(file, {})).resolves.toBeUndefined();
    await expect(signWithEnv(file, { WIN_SIGN_VENDOR: "" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      "::warning::Windows build is unsigned — no WIN_SIGN_VENDOR configured",
    );
  });

  it("warns about stray signing variables but still no-ops", async () => {
    const { signWithEnv } = loadHook();
    await expect(
      signWithEnv(file, { AZURE_CLIENT_ID: "id", WIN_SIGN_ENDPOINT: "" }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(String(warn.mock.calls[1][0])).toContain("AZURE_CLIENT_ID");
    expect(String(warn.mock.calls[1][0])).not.toContain("WIN_SIGN_ENDPOINT");
  });

  it("rejects an unknown vendor, naming it and the supported ones", async () => {
    const { signWithEnv } = loadHook();
    await expect(signWithEnv(file, { WIN_SIGN_VENDOR: "nope" })).rejects.toThrow(
      /Unknown WIN_SIGN_VENDOR "nope".*azure, sslcom/,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("rejects azure naming every missing variable", async () => {
    const { signWithEnv } = loadHook();
    await expect(
      signWithEnv(file, { WIN_SIGN_VENDOR: "azure", AZURE_TENANT_ID: "t" }),
    ).rejects.toThrow(
      /missing: AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, WIN_SIGN_PUBLISHER_NAME, WIN_SIGN_ENDPOINT, WIN_SIGN_CERTIFICATE_PROFILE, WIN_SIGN_ACCOUNT_NAME/,
    );
  });

  it("fails loudly for azure with every variable set (seam, not an integration)", async () => {
    const { signWithEnv } = loadHook();
    const env = {
      WIN_SIGN_VENDOR: "azure",
      AZURE_TENANT_ID: "t",
      AZURE_CLIENT_ID: "c",
      AZURE_CLIENT_SECRET: "s",
      WIN_SIGN_PUBLISHER_NAME: "p",
      WIN_SIGN_ENDPOINT: "e",
      WIN_SIGN_CERTIFICATE_PROFILE: "cp",
      WIN_SIGN_ACCOUNT_NAME: "a",
    };
    await expect(signWithEnv(file, env)).rejects.toThrow(/azureSignOptions/);
  });

  it("fails loudly for sslcom", async () => {
    const { signWithEnv } = loadHook();
    await expect(signWithEnv(file, { WIN_SIGN_VENDOR: "sslcom" })).rejects.toThrow(
      /sslcom is not implemented/,
    );
  });

  it("the exported entry reads process.env and ignores electron-builder's packager argument", async () => {
    vi.stubEnv("WIN_SIGN_VENDOR", "nope");
    try {
      const sign = loadHook();
      await expect(sign(file, { WIN_SIGN_VENDOR: "" })).rejects.toThrow(/"nope"/);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("readSigningEnv drops empty strings and unrelated variables", () => {
    const { readSigningEnv } = loadHook();
    expect(readSigningEnv({ WIN_SIGN_VENDOR: "", AZURE_TENANT_ID: " t ", OTHER: "x" })).toEqual({
      AZURE_TENANT_ID: "t",
    });
  });
});
