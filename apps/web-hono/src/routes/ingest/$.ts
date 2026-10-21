import { createFileRoute } from "@tanstack/react-router";

import { proxyIngest } from "@/lib/ingest-proxy";

export const Route = createFileRoute("/ingest/$")({
  server: {
    handlers: {
      GET: async ({ request }) => proxyIngest(request),
      POST: async ({ request }) => proxyIngest(request),
      OPTIONS: async ({ request }) => proxyIngest(request),
    },
  },
});
