import { beforeEach, describe, expect, it, vi } from "vitest";

const plugin = vi.hoisted(() => ({
  electronOptions: [] as Array<Record<string, unknown>>,
  requestAuth: vi.fn(),
  authenticate: vi.fn(),
}));

vi.mock("@better-auth/electron/client", () => ({
  electronClient: (options: Record<string, unknown>) => {
    plugin.electronOptions.push(options);
    return { id: "electron" };
  },
}));
vi.mock("better-auth/client", () => ({
  createAuthClient: () => ({
    requestAuth: plugin.requestAuth,
    authenticate: plugin.authenticate,
  }),
}));

import { createBrowserSignInClient, sessionTokenFromSetCookie } from "./browser-sign-in";

const config = { serverUrl: "http://localhost:3000", webUrl: "http://localhost:3001/" };

/** The base64url JSON the web "done" page shows: `{ identifier, state }`. */
const CODE = Buffer.from(JSON.stringify({ identifier: "abc", state: "st" })).toString("base64url");

const USER = { id: "u1", email: "a@b.com", name: "A" };

/** Make the fake `authenticate` behave like the real one on success: it runs the per-call
 *  onSuccess hook with the exchange response. */
function exchangeSucceeds(headers: Record<string, string>): void {
  plugin.authenticate.mockImplementation(
    async (arg: { fetchOptions: { onSuccess: (ctx: unknown) => void } }) => {
      arg.fetchOptions.onSuccess({
        response: { headers: { get: (name: string) => headers[name.toLowerCase()] ?? null } },
      });
      return { data: { token: "ignored", user: USER }, error: null };
    },
  );
}

beforeEach(() => {
  plugin.electronOptions.length = 0;
  plugin.requestAuth.mockReset();
  plugin.authenticate.mockReset();
});

describe("createBrowserSignInClient", () => {
  it("points the plugin at the web sign-in page with the kaipu scheme and the desktop client id", async () => {
    await createBrowserSignInClient(config).begin("sign-in");

    expect(plugin.requestAuth).toHaveBeenCalledOnce();
    const options = plugin.electronOptions[0]!;
    expect(String(options.signInURL)).toBe("http://localhost:3001/auth/desktop");
    expect(options.protocol).toEqual({ scheme: "kaipu" });
    expect(options.clientID).toBe("kaipu-desktop");
    expect(options.cookiePrefix).toBe("better-auth");
  });

  it("marks the sign-up variant in the URL it opens", async () => {
    await createBrowserSignInClient(config).begin("sign-up");
    expect(String(plugin.electronOptions[0]!.signInURL)).toBe(
      "http://localhost:3001/auth/desktop?intent=sign-up",
    );
  });

  it("keeps the plugin's cookie jar in memory only and empties it after the exchange", async () => {
    const client = createBrowserSignInClient(config);
    await client.begin("sign-in");
    const storage = plugin.electronOptions[0]!.storage as {
      getItem(n: string): unknown;
      setItem(n: string, v: unknown): void;
    };
    expect(storage.getItem("better-auth.cookie")).toBeNull();
    storage.setItem("better-auth.cookie", "jar");
    expect(storage.getItem("better-auth.cookie")).toBe("jar");

    exchangeSucceeds({ "set-auth-token": "signed.tok" });
    await client.exchange(CODE);

    expect(storage.getItem("better-auth.cookie")).toBeNull();
  });

  it("returns the signed token from set-auth-token with the user's identity", async () => {
    exchangeSucceeds({ "set-auth-token": "signed.tok" });
    await expect(createBrowserSignInClient(config).exchange(CODE)).resolves.toEqual({
      token: "signed.tok",
      userId: "u1",
      email: "a@b.com",
      name: "A",
    });
  });

  it("falls back to the session cookie when the bearer header is missing", async () => {
    exchangeSucceeds({
      "set-cookie": "__Secure-better-auth.session_token=ab%2Bc.sig%3D; Path=/; HttpOnly",
    });
    await expect(createBrowserSignInClient(config).exchange(CODE)).resolves.toMatchObject({
      token: "ab+c.sig=",
    });
  });

  it("rejects a malformed code without calling the plugin", async () => {
    await expect(createBrowserSignInClient(config).exchange("not a code")).rejects.toEqual({
      kind: "invalid-code",
    });
    expect(plugin.authenticate).not.toHaveBeenCalled();
  });

  it("maps a missing PKCE verifier to a state mismatch", async () => {
    plugin.authenticate.mockRejectedValue(new Error("Code verifier not found."));
    await expect(createBrowserSignInClient(config).exchange(CODE)).rejects.toEqual({
      kind: "state-mismatch",
    });
  });

  it("maps a refused code to invalid-code and an unreachable server to network", async () => {
    plugin.authenticate.mockResolvedValue({ data: null, error: { status: 400, statusText: "" } });
    await expect(createBrowserSignInClient(config).exchange(CODE)).rejects.toEqual({
      kind: "invalid-code",
    });

    plugin.authenticate.mockResolvedValue({ data: null, error: { status: 503, statusText: "" } });
    await expect(createBrowserSignInClient(config).exchange(CODE)).rejects.toEqual({
      kind: "network",
    });

    plugin.authenticate.mockRejectedValue(new TypeError("fetch failed"));
    await expect(createBrowserSignInClient(config).exchange(CODE)).rejects.toEqual({
      kind: "network",
    });
  });

  it("fails loudly when the server answers without issuing a session token", async () => {
    exchangeSucceeds({});
    await expect(createBrowserSignInClient(config).exchange(CODE)).rejects.toMatchObject({
      kind: "unknown",
    });
  });
});

describe("sessionTokenFromSetCookie", () => {
  it("ignores unrelated cookies and the cached session_data cookie", () => {
    expect(sessionTokenFromSetCookie(null)).toBeNull();
    expect(sessionTokenFromSetCookie("better-auth.session_data=xyz; Path=/")).toBeNull();
    expect(
      sessionTokenFromSetCookie("other=1; Path=/, better-auth.session_token=t.s; Path=/"),
    ).toBe("t.s");
  });
});
