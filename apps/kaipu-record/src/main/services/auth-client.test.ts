import { afterEach, describe, expect, it, vi } from "vitest";
import { getSession, signInWithPassword, signOutRemote, signUpWithPassword } from "./auth-client";

const config = { serverUrl: "http://localhost:3000" };

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signInWithPassword", () => {
  it("extracts the token from set-auth-token, not Set-Cookie", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { email: "a@b.com", name: "A" } }), {
          status: 200,
          headers: { "set-auth-token": "tok_123" },
        }),
      ),
    );
    const result = await signInWithPassword(config, { email: "a@b.com", password: "pw" });
    expect(result).toEqual({ token: "tok_123", email: "a@b.com", name: "A" });
  });

  it("rejects with invalid-credentials on a 401/400 body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(
      signInWithPassword(config, { email: "a@b.com", password: "wrong" }),
    ).rejects.toMatchObject({ kind: "invalid-credentials" });
  });

  it("rejects with network on a fetch throw", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(
      signInWithPassword(config, { email: "a@b.com", password: "pw" }),
    ).rejects.toMatchObject({ kind: "network" });
  });
});

describe("signUpWithPassword", () => {
  it("returns the same shape as sign-in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ user: { email: "new@b.com", name: "New" } }), {
          status: 200,
          headers: { "set-auth-token": "tok_456" },
        }),
      ),
    );
    const result = await signUpWithPassword(config, {
      email: "new@b.com",
      password: "pw",
      name: "New",
    });
    expect(result).toEqual({ token: "tok_456", email: "new@b.com", name: "New" });
  });

  it("rejects with email-taken on a 422 body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 422 })));
    await expect(
      signUpWithPassword(config, { email: "dup@b.com", password: "pw", name: "Dup" }),
    ).rejects.toMatchObject({ kind: "email-taken" });
  });

  it("reads the body's code so PASSWORD_TOO_SHORT is not reported as email-taken", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ code: "PASSWORD_TOO_SHORT", message: "too short" }), {
          status: 400,
        }),
      ),
    );
    await expect(
      signUpWithPassword(config, { email: "new@b.com", password: "short", name: "New" }),
    ).rejects.toMatchObject({ kind: "password-too-short" });
  });

  it("falls back to the endpoint's default kind for any other error code", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ code: "USER_ALREADY_EXISTS" }), { status: 422 }),
        ),
    );
    await expect(
      signUpWithPassword(config, { email: "dup@b.com", password: "long enough", name: "Dup" }),
    ).rejects.toMatchObject({ kind: "email-taken" });
  });
});

describe("getSession", () => {
  it("resolves the session on 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ user: { email: "a@b.com", name: "A" } }), { status: 200 }),
        ),
    );
    await expect(getSession(config, "tok")).resolves.toEqual({ email: "a@b.com", name: "A" });
  });

  it("resolves null on a confirmed 401 — the session is genuinely gone", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(getSession(config, "tok")).resolves.toBeNull();
  });

  it("resolves null (does not reject) on better-auth's 200 + null body — the common expiry path", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("null", { status: 200 })));
    await expect(getSession(config, "tok")).resolves.toBeNull();
  });

  it("resolves null on a 200 with a body that carries no user", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    await expect(getSession(config, "tok")).resolves.toBeNull();
  });

  it("REJECTS (does not resolve null) on a network failure — the caller must not treat this the same as a 401", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    await expect(getSession(config, "tok")).rejects.toThrow();
  });

  it("rejects on a non-401 error status too (e.g. 500) — only 401 means null", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 500 })));
    await expect(getSession(config, "tok")).rejects.toThrow();
  });
});

describe("signOutRemote", () => {
  it("resolves on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 200 })));
    await expect(signOutRemote(config, "tok")).resolves.toBeUndefined();
  });

  it("does not throw on failure — best-effort by contract", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    await expect(signOutRemote(config, "tok")).resolves.toBeUndefined();
  });
});
