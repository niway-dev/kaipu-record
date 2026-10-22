import { z } from "zod";
import { commaSeparatedList } from "./transforms";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: commaSeparatedList,
  // Signs session cookies and bearer tokens. Better Auth only warns below 32 characters;
  // the schema refuses to boot with a weaker secret (audit F-11).
  BETTER_AUTH_SECRET: z.string().min(32, "BETTER_AUTH_SECRET must be at least 32 characters"),
  /**
   * Public origin Better Auth builds OAuth redirect URIs from. It must be the WEB
   * origin (http://localhost:3001 in dev, https://kaipu.app in prod), not the API:
   * the web Worker proxies /api/auth/*, and the OAuth state cookie lives on the web
   * origin. No trailing slash. Optional so the API still boots without it.
   */
  BETTER_AUTH_URL: z
    .string()
    .url()
    .refine((value) => !value.endsWith("/"), "BETTER_AUTH_URL must not end with a slash")
    .optional(),
  // Google OAuth client (sign in with Google). Optional so the API still boots
  // without it; Google is simply not registered until BOTH values are set.
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Cloudflare R2 (S3-compatible) credentials for cloud recordings. Optional so
  // the API still boots without cloud storage configured — the recording
  // endpoints report "not configured" until these are set as Worker secrets.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
  // Transactional email (Resend). Optional so the API still boots without
  // email configured — send hooks log an error and skip instead of crashing.
  RESEND_API_KEY: z.string().optional(),
  /** Sender identity; defaults to the Niway convention when unset. */
  AUTH_EMAIL_FROM: z.string().optional(),
  /** Public web origin used to build email links; defaults to https://kaipu.app. */
  PUBLIC_WEB_URL: z.string().optional(),
});
