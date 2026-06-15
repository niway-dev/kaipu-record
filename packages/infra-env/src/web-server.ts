import { z } from "zod";
import { commaSeparatedList } from "./transforms";

export const webServerEnvSchema = z.object({
  DATABASE_URL: z.string().min(1),
  CORS_ORIGIN: commaSeparatedList,
  BETTER_AUTH_SECRET: z.string().min(1),
  BETTER_AUTH_URL: z.string().min(1),
  VITE_SERVER_URL: z.string().min(1),
});
