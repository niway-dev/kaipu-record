import { baseConfig, getCustomSession } from "@kaipu/infra-auth";
import { betterAuth } from "better-auth";
import { customSession } from "better-auth/plugins";
import { env } from "../env";

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
  plugins: [...(baseConfig.plugins ?? []), customSession(getCustomSession, baseConfig)],
});
