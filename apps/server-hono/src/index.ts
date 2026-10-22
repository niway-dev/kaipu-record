import { Hono } from "hono";
import { cors } from "hono/cors";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { auth } from "./lib/auth";
import { env } from "./env";
import { isRequestAllowed } from "./middleware/csrf";
import { appRouter } from "./router";

const app = new Hono();

// CORS only needed for mobile apps — web requests come through
// the web Worker proxy via Service Bindings (same-origin, no CORS needed)
app.use(
  "*",
  cors({
    origin: ["exp://", "mobile://", "exp://*"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    credentials: true,
    maxAge: 86400,
  }),
);

// Better Auth handler
app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

// Health endpoint
app.get("/api/v1/health", (c) =>
  c.json({ status: "healthy", timestamp: new Date().toISOString() }),
);

// oRPC OpenAPIHandler — REST-style URLs at /api/v1/*
const openAPIHandler = new OpenAPIHandler(appRouter);

// Cookie-authenticated writes must come from our own origins (CSRF, audit F-7). Bearer-token
// clients (desktop) send no cookie and pass through. CORS_ORIGIN is what Better Auth trusts on
// /api/auth/* (production: the apex only; www.kaipu.app is a 301 at the Cloudflare edge), so a
// host that can sign in can also write; PUBLIC_WEB_URL and BETTER_AUTH_URL are added for the
// environments where they differ from it.
const allowedOrigins = [
  ...env.CORS_ORIGIN,
  ...(env.PUBLIC_WEB_URL ? [env.PUBLIC_WEB_URL] : []),
  ...(env.BETTER_AUTH_URL ? [env.BETTER_AUTH_URL] : []),
];

app.all("/api/v1/*", async (c) => {
  if (!isRequestAllowed(c.req.raw, { allowedOrigins })) {
    return c.json({ error: "Cross-site request rejected" }, 403);
  }

  const { matched, response } = await openAPIHandler.handle(c.req.raw, {
    prefix: "/api/v1",
    context: { headers: c.req.raw.headers },
  });

  if (matched) return response;
  return c.notFound();
});

export default app;
