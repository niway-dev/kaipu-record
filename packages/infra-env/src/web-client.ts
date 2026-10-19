import { z } from "zod";

export const webClientEnvSchema = z.object({
  VITE_SERVER_URL: z.url(),
  /** "true" shows "Continue with Google"; anything else hides it (NIW2-219). */
  VITE_GOOGLE_AUTH_ENABLED: z.enum(["true", "false"]).optional(),
});
