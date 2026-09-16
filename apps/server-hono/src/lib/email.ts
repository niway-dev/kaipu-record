/**
 * Lazy transactional email singleton — mirrors lib/storage.ts: the Worker boots
 * without RESEND_API_KEY, and send hooks become logged no-ops.
 */
import { EmailService, ResendEmailProvider } from "@kaipu/infra-email";

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
  service = new EmailService(
    new ResendEmailProvider(env.RESEND_API_KEY),
    env.AUTH_EMAIL_FROM ?? DEFAULT_FROM,
    { replyTo: REPLY_TO },
  );
  return service;
}

export function webUrl(): string {
  return (env.PUBLIC_WEB_URL ?? "https://kaipu.app").replace(/\/$/, "");
}
