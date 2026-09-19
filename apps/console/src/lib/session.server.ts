import { getRequestHeaders, setResponseHeader } from "@tanstack/react-start/server";
import { apiFetch, consoleConfig } from "./backend.server";
import { isConsoleAdmin } from "./access";

export async function requireConsoleAdmin() {
  setResponseHeader("Cache-Control", "private, no-store");
  const config = consoleConfig();
  if (!config.adminIds.trim()) return { status: "forbidden" as const };
  const cookie = getRequestHeaders().get("cookie");
  if (!cookie) return { status: "unauthorized" as const };
  const response = await apiFetch(`${config.apiUrl}/api/auth/get-session?disableCookieCache=true`, {
    headers: { cookie },
  });
  if (!response.ok) throw new Error("Authentication service unavailable. Try again.");
  const session = (await response.json()) as { user?: { id?: string; name?: string } } | null;
  if (!session?.user?.id) return { status: "unauthorized" as const };
  if (!isConsoleAdmin(session.user.id, config.adminIds)) return { status: "forbidden" as const };
  return {
    status: "authorized" as const,
    name: session.user.name ?? "Operator",
    environment: config.environment,
  };
}
