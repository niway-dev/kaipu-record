import { z } from "zod";

// The web app proxies auth/CORS to the backend and never runs Better Auth or touches the
// database, so it only needs the backend URL (proxy + auth-session fetch).
// CORS_ORIGIN / BETTER_AUTH_* / DATABASE_URL live on the server/API schema, not here.
export const webServerEnvSchema = z.object({
  VITE_SERVER_URL: z.string().min(1),
});
