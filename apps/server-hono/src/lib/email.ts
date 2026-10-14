/**
 * Lazy transactional email singleton — mirrors lib/storage.ts: the Worker boots
 * without RESEND_API_KEY, and send hooks become logged no-ops.
 */
import { type EmailLocale, EmailService, ResendEmailProvider } from "@kaipu/infra-email";

import { env } from "../env";

export { buildResetUrl, buildVerifyUrl } from "./email-links";

const DEFAULT_FROM = "Kaipu <no-reply-kaipu@updates.niway.dev>";
const REPLY_TO = "contacto@niway.dev";

let service: EmailService | null | undefined;

export function tryGetEmail(): EmailService | null {
  if (service !== undefined) return service;
  if (!env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY is not set; transactional email is disabled.");
    service = null;
    return service;
  }
  const from = env.AUTH_EMAIL_FROM ?? DEFAULT_FROM;
  // Announce the sender once per isolate. An unverified sending domain is the
  // most common reason a provider rejects a message, and AUTH_EMAIL_FROM is
  // optional — so which address is actually in use, and whether it came from
  // configuration or the fallback, is the first thing an incident needs.
  console.log("transactional email enabled", {
    from,
    fromSource: env.AUTH_EMAIL_FROM ? "AUTH_EMAIL_FROM" : "default",
  });
  service = new EmailService(new ResendEmailProvider(env.RESEND_API_KEY), from, {
    replyTo: REPLY_TO,
  });
  return service;
}

export function webUrl(): string {
  return (env.PUBLIC_WEB_URL ?? "https://kaipu.app").replace(/\/$/, "");
}

/** Best-effort locale from Accept-Language; English is the documented fallback. */
export function emailLocale(request?: Request | { headers: Headers }): EmailLocale {
  const header = request?.headers.get("accept-language") ?? "";
  return header.toLowerCase().startsWith("es") ? "es" : "en";
}

export function toEmailLocale(locale: string): EmailLocale {
  return locale === "es" ? "es" : "en";
}
