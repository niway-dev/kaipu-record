import { z } from "zod";
import { commaSeparatedList } from "./transforms";

export const serverEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: commaSeparatedList,
  BETTER_AUTH_SECRET: z.string().min(1),
  // Cloudflare R2 (S3-compatible) credentials for cloud recordings. Optional so
  // the API still boots without cloud storage configured — the recording
  // endpoints report "not configured" until these are set as Worker secrets.
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().optional(),
});
