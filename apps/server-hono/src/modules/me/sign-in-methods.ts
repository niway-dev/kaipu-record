import { ORPCError } from "@orpc/server";
import { credentialDroppedNoticeId } from "../../lib/account-linking";

/** The slice of `auth.api` the set-password route needs; a fake in tests. */
export interface SetPasswordApi {
  setPassword(args: { body: { newPassword: string }; headers: Headers }): Promise<unknown>;
}

/** The slice of Better Auth's internal adapter the notices route needs; a fake in tests. */
export interface NoticeStore {
  /** Reads and deletes in one race-safe step; null when there is nothing (or it expired). */
  consumeVerificationValue(identifier: string): Promise<{ id: string } | null | undefined>;
}

/** Better Auth 1.7's code for "this account already has a password" (api/routes/update-user.mjs). */
const PASSWORD_ALREADY_SET = "PASSWORD_ALREADY_SET";

function describe(err: unknown): { status?: unknown; code?: string } {
  if (typeof err !== "object" || err === null) return {};
  const e = err as { status?: unknown; body?: { code?: unknown } };
  return {
    status: e.status,
    code: typeof e.body?.code === "string" ? e.body.code : undefined,
  };
}

/**
 * FR10: wraps Better Auth's server-only `setPassword` (1.7.11 exposes no HTTP path for it). The
 * session stays signed in. Better Auth's answers become oRPC errors the web form can switch on.
 */
export async function setPasswordForSession(
  api: SetPasswordApi,
  headers: Headers,
  newPassword: string,
): Promise<{ data: { status: true }; error: null }> {
  try {
    await api.setPassword({ body: { newPassword }, headers });
  } catch (err) {
    const { status, code } = describe(err);
    if (code === PASSWORD_ALREADY_SET) {
      throw new ORPCError("CONFLICT", { message: "This account already has a password" });
    }
    if (code === "PASSWORD_TOO_SHORT" || code === "PASSWORD_TOO_LONG") {
      throw new ORPCError("BAD_REQUEST", { message: "Password length is not allowed" });
    }
    if (status === "UNAUTHORIZED" || status === 401) throw new ORPCError("UNAUTHORIZED");
    throw err;
  }
  return { data: { status: true }, error: null };
}

/** Q3: reads the one-time notices for this user and clears them in the same call. */
export async function takeNoticesFor(
  store: NoticeStore,
  userId: string,
): Promise<{ data: { credentialDropped: boolean }; error: null }> {
  const notice = await store.consumeVerificationValue(credentialDroppedNoticeId(userId));
  return { data: { credentialDropped: Boolean(notice) }, error: null };
}
