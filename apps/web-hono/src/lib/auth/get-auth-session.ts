import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { env } from "@/env/server";
import { apiFetch } from "@/lib/api-fetch";
import type { AuthSession } from "./types";

export const getAuthSession = createServerFn({ method: "GET" }).handler(
  async (): Promise<AuthSession | null> => {
    const headers = getRequestHeaders();
    const cookie = headers.get("cookie") ?? "";

    if (!cookie) return null;

    // The API keys its rate limits and session metadata on cf-connecting-ip (set by the
    // Cloudflare edge on the request that reached this Worker). A server-side fetch carries
    // none of the browser's headers, so pass the client address on explicitly: without it the
    // API would count every SSR session check in one shared bucket.
    const clientIp = headers.get("cf-connecting-ip");

    try {
      const response = await apiFetch(`${env.VITE_SERVER_URL}/api/auth/get-session`, {
        headers: { cookie, ...(clientIp ? { "cf-connecting-ip": clientIp } : {}) },
      });

      if (!response.ok) return null;

      const data = await response.json();
      return data as AuthSession;
    } catch (error) {
      console.error("[auth] Failed to get session:", error);
      return null;
    }
  },
);
