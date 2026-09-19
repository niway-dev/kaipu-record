import { env } from "cloudflare:workers";
import { createServiceFetch, createProxyHandler } from "@kaipu/infra-cloudflare";

export function consoleConfig() {
  // Worker bindings in production; Wrangler loads local .env values during development.
  const config = env as unknown as Record<string, unknown>;
  const local = process.env as Record<string, string | undefined>;
  return {
    databaseUrl: String(config.DATABASE_URL ?? local.DATABASE_URL ?? ""),
    adminIds: String(config.CONSOLE_ADMIN_USER_IDS ?? local.CONSOLE_ADMIN_USER_IDS ?? ""),
    apiUrl: String(config.CONSOLE_API_URL ?? local.CONSOLE_API_URL ?? "http://localhost:3000"),
    environment: String(config.CONSOLE_ENVIRONMENT ?? local.CONSOLE_ENVIRONMENT ?? "Unspecified"),
  };
}

export const apiFetch = createServiceFetch(() => env.API_SERVICE);

export async function proxyAuth(request: Request) {
  const path = new URL(request.url).pathname;
  // Console is not a second signup or general-purpose API surface.
  const allowed = new Set([
    "/api/auth/sign-in/email",
    "/api/auth/sign-out",
    "/api/auth/get-session",
  ]);
  if (!allowed.has(path)) return new Response("Not found", { status: 404 });
  const response = await createProxyHandler({
    backendUrl: consoleConfig().apiUrl,
    fetchFn: apiFetch,
    forwardedHeaders: true,
    logPrefix: "console-auth",
  })(request);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
