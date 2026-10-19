/**
 * Account linking rules for "Continue with Google" (NIW2-219).
 *
 * Better Auth 1.4.18 links a Google sign-in to an existing user with the same email whenever
 * Google says the email is verified. That is right for a verified email+password account, and
 * wrong for an UNVERIFIED one: whoever registered the address first (possibly an attacker who
 * never owned the inbox) would keep their password and sessions after the real owner signs in
 * with Google. This module closes that "pre-hijack" hole.
 *
 * Verified against node_modules/better-auth/dist (1.4.18):
 * - oauth2/link-account.mjs: the implicit link runs `linkAccount` (account create hooks), THEN
 *   `updateUser({ emailVerified: true })`, THEN `createSession`. So inside the account create
 *   hooks the user is still unverified and the new session does not exist yet.
 * - db/with-hooks.mjs: `create.before` runs before the row is written; a throw aborts the
 *   write. `link-account.mjs` wraps `linkAccount` in try/catch and answers
 *   `error=unable_to_link_account`, so the sign-in fails closed.
 * - The drizzle adapter runs with `transaction: false` (adapter default; neon-http has no
 *   transactions anyway), so nothing here can rely on a rollback. That is why the destructive
 *   work happens in `before`: if anything fails, the Google row is never written and the user
 *   is never left "linked + unverified + attacker password intact".
 * - api/routes/callback.mjs + oauth2/state.mjs: the callback stores the parsed OAuth state with
 *   `setOAuthState`; `getOAuthState()` returns it, and its `link` field is present only when a
 *   signed-in user started `linkSocial`. That is how the hook tells a manual link apart.
 */
import { APIError, getOAuthState } from "better-auth/api";
import type { BetterAuthOptions } from "better-auth";
import { logEvent } from "./events";

export type LinkFlow = "implicit" | "manual-link";

export interface LinkDecisionInput {
  /** Provider of the account row being created. */
  providerId: string;
  flow: LinkFlow;
  user: { email: string; emailVerified: boolean };
  /** The user's accounts BEFORE the new row (the new row must not be in this list). */
  existingAccounts: ReadonlyArray<{ id: string; providerId: string }>;
  /** Claims read from Google's id_token; `null` when there is no id_token to read. */
  google: { email: string | null; emailVerified: boolean } | null;
}

export type LinkDecision =
  | { kind: "none" }
  /** Abort the link: the hook throws and Better Auth answers `unable_to_link_account`. */
  | { kind: "refuse"; reason: "google-email-not-verified" | "google-email-mismatch" }
  /** FR6: delete the unverified password, revoke every earlier session, then let the link go on. */
  | { kind: "drop-unverified-credential"; credentialAccountIds: string[] }
  /** FR8/Q4: a signed-in user linked a Google account with the same, verified email. */
  | { kind: "mark-email-verified" };

const sameEmail = (a: string | null, b: string): boolean =>
  a !== null && a.trim().toLowerCase() === b.trim().toLowerCase();

/** Pure: every linking side effect is decided here, so it is testable without OAuth. */
export function decideLinkSideEffects(input: LinkDecisionInput): LinkDecision {
  if (input.providerId !== "google") return { kind: "none" };

  if (input.flow === "manual-link") {
    // Q4: keep the password. They proved the password (signed in) and the inbox (Google).
    if (
      !input.user.emailVerified &&
      input.google?.emailVerified === true &&
      sameEmail(input.google.email, input.user.email)
    ) {
      return { kind: "mark-email-verified" };
    }
    return { kind: "none" };
  }

  // Implicit sign-in. No earlier accounts means this is the Google sign-up itself
  // (createOAuthUser), which is allowed even when Google has not verified the email (FR7).
  if (input.existingAccounts.length === 0) return { kind: "none" };

  // Joining an existing user requires Google's proof of the inbox. Better Auth already refuses
  // this (Google is not a trusted provider), so reaching here means a config change: fail closed.
  if (input.google?.emailVerified !== true) {
    return { kind: "refuse", reason: "google-email-not-verified" };
  }
  if (!sameEmail(input.google.email, input.user.email)) {
    return { kind: "refuse", reason: "google-email-mismatch" };
  }

  // FR5: a verified account keeps its password and sessions.
  if (input.user.emailVerified) return { kind: "none" };

  const credentialAccountIds = input.existingAccounts
    .filter((account) => account.providerId === "credential")
    .map((account) => account.id);
  if (credentialAccountIds.length === 0) return { kind: "none" };
  return { kind: "drop-unverified-credential", credentialAccountIds };
}

/**
 * Reads `email` and `email_verified` from a Google id_token WITHOUT checking its signature.
 * Safe here because the token is the one Better Auth just received from Google's token
 * endpoint over TLS in this same request (or verified with Google's keys on the id-token paths,
 * which Kaipu disables anyway). Anything malformed reads as "no claims".
 */
export function readGoogleIdTokenClaims(
  idToken: string | null | undefined,
): { email: string | null; emailVerified: boolean } | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const claims = JSON.parse(atob(padded)) as { email?: unknown; email_verified?: unknown };
    return {
      email: typeof claims.email === "string" ? claims.email : null,
      // Google sends a boolean; some libraries historically sent the string "true".
      emailVerified: claims.email_verified === true || claims.email_verified === "true",
    };
  } catch {
    return null;
  }
}

/** Identifier of the one-time "we removed your password" notice (Q3), in the verification table. */
export const credentialDroppedNoticeId = (userId: string): string =>
  `notice:credential-dropped:${userId}`;

/** How long an unread notice is kept. Long enough to survive a holiday, short enough to clean up. */
const NOTICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

interface AccountRow {
  id?: string;
  userId: string;
  providerId: string;
  idToken?: string | null;
}

type HookContext = Parameters<
  NonNullable<
    NonNullable<
      NonNullable<NonNullable<BetterAuthOptions["databaseHooks"]>["account"]>["create"]
    >["before"]
  >
>[1];

async function detectFlow(ctx: NonNullable<HookContext>, account: AccountRow): Promise<LinkFlow> {
  if (ctx.path === "/link-social") return "manual-link";
  if (ctx.path === "/callback/:id") {
    // No state (or a state for another user) is treated as implicit: the safe default, because
    // the implicit rules only ever remove access, never grant it.
    const state = await getOAuthState().catch(() => null);
    if (state?.link && String(state.link.userId) === String(account.userId)) return "manual-link";
  }
  return "implicit";
}

async function decide(
  ctx: NonNullable<HookContext>,
  account: AccountRow,
): Promise<{ decision: LinkDecision; userId: string }> {
  const adapter = ctx.context.internalAdapter;
  const user = await adapter.findUserById(account.userId);
  if (!user) throw new APIError("BAD_REQUEST", { message: "unable to link account" });
  const accounts = await adapter.findAccounts(account.userId);
  const decision = decideLinkSideEffects({
    providerId: account.providerId,
    flow: await detectFlow(ctx, account),
    user: { email: user.email, emailVerified: user.emailVerified },
    existingAccounts: accounts.filter((existing) => existing.id !== account.id),
    google: readGoogleIdTokenClaims(account.idToken),
  });
  return { decision, userId: user.id };
}

/**
 * `databaseHooks.account.create` for the Better Auth instance. Destructive work in `before`
 * (fails closed, see the module comment); the harmless "mark verified" in `after`, where a
 * failure only leaves the user unverified.
 */
export const accountLinkingHooks = {
  account: {
    create: {
      before: async (account: AccountRow, ctx: HookContext) => {
        if (account.providerId !== "google") return;
        // Every Google account is created inside an auth endpoint; without one we cannot check.
        if (!ctx) throw new APIError("BAD_REQUEST", { message: "unable to link account" });

        const { decision, userId } = await decide(ctx, account);
        if (decision.kind === "refuse") {
          console.warn("google link refused", { userId, reason: decision.reason });
          throw new APIError("FORBIDDEN", { message: "unable to link account" });
        }
        if (decision.kind !== "drop-unverified-credential") return;

        const adapter = ctx.context.internalAdapter;
        for (const id of decision.credentialAccountIds) await adapter.deleteAccount(id);
        // Every session of this user is from before this sign-in: the new one is created only
        // after linkAccount returns (link-account.mjs). Desktop bearer sessions are DB rows too.
        await adapter.deleteSessions(userId);
        await adapter.createVerificationValue({
          identifier: credentialDroppedNoticeId(userId),
          value: "1",
          expiresAt: new Date(Date.now() + NOTICE_TTL_MS),
        });
        logEvent({ name: "auth.link.unverified_credential_dropped", userId });
      },
      after: async (account: AccountRow, ctx: HookContext) => {
        if (account.providerId !== "google" || !ctx) return;
        try {
          const { decision, userId } = await decide(ctx, account);
          if (decision.kind !== "mark-email-verified") return;
          await ctx.context.internalAdapter.updateUser(userId, { emailVerified: true });
          logEvent({ name: "auth.link.email_verified_by_google", userId });
        } catch (err) {
          // The link itself succeeded; the user just stays unverified. Never throw here: the
          // row already exists and a throw would only turn a working link into a 500.
          console.error("could not mark the email verified after a Google link", {
            userId: account.userId,
            error: err instanceof Error ? err.name : "unknown",
          });
        }
      },
    },
  },
} satisfies BetterAuthOptions["databaseHooks"];

/** `account` options. See NIW2-219 for each decision. */
export const accountOptions = {
  accountLinking: {
    enabled: true,
    // Only reachable through linkSocial (a signed-in user); implicit linking always matches
    // by email. Google stays OUT of trustedProviders (Q1): its email_verified claim is required.
    allowDifferentEmails: true,
  },
  // Kaipu never calls Google APIs; encrypt the stored access/refresh tokens at rest anyway.
  encryptOAuthTokens: true,
} satisfies BetterAuthOptions["account"];
