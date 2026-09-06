import { z } from "zod";

// The web app proxies auth/CORS to the backend and never runs Better Auth, so it
// only needs the backend URL (proxy + auth-session fetch). DATABASE_URL is still
// required by the Worker's declared vars but no longer read by any server fn —
// drop it here and from wrangler/CI once the deploy config is updated together.
// CORS_ORIGIN / BETTER_AUTH_* live on the server/API schema, not here.
export const webServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  VITE_SERVER_URL: z.string().min(1),
});
