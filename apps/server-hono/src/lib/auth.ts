import { baseConfig, getCustomSession } from "@kaipu/infra-auth";
import { describeEmailFailure, EMAIL_TEMPLATE_VALUES } from "@kaipu/infra-email";
import { betterAuth } from "better-auth";
import { customSession } from "better-auth/plugins";
import { env } from "../env";
import { buildResetUrl, buildVerifyUrl, emailLocale, tryGetEmail, webUrl } from "./email";

// "kaipu-record://app" is the desktop app's own request identity for Better Auth's CSRF
// origin check — not a real URL scheme Electron navigates to. Electron's main process
// (Chromium's network stack) attaches Sec-Fetch-* metadata to outgoing fetch() calls even
// outside a page context, which trips better-auth's form-CSRF check (origin-check.mjs,
// formCsrfMiddleware) on the sign-in/email and sign-up/email routes specifically — those
// requests need a trusted Origin or they're rejected with MISSING_OR_NULL_ORIGIN, even
// though they carry no cookie. See apps/kaipu-record/src/main/services/auth-client.ts,
// which sets this same literal as the Origin header on those two calls. Mirrors the
// existing mobile pattern below (exp://, mobile://), which never needed this because
// React Native's fetch doesn't send Sec-Fetch-* headers.
export const auth = betterAuth({
  ...baseConfig,
  trustedOrigins: [...env.CORS_ORIGIN, "kaipu-record://app"],
  emailAndPassword: {
    ...baseConfig.emailAndPassword,
    enabled: true,
    // Decision 2026-09-15: one-hour, single-use reset link; reset revokes all sessions.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }, request) => {
      const email = tryGetEmail();
      if (!email) {
        // tryGetEmail memoises, so it only warns the first time per isolate.
        // Without this, every later skip is invisible while the caller still
        // gets a 200 and the user waits for an email nobody attempted.
        console.error("password reset email skipped: transactional email is disabled", {
          userId: user.id,
        });
        return;
      }
      try {
        const { id } = await email.sendEmail(EMAIL_TEMPLATE_VALUES.RESET_PASSWORD, user.email, {
          locale: emailLocale(request),
          resetUrl: buildResetUrl(webUrl(), token),
        });
        console.log("password reset email accepted by the provider", {
          userId: user.id,
          providerMessageId: id,
        });
      } catch (err) {
        // Better Auth swallows hook errors and still returns 200 — log loudly.
        // The cause goes in the message, not only in the Error argument: see
        // describeEmailFailure for the log that lost it.
        const { summary, fields } = describeEmailFailure(err);
        console.error(`failed to send the password reset email — ${summary}`, {
          userId: user.id,
          ...fields,
        });
        throw err;
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    // Decision 2026-09-15: verification links last 24 hours.
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, token }, request) => {
      const email = tryGetEmail();
      if (!email) {
        console.error("verification email skipped: transactional email is disabled", {
          userId: user.id,
        });
        return;
      }
      try {
        const { id } = await email.sendEmail(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL, user.email, {
          locale: emailLocale(request),
          verifyUrl: buildVerifyUrl(webUrl(), token),
        });
        console.log("verification email accepted by the provider", {
          userId: user.id,
          providerMessageId: id,
        });
      } catch (err) {
        const { summary, fields } = describeEmailFailure(err);
        console.error(`failed to send the verification email — ${summary}`, {
          userId: user.id,
          ...fields,
        });
        throw err;
      }
    },
  },
  // Account deletion is NOT Better Auth's `deleteUser` (decision 2026-10-10): it is a soft delete
  // with a 7-day grace period, served by `/api/v1/me/account-deletion` (modules/me) and finished
  // by the cron (cloud/run-cloud-sweep.ts). Better Auth's immediate delete stays disabled.
  plugins: [...(baseConfig.plugins ?? []), customSession(getCustomSession, baseConfig)],
});
