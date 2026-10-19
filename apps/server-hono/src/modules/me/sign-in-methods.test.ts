import { ORPCError } from "@orpc/server";
import { APIError } from "better-auth/api";
import { describe, expect, it, vi } from "vitest";
import { setPasswordForSession, takeNoticesFor } from "./sign-in-methods";

const headers = new Headers({ cookie: "session=fake" });

describe("setPasswordForSession", () => {
  it("forwards the request headers and the new password", async () => {
    const setPassword = vi.fn().mockResolvedValue({ status: true });
    await expect(
      setPasswordForSession({ setPassword }, headers, "new-password-1"),
    ).resolves.toEqual({ data: { status: true }, error: null });
    expect(setPassword).toHaveBeenCalledWith({ body: { newPassword: "new-password-1" }, headers });
  });

  it("answers 409 when the account already has a password", async () => {
    const setPassword = vi.fn().mockRejectedValue(
      new APIError("BAD_REQUEST", {
        message: "User already has a password set",
        code: "PASSWORD_ALREADY_SET",
      }),
    );
    const err = await setPasswordForSession({ setPassword }, headers, "x".repeat(8)).catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ORPCError);
    expect((err as ORPCError<string, unknown>).status).toBe(409);
  });

  it("answers 400 for a length Better Auth rejects", async () => {
    const setPassword = vi
      .fn()
      .mockRejectedValue(
        new APIError("BAD_REQUEST", { message: "Password too short", code: "PASSWORD_TOO_SHORT" }),
      );
    const err = await setPasswordForSession({ setPassword }, headers, "x".repeat(8)).catch(
      (e: unknown) => e,
    );
    expect((err as ORPCError<string, unknown>).status).toBe(400);
  });

  it("answers 401 when Better Auth finds no session", async () => {
    const setPassword = vi.fn().mockRejectedValue(new APIError("UNAUTHORIZED"));
    const err = await setPasswordForSession({ setPassword }, headers, "x".repeat(8)).catch(
      (e: unknown) => e,
    );
    expect((err as ORPCError<string, unknown>).status).toBe(401);
  });

  it("rethrows anything else unchanged", async () => {
    const boom = new Error("db down");
    const setPassword = vi.fn().mockRejectedValue(boom);
    await expect(setPasswordForSession({ setPassword }, headers, "x".repeat(8))).rejects.toBe(boom);
  });
});

describe("takeNoticesFor", () => {
  it("reports and clears a pending credential-dropped notice", async () => {
    const store = { consumeVerificationValue: vi.fn().mockResolvedValue({ id: "ver-1" }) };
    await expect(takeNoticesFor(store, "user-1")).resolves.toEqual({
      data: { credentialDropped: true },
      error: null,
    });
    expect(store.consumeVerificationValue).toHaveBeenCalledWith("notice:credential-dropped:user-1");
  });

  it("reports nothing when there is no notice", async () => {
    const store = { consumeVerificationValue: vi.fn().mockResolvedValue(null) };
    await expect(takeNoticesFor(store, "user-1")).resolves.toEqual({
      data: { credentialDropped: false },
      error: null,
    });
  });
});
