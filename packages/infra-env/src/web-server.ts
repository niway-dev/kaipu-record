import { z } from "zod";

// The web app proxies auth/CORS to the backend and never runs Better Auth, so it
// only needs the DB URL (todos server fn) and the backend URL (proxy + auth-session
// fetch). CORS_ORIGIN / BETTER_AUTH_* live on the server/API schema, not here.
export const webServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  VITE_SERVER_URL: z.string().min(1),
});
