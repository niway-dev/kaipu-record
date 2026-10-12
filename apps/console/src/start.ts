import { createMiddleware, createStart } from "@tanstack/react-start";
import { withSecurityHeaders } from "@kaipu/infra-cloudflare";

const securityHeaders = createMiddleware({ type: "request" }).server(async ({ next }) => {
  const result = await next();
  return { ...result, response: withSecurityHeaders(result.response) };
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeaders],
}));
