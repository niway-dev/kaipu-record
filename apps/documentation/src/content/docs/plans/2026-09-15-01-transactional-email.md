---
title: "Plan 01 — Transactional email (Resend + verification + password reset)"
description: "Implementation plan for @kaipu/infra-email, Better Auth email verification and web password recovery."
---

# Transactional Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real email verification and password recovery for Kaipu accounts, sent through Resend from a new `@kaipu/infra-email` package.

**Architecture:** A new infra package following the Rakoi infra-email pattern (typed template registry, JSX rendered to HTML + plain text, swappable `IEmailProvider`, Resend adapter). Better Auth hooks are wired at the server composition boundary (`apps/server-hono/src/lib/auth.ts`), never inside `packages/infra-auth`'s shared `baseConfig`. Verification and reset links land on the web app (`kaipu.app`), which proxies `/api/auth/*` to the API via its existing catch-all proxy. Desktop opens the web for password recovery; there is no desktop deep link.

**Tech Stack:** Bun workspaces, TypeScript, Zod, Better Auth 1.4.18, Resend SDK ^4, @react-email/components + @react-email/render, use-intl (via `@kaipu/i18n`), Vitest, TanStack Start (web), Cloudflare Workers.

**Spec:** `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` (Decision 2 and the email flow paragraph) and the pattern docs in general-knowledge: `packages/transactional-email-playbook.md`, `packages/transactional-email-package.md`, `infra/transactional-email.md`.

## Global Constraints

- All artifacts in English (code, comments, commits, docs). Localized email copy (es/en) lives ONLY in `packages/i18n/messages/{en,es}.json`; both files must stay key-parallel (a parity test at `packages/i18n/src/__tests__/parity.test.ts` enforces this).
- Sender: `Kaipu <no-reply-kaipu@updates.niway.dev>`. Reply-To: `contacto@niway.dev`. Never invent another sender.
- Verification links: valid **24 hours**. Reset links: valid **1 hour**, single use; a successful reset revokes all sessions.
- No manual verification path of any kind: no `plan verify` command, no operator button. Do not add one.
- The API must keep booting when `RESEND_API_KEY` is unset (like the R2 variables): email becomes a logged no-op, never a crash.
- Better Auth wraps send hooks in a background runner that **catches errors and returns 200 anyway** (verified in Ripuy). Every send hook must `console.error` loudly on failure before rethrowing.
- Layering: `domain` and `application` never import React or Resend. `@kaipu/infra-email` may import `@kaipu/i18n`.
- Lint/format: `bun run lint` (oxlint) and `bun run format` (oxfmt) from the repo root. Tests: Vitest per workspace.
- Better Auth 1.4 API names: `emailVerification.sendVerificationEmail`, `emailVerification.sendOnSignUp`, `emailVerification.expiresIn`, `emailAndPassword.sendResetPassword`, `emailAndPassword.resetPasswordTokenExpiresIn`, `emailAndPassword.revokeSessionsOnPasswordReset`; client methods `authClient.requestPasswordReset`, `authClient.resetPassword`, `authClient.sendVerificationEmail`. If a name does not typecheck against `better-auth@1.4.18`, check `node_modules/better-auth/dist/index.d.ts` for the 1.4 spelling before improvising.

## File Structure

```
packages/infra-email/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    index.ts                          # public surface
    email-service.ts                  # render + delegate to provider
    providers/email-provider.interface.ts
    providers/resend.provider.ts
    templates/types.ts                # EMAIL_TEMPLATE_VALUES + TemplateDataMap
    templates/index.ts                # EmailTemplateMap registry
    templates/i18n.ts                 # emailT(locale) translator helper
    templates/layout.tsx              # shared shell (body, footer)
    templates/verify-email.tsx
    templates/reset-password.tsx
    templates/expansion-approved.tsx  # used by plan 03; template ships here
    __tests__/email-service.test.ts
    __tests__/templates.test.ts
packages/i18n/messages/{en,es}.json   # + "emails" namespace, + auth.forgotPassword keys
packages/infra-env/src/server.ts      # + RESEND_API_KEY, AUTH_EMAIL_FROM, PUBLIC_WEB_URL
apps/server-hono/src/lib/email.ts     # lazy EmailService singleton (mirrors lib/storage.ts)
apps/server-hono/src/lib/auth.ts      # + emailVerification / sendResetPassword wiring
apps/web-hono/src/routes/auth/forgot-password.tsx
apps/web-hono/src/routes/auth/reset-password.tsx
apps/web-hono/src/routes/auth/email-verified.tsx
apps/web-hono/src/routes/auth/login.tsx           # + forgot-password link
apps/kaipu-record/src/renderer/src/features/auth/auth-form.tsx  # + forgot-password link
.github/workflows/release-api.yml     # + RESEND_API_KEY (+ AUTH_EMAIL_FROM, PUBLIC_WEB_URL) secrets
```

---

### Task 1: Package scaffold, provider port, Resend adapter

**Files:**

- Create: `packages/infra-email/package.json`, `packages/infra-email/tsconfig.json`, `packages/infra-email/vitest.config.ts`
- Create: `packages/infra-email/src/providers/email-provider.interface.ts`
- Create: `packages/infra-email/src/providers/resend.provider.ts`

**Interfaces:**

- Produces: `EmailMessage { to, from, replyTo?, subject, html, text }`, `IEmailProvider { send(message): Promise<void> }`, `class ResendEmailProvider implements IEmailProvider` with `constructor(apiKey: string)`.

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@kaipu/infra-email",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./package.json": "./package.json"
  },
  "scripts": {
    "check-types": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@kaipu/i18n": "workspace:*",
    "@react-email/components": "^0.0.36",
    "@react-email/render": "^1.0.5",
    "react": "19.2.3",
    "resend": "^4.0.0"
  },
  "devDependencies": {
    "@types/react": "19.2.7",
    "typescript": "catalog:",
    "vitest": "^4.1.9"
  }
}
```

- [ ] **Step 2: Create tsconfig.json** (copy `packages/infra-auth/tsconfig.json` as the base, then ensure these compiler options):

```json
{
  "compilerOptions": {
    "jsx": "react-jsx",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create vitest.config.ts**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["src/**/*.test.ts", "src/__tests__/**/*.test.ts"] },
});
```

- [ ] **Step 4: Write the provider port** (`src/providers/email-provider.interface.ts`)

```ts
export interface EmailMessage {
  to: string;
  from: string;
  /** Optional Reply-To; Kaipu uses the Niway public contact for support replies. */
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
}

export interface IEmailProvider {
  send(message: EmailMessage): Promise<void>;
}
```

- [ ] **Step 5: Write the Resend adapter** (`src/providers/resend.provider.ts`)

```ts
import { Resend } from "resend";
import type { EmailMessage, IEmailProvider } from "./email-provider.interface";

export class ResendEmailProvider implements IEmailProvider {
  private readonly client: Resend;

  constructor(apiKey: string) {
    this.client = new Resend(apiKey);
  }

  async send(message: EmailMessage): Promise<void> {
    const { error } = await this.client.emails.send({
      from: message.from,
      to: message.to,
      replyTo: message.replyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    if (error) {
      throw new Error(`Resend error: ${error.message}`);
    }
  }
}
```

If `replyTo` does not typecheck against resend@4, the field is `reply_to` in older minors — check `node_modules/resend/dist` types and use the spelling the installed version exports.

- [ ] **Step 6: Install and typecheck**

Run: `bun install && bun run --filter @kaipu/infra-email check-types`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add packages/infra-email bun.lock
git commit -m "feat(email): scaffold @kaipu/infra-email with provider port and Resend adapter"
```

---

### Task 2: Email copy in i18n (en/es)

**Files:**

- Modify: `packages/i18n/messages/en.json`
- Modify: `packages/i18n/messages/es.json`

**Interfaces:**

- Produces: an `emails` top-level namespace with the exact keys below; Task 3's templates call `t("verifySubject")` etc. through a translator with `namespace: "emails"`.

- [ ] **Step 1: Add the `emails` namespace to `en.json`** (top level, alphabetical siblings don't matter — match the file's existing ordering style):

```json
"emails": {
  "footer": "Kaipu — a Niway product",
  "verifySubject": "Verify your Kaipu email",
  "verifyPreview": "Confirm this email address to finish setting up your Kaipu account.",
  "verifyHeading": "Confirm your email",
  "verifyBody": "Click the button below to verify this email address for your Kaipu account. The link is valid for 24 hours.",
  "verifyButton": "Verify email",
  "verifyIgnore": "If you didn't create a Kaipu account, you can ignore this email.",
  "resetSubject": "Reset your Kaipu password",
  "resetPreview": "Choose a new password for your Kaipu account.",
  "resetHeading": "Reset your password",
  "resetBody": "Open the link below to choose a new password. It expires in one hour and can only be used once. Resetting your password signs you out of every device.",
  "resetButton": "Choose a new password",
  "resetIgnore": "If you didn't ask for a new password, you can ignore this email — nothing changes until the link is opened.",
  "approvedSubject": "Your Kaipu Cloud space is now {capacity}",
  "approvedPreview": "Your request for more Kaipu Cloud space was approved.",
  "approvedHeading": "You have more Cloud space",
  "approvedBody": "Your request was approved. Your account now has {capacity} of total Kaipu Cloud space.",
  "approvedButton": "Open Kaipu"
}
```

- [ ] **Step 2: Add the same keys to `es.json`** with this Spanish copy:

```json
"emails": {
  "footer": "Kaipu — un producto de Niway",
  "verifySubject": "Verifica tu correo de Kaipu",
  "verifyPreview": "Confirma esta dirección para terminar de configurar tu cuenta de Kaipu.",
  "verifyHeading": "Confirma tu correo",
  "verifyBody": "Haz clic en el botón para verificar esta dirección de correo de tu cuenta de Kaipu. El enlace es válido por 24 horas.",
  "verifyButton": "Verificar correo",
  "verifyIgnore": "Si no creaste una cuenta de Kaipu, puedes ignorar este correo.",
  "resetSubject": "Restablece tu contraseña de Kaipu",
  "resetPreview": "Elige una nueva contraseña para tu cuenta de Kaipu.",
  "resetHeading": "Restablece tu contraseña",
  "resetBody": "Abre el enlace para elegir una nueva contraseña. Expira en una hora y solo puede usarse una vez. Al restablecerla se cierran las sesiones en todos tus dispositivos.",
  "resetButton": "Elegir nueva contraseña",
  "resetIgnore": "Si no pediste una nueva contraseña, puedes ignorar este correo: nada cambia hasta abrir el enlace.",
  "approvedSubject": "Tu espacio en Kaipu Cloud ahora es de {capacity}",
  "approvedPreview": "Tu solicitud de más espacio en Kaipu Cloud fue aprobada.",
  "approvedHeading": "Tienes más espacio en Cloud",
  "approvedBody": "Tu solicitud fue aprobada. Tu cuenta ahora tiene {capacity} de espacio total en Kaipu Cloud.",
  "approvedButton": "Abrir Kaipu"
}
```

- [ ] **Step 3: Run the parity test**

Run: `bun run --filter @kaipu/i18n test`
Expected: PASS (both catalogs stay key-parallel).

- [ ] **Step 4: Commit**

```bash
git add packages/i18n/messages/en.json packages/i18n/messages/es.json
git commit -m "feat(i18n): add transactional email copy (verify, reset, expansion approved)"
```

---

### Task 3: Templates, registry, and EmailService

**Files:**

- Create: `packages/infra-email/src/templates/i18n.ts`, `templates/layout.tsx`, `templates/verify-email.tsx`, `templates/reset-password.tsx`, `templates/expansion-approved.tsx`, `templates/types.ts`, `templates/index.ts`
- Create: `packages/infra-email/src/email-service.ts`, `packages/infra-email/src/index.ts`
- Test: `packages/infra-email/src/__tests__/templates.test.ts`, `packages/infra-email/src/__tests__/email-service.test.ts`

**Interfaces:**

- Consumes: `IEmailProvider`, `EmailMessage` (Task 1); the `emails` i18n namespace (Task 2).
- Produces:
  - `type EmailLocale = "en" | "es"`
  - `EMAIL_TEMPLATE_VALUES = { VERIFY_EMAIL, RESET_PASSWORD, EXPANSION_APPROVED }`
  - `TemplateDataMap`: `VERIFY_EMAIL → { locale: EmailLocale; verifyUrl: string }`; `RESET_PASSWORD → { locale: EmailLocale; resetUrl: string }`; `EXPANSION_APPROVED → { locale: EmailLocale; capacityLabel: string; openUrl: string }`
  - `class EmailService { constructor(provider: IEmailProvider, from: string, options?: { replyTo?: string }); sendEmail<T extends EmailTemplate>(template: T, to: string, data: TemplateDataMap[T]): Promise<void> }`
  - Server code (Task 5) and plan 03/04 consume `EmailService`, `ResendEmailProvider`, `EMAIL_TEMPLATE_VALUES`.

- [ ] **Step 1: Write the failing template test** (`src/__tests__/templates.test.ts`)

```ts
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import { EmailTemplateMap, EMAIL_TEMPLATE_VALUES } from "../templates/index";

describe("email templates", () => {
  it("renders the verification email in both locales with the link", async () => {
    for (const locale of ["en", "es"] as const) {
      const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL];
      const data = { locale, verifyUrl: "https://kaipu.app/api/auth/verify-email?token=abc" };
      expect(entry.subject(data)).toBeTruthy();
      const html = await render(entry.component(data));
      const text = await render(entry.component(data), { plainText: true });
      expect(html).toContain("https://kaipu.app/api/auth/verify-email?token=abc");
      expect(text).toContain("https://kaipu.app/api/auth/verify-email?token=abc");
    }
  });

  it("renders the reset email with the one-hour link", async () => {
    const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.RESET_PASSWORD];
    const data = { locale: "en" as const, resetUrl: "https://kaipu.app/auth/reset-password?token=xyz" };
    const html = await render(entry.component(data));
    expect(html).toContain("https://kaipu.app/auth/reset-password?token=xyz");
    expect(entry.subject(data)).toContain("password");
  });

  it("renders the expansion-approved email with the capacity", async () => {
    const entry = EmailTemplateMap[EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED];
    const data = { locale: "es" as const, capacityLabel: "1 GB", openUrl: "https://kaipu.app" };
    expect(entry.subject(data)).toContain("1 GB");
    const html = await render(entry.component(data));
    expect(html).toContain("1 GB");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `bun run --filter @kaipu/infra-email test`
Expected: FAIL (modules not found).

- [ ] **Step 3: Write the translator helper** (`src/templates/i18n.ts`)

```ts
import { createTranslator } from "@kaipu/i18n";
import en from "@kaipu/i18n/messages/en";
import es from "@kaipu/i18n/messages/es";

export type EmailLocale = "en" | "es";

/** Namespaced translator for email copy. Fallback locale is English. */
export function emailT(locale: EmailLocale) {
  return createTranslator({
    locale,
    messages: locale === "es" ? es : en,
    namespace: "emails",
  });
}
```

If `@kaipu/i18n` does not re-export `createTranslator` or the `messages/*` subpaths, add them to `packages/i18n/package.json` `exports` / `packages/i18n/src/index.ts` (the web app already imports `@kaipu/i18n/messages/es`, so the message subpaths exist; `createTranslator` is re-exported per `packages/i18n/src/index.ts`).

- [ ] **Step 4: Write the shared layout** (`src/templates/layout.tsx`)

```tsx
import { Body, Container, Head, Hr, Html, Preview, Text } from "@react-email/components";
import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";

export function EmailLayout(props: {
  locale: EmailLocale;
  preview: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const t = emailT(props.locale);
  return (
    <Html lang={props.locale}>
      <Head />
      <Preview>{props.preview}</Preview>
      <Body style={{ margin: 0, padding: "24px", backgroundColor: "#f6f7f6", fontFamily: "sans-serif" }}>
        <Container style={{ maxWidth: "480px", margin: "0 auto", backgroundColor: "#ffffff", borderRadius: "8px", padding: "32px" }}>
          {props.children}
          <Hr style={{ margin: "24px 0", borderColor: "#e5e5e5" }} />
          <Text style={{ fontSize: "12px", color: "#8a8a8a", margin: 0 }}>{t("footer")}</Text>
        </Container>
      </Body>
    </Html>
  );
}
```

- [ ] **Step 5: Write the three templates.** `src/templates/verify-email.tsx`:

```tsx
import { Button, Heading, Text } from "@react-email/components";
import type { EmailLocale } from "./i18n";
import { emailT } from "./i18n";
import { EmailLayout } from "./layout";

export interface VerifyEmailData {
  locale: EmailLocale;
  verifyUrl: string;
}

const button = {
  backgroundColor: "#f6055c",
  borderRadius: "6px",
  color: "#ffffff",
  padding: "12px 20px",
  fontSize: "14px",
  textDecoration: "none",
} as const;

export function VerifyEmail(data: VerifyEmailData): React.JSX.Element {
  const t = emailT(data.locale);
  return (
    <EmailLayout locale={data.locale} preview={t("verifyPreview")}>
      <Heading as="h1" style={{ fontSize: "20px", margin: "0 0 12px" }}>{t("verifyHeading")}</Heading>
      <Text style={{ fontSize: "14px", lineHeight: "22px" }}>{t("verifyBody")}</Text>
      <Button href={data.verifyUrl} style={button}>{t("verifyButton")}</Button>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{data.verifyUrl}</Text>
      <Text style={{ fontSize: "12px", color: "#8a8a8a" }}>{t("verifyIgnore")}</Text>
    </EmailLayout>
  );
}
```

`src/templates/reset-password.tsx` — identical shape with `ResetPasswordData { locale; resetUrl }`, keys `resetPreview/resetHeading/resetBody/resetButton/resetIgnore`, `href={data.resetUrl}`, and the raw URL line printing `data.resetUrl`.

`src/templates/expansion-approved.tsx` — `ExpansionApprovedData { locale; capacityLabel; openUrl }`, keys `approvedPreview/approvedHeading/approvedButton`, body via `t("approvedBody", { capacity: data.capacityLabel })`, `href={data.openUrl}`. (Interpolated keys use use-intl's `{capacity}` placeholder — call `t(key, values)`.)

- [ ] **Step 6: Write the registry** (`src/templates/types.ts` and `src/templates/index.ts`)

`types.ts`:

```ts
import type { ExpansionApprovedData } from "./expansion-approved";
import type { ResetPasswordData } from "./reset-password";
import type { VerifyEmailData } from "./verify-email";

export const EMAIL_TEMPLATE_VALUES = {
  VERIFY_EMAIL: "VERIFY_EMAIL",
  RESET_PASSWORD: "RESET_PASSWORD",
  EXPANSION_APPROVED: "EXPANSION_APPROVED",
} as const;

export type EmailTemplate = (typeof EMAIL_TEMPLATE_VALUES)[keyof typeof EMAIL_TEMPLATE_VALUES];

export type TemplateDataMap = {
  [EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL]: VerifyEmailData;
  [EMAIL_TEMPLATE_VALUES.RESET_PASSWORD]: ResetPasswordData;
  [EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED]: ExpansionApprovedData;
};
```

`index.ts`:

```ts
import { emailT } from "./i18n";
import { ExpansionApprovedEmail } from "./expansion-approved";
import { ResetPasswordEmail } from "./reset-password";
import { VerifyEmail } from "./verify-email";
import { EMAIL_TEMPLATE_VALUES, type EmailTemplate, type TemplateDataMap } from "./types";

export const EmailTemplateMap: {
  [K in EmailTemplate]: {
    subject: (data: TemplateDataMap[K]) => string;
    component: (data: TemplateDataMap[K]) => React.JSX.Element;
  };
} = {
  [EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL]: {
    subject: (d) => emailT(d.locale)("verifySubject"),
    component: VerifyEmail,
  },
  [EMAIL_TEMPLATE_VALUES.RESET_PASSWORD]: {
    subject: (d) => emailT(d.locale)("resetSubject"),
    component: ResetPasswordEmail,
  },
  [EMAIL_TEMPLATE_VALUES.EXPANSION_APPROVED]: {
    subject: (d) => emailT(d.locale)("approvedSubject", { capacity: d.capacityLabel }),
    component: ExpansionApprovedEmail,
  },
};

export { EMAIL_TEMPLATE_VALUES };
export type { EmailTemplate, TemplateDataMap };
```

- [ ] **Step 7: Write the failing service test** (`src/__tests__/email-service.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { EmailService } from "../email-service";
import type { EmailMessage, IEmailProvider } from "../providers/email-provider.interface";
import { EMAIL_TEMPLATE_VALUES } from "../templates/index";

function makeFakeProvider(): IEmailProvider & { sent: EmailMessage[] } {
  return {
    sent: [],
    async send(message) {
      this.sent.push(message);
    },
  };
}

describe("EmailService", () => {
  it("renders the template to html and plain text and sends via the provider", async () => {
    const provider = makeFakeProvider();
    const service = new EmailService(provider, "Kaipu <no-reply-kaipu@updates.niway.dev>", {
      replyTo: "contacto@niway.dev",
    });
    await service.sendEmail(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL, "me@example.com", {
      locale: "en",
      verifyUrl: "https://kaipu.app/api/auth/verify-email?token=abc",
    });
    expect(provider.sent).toHaveLength(1);
    const message = provider.sent[0]!;
    expect(message.to).toBe("me@example.com");
    expect(message.from).toBe("Kaipu <no-reply-kaipu@updates.niway.dev>");
    expect(message.replyTo).toBe("contacto@niway.dev");
    expect(message.subject).toBe("Verify your Kaipu email");
    expect(message.html).toContain("token=abc");
    expect(message.text).toContain("token=abc");
  });
});
```

- [ ] **Step 8: Write the service and the public index**

`src/email-service.ts`:

```ts
import { render } from "@react-email/render";

import type { EmailMessage, IEmailProvider } from "./providers/email-provider.interface";
import { EmailTemplateMap } from "./templates/index";
import type { EmailTemplate, TemplateDataMap } from "./templates/types";

export class EmailService {
  constructor(
    private readonly provider: IEmailProvider,
    private readonly from: string,
    private readonly options: { replyTo?: string } = {},
  ) {}

  async sendEmail<T extends EmailTemplate>(
    template: T,
    to: string,
    data: TemplateDataMap[T],
  ): Promise<void> {
    const entry = EmailTemplateMap[template];
    const subject = entry.subject(data);
    const [html, text] = await Promise.all([
      render(entry.component(data)),
      render(entry.component(data), { plainText: true }),
    ]);
    const message: EmailMessage = { to, from: this.from, subject, html, text };
    if (this.options.replyTo) message.replyTo = this.options.replyTo;
    await this.provider.send(message);
  }
}
```

`src/index.ts`:

```ts
export type { EmailMessage, IEmailProvider } from "./providers/email-provider.interface";
export { ResendEmailProvider } from "./providers/resend.provider";
export { EmailService } from "./email-service";
export { EmailTemplateMap, EMAIL_TEMPLATE_VALUES } from "./templates/index";
export type { EmailTemplate, TemplateDataMap } from "./templates/types";
export type { EmailLocale } from "./templates/i18n";
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `bun run --filter @kaipu/infra-email test`
Expected: PASS (all suites).

- [ ] **Step 10: Commit**

```bash
git add packages/infra-email
git commit -m "feat(email): typed templates, registry and EmailService for Kaipu transactional mail"
```

---

### Task 4: Server env variables

**Files:**

- Modify: `packages/infra-env/src/server.ts`
- Modify: `.github/workflows/release-api.yml`

**Interfaces:**

- Produces: `env.RESEND_API_KEY?: string`, `env.AUTH_EMAIL_FROM?: string`, `env.PUBLIC_WEB_URL?: string` on the parsed server env.

- [ ] **Step 1: Extend the schema.** In `packages/infra-env/src/server.ts`, after the R2 block add:

```ts
  // Transactional email (Resend). Optional so the API still boots without email
  // configured — send hooks log an error and skip instead of crashing.
  RESEND_API_KEY: z.string().optional(),
  /** Sender identity; defaults to the Niway convention when unset. */
  AUTH_EMAIL_FROM: z.string().optional(),
  /** Public web origin used to build email links; defaults to https://kaipu.app. */
  PUBLIC_WEB_URL: z.string().optional(),
```

- [ ] **Step 2: Pass the secret on deploy.** In `.github/workflows/release-api.yml`, in the wrangler-action `secrets:` list (it already maps `R2_*` entries), add `RESEND_API_KEY` mapped from `secrets.RESEND_API_KEY` with a one-line comment, following the exact style of the existing R2 entries. `AUTH_EMAIL_FROM` and `PUBLIC_WEB_URL` have safe defaults in code; only add them to the workflow if the repository already passes non-secret vars there (do not invent a new mechanism).

- [ ] **Step 3: Typecheck**

Run: `bun run --filter @kaipu/infra-env check-types && bun run --filter server-hono check-types` (use the actual workspace package name from `apps/server-hono/package.json` if it differs).
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add packages/infra-env .github/workflows/release-api.yml
git commit -m "feat(env): RESEND_API_KEY, AUTH_EMAIL_FROM and PUBLIC_WEB_URL for the API worker"
```

---

### Task 5: Wire Better Auth hooks in server-hono

**Files:**

- Create: `apps/server-hono/src/lib/email.ts`
- Modify: `apps/server-hono/src/lib/auth.ts`
- Test: `apps/server-hono/src/lib/email-links.test.ts`

**Interfaces:**

- Consumes: `EmailService`, `ResendEmailProvider`, `EMAIL_TEMPLATE_VALUES` (Task 3); env vars (Task 4).
- Produces: `tryGetEmail(): EmailService | null`; pure helpers `buildVerifyUrl(webUrl, token): string` and `buildResetUrl(webUrl, token): string` exported from `lib/email.ts` for testing; the configured hooks on the `auth` instance.

- [ ] **Step 1: Write the failing test for the link builders** (`apps/server-hono/src/lib/email-links.test.ts`)

```ts
import { describe, expect, it } from "vitest";

import { buildResetUrl, buildVerifyUrl } from "./email";

describe("email link builders", () => {
  it("builds a verify link through the web proxy with an absolute callback", () => {
    const url = buildVerifyUrl("https://kaipu.app", "tok/en+1");
    expect(url).toBe(
      "https://kaipu.app/api/auth/verify-email?token=tok%2Fen%2B1&callbackURL=https%3A%2F%2Fkaipu.app%2Fauth%2Femail-verified",
    );
  });

  it("builds a reset link to the web reset page", () => {
    expect(buildResetUrl("https://kaipu.app", "abc")).toBe(
      "https://kaipu.app/auth/reset-password?token=abc",
    );
  });

  it("tolerates a trailing slash on the web url", () => {
    expect(buildResetUrl("https://kaipu.app/", "abc")).toBe(
      "https://kaipu.app/auth/reset-password?token=abc",
    );
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd apps/server-hono && bun run test -- src/lib/email-links.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Write `apps/server-hono/src/lib/email.ts`**

```ts
/**
 * Lazy transactional email singleton — mirrors lib/storage.ts: the Worker boots
 * without RESEND_API_KEY, and send hooks become logged no-ops.
 */
import { EmailService, ResendEmailProvider } from "@kaipu/infra-email";

import { env } from "../env";

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
  service = new EmailService(new ResendEmailProvider(env.RESEND_API_KEY), env.AUTH_EMAIL_FROM ?? DEFAULT_FROM, {
    replyTo: REPLY_TO,
  });
  return service;
}

export function webUrl(): string {
  return (env.PUBLIC_WEB_URL ?? "https://kaipu.app").replace(/\/$/, "");
}

export function buildVerifyUrl(web: string, token: string): string {
  const base = web.replace(/\/$/, "");
  const callback = encodeURIComponent(`${base}/auth/email-verified`);
  return `${base}/api/auth/verify-email?token=${encodeURIComponent(token)}&callbackURL=${callback}`;
}

export function buildResetUrl(web: string, token: string): string {
  return `${web.replace(/\/$/, "")}/auth/reset-password?token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/server-hono && bun run test -- src/lib/email-links.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire the hooks.** In `apps/server-hono/src/lib/auth.ts`, extend the existing `betterAuth({...})` call (it currently spreads `baseConfig`, sets `trustedOrigins` and `plugins`). Add locale detection and the two hook blocks:

```ts
import { EMAIL_TEMPLATE_VALUES, type EmailLocale } from "@kaipu/infra-email";
import { buildResetUrl, buildVerifyUrl, tryGetEmail, webUrl } from "./email";

function emailLocale(request?: Request): EmailLocale {
  const header = request?.headers.get("accept-language") ?? "";
  return header.toLowerCase().startsWith("es") ? "es" : "en";
}

export const auth = betterAuth({
  ...baseConfig,
  trustedOrigins: [...env.CORS_ORIGIN, "kaipu-record://app"],
  emailAndPassword: {
    ...baseConfig.emailAndPassword,
    // Decision 2026-09-15: one-hour, single-use reset link; reset revokes all sessions.
    resetPasswordTokenExpiresIn: 60 * 60,
    revokeSessionsOnPasswordReset: true,
    sendResetPassword: async ({ user, token }, request) => {
      const email = tryGetEmail();
      if (!email) return; // already logged by tryGetEmail
      try {
        await email.sendEmail(EMAIL_TEMPLATE_VALUES.RESET_PASSWORD, user.email, {
          locale: emailLocale(request),
          resetUrl: buildResetUrl(webUrl(), token),
        });
      } catch (err) {
        // Better Auth swallows hook errors and still returns 200 — log loudly.
        console.error("failed to send the password reset email", err);
        throw err;
      }
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    // Decision 2026-09-15: verification links last 24 hours.
    expiresIn: 60 * 60 * 24,
    sendVerificationEmail: async ({ user, token }, request) => {
      const email = tryGetEmail();
      if (!email) return;
      try {
        await email.sendEmail(EMAIL_TEMPLATE_VALUES.VERIFY_EMAIL, user.email, {
          locale: emailLocale(request),
          verifyUrl: buildVerifyUrl(webUrl(), token),
        });
      } catch (err) {
        console.error("failed to send the verification email", err);
        throw err;
      }
    },
  },
  plugins: [...(baseConfig.plugins ?? []), customSession(getCustomSession, baseConfig)],
});
```

Notes for the implementer:

- The `url` argument Better Auth passes to both hooks is intentionally ignored: it is built from the API worker's own origin, which is not the public web origin. We always build links against `PUBLIC_WEB_URL`.
- Do NOT set `requireEmailVerification: true` — sign-in stays allowed for unverified accounts; Cloud access is gated separately by `emailVerified` (see `CloudAccessRepository.hasAccess`).
- Throttling of resends relies on Better Auth's built-in endpoint rate limiting plus the UI cooldowns added in Tasks 6–7. On Workers the built-in limiter is per-isolate memory; that is accepted for this stage.
- Add `resend` etc. as dependency: add `"@kaipu/infra-email": "workspace:*"` to `apps/server-hono/package.json` dependencies and run `bun install`.

- [ ] **Step 6: Typecheck and full server test run**

Run: `bun install && cd apps/server-hono && bun run check-types && bun run test`
Expected: exit 0, all tests PASS. If a Better Auth option name fails typechecking, consult the installed 1.4.18 types as noted in Global Constraints.

- [ ] **Step 7: Verify the Worker still builds** (react-email render must work on workerd)

Run: `cd apps/server-hono && bun run build`
Expected: build succeeds. If `@react-email/render` pulls a Node-only `react-dom/server` entry, switch the import inside `EmailService` to `import { render } from "@react-email/render"` (it ships an edge-safe build) and note the resolution in the commit message; the `nodejs_compat` flag is already on.

- [ ] **Step 8: Commit**

```bash
git add apps/server-hono packages/infra-email bun.lock
git commit -m "feat(auth): send verification and password reset emails via Resend"
```

---

### Task 6: Web pages — forgot password, reset password, email verified

**Files:**

- Create: `apps/web-hono/src/routes/auth/forgot-password.tsx`
- Create: `apps/web-hono/src/routes/auth/reset-password.tsx`
- Create: `apps/web-hono/src/routes/auth/email-verified.tsx`
- Modify: `apps/web-hono/src/routes/auth/login.tsx` (add forgot-password link)
- Modify: `packages/i18n/messages/en.json`, `packages/i18n/messages/es.json` (auth namespace keys)

**Interfaces:**

- Consumes: `authClient` from `@/lib/auth/auth-client` (Better Auth React client, same-origin `/api/auth/*` via the existing proxy); `NOINDEX` from `@/lib/seo`.
- Produces: routes `/auth/forgot-password`, `/auth/reset-password?token=…`, `/auth/email-verified` (the reset and verified pages are the exact paths the server's link builders in Task 5 emit — do not rename one side without the other).

- [ ] **Step 1: Add i18n keys** to the existing `auth` namespace in both catalogs (en shown; write the es equivalents in the same keys — this is user-facing product copy, Spanish allowed):

```json
"forgotPassword": "Forgot your password?",
"forgotTitle": "Reset your password",
"forgotBody": "Enter your account email and we'll send you a link to choose a new password.",
"forgotSubmit": "Send reset link",
"forgotSent": "If that email has a Kaipu account, a reset link is on its way. It expires in one hour.",
"resetTitle": "Choose a new password",
"resetSubmit": "Set new password",
"resetSuccess": "Password updated. Sign in with your new password.",
"resetInvalid": "This link is invalid or has expired. Request a new one.",
"resetMissingToken": "This page needs the link from your email.",
"verifiedTitle": "Email verified",
"verifiedBody": "Your email is verified. You can close this window and return to the Kaipu app, or sign in here.",
"verifiedError": "This verification link is invalid or has expired.",
"verifiedResend": "Send a new verification email",
"verifiedResendSent": "A new verification email is on its way."
```

Spanish (`es.json`, same keys): "¿Olvidaste tu contraseña?", "Restablece tu contraseña", "Escribe el correo de tu cuenta y te enviaremos un enlace para elegir una nueva contraseña.", "Enviar enlace", "Si ese correo tiene una cuenta de Kaipu, el enlace va en camino. Expira en una hora.", "Elige una nueva contraseña", "Guardar contraseña", "Contraseña actualizada. Inicia sesión con tu nueva contraseña.", "Este enlace no es válido o expiró. Pide uno nuevo.", "Esta página necesita el enlace de tu correo.", "Correo verificado", "Tu correo está verificado. Puedes cerrar esta ventana y volver a la app de Kaipu, o iniciar sesión aquí.", "Este enlace de verificación no es válido o expiró.", "Enviar un nuevo correo de verificación", "Un nuevo correo de verificación va en camino."

Run `bun run --filter @kaipu/i18n test` (parity) before continuing.

- [ ] **Step 2: Create `/auth/forgot-password`**

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { authClient } from "@/lib/auth/auth-client";
import { NOINDEX } from "@/lib/seo";

export const Route = createFileRoute("/auth/forgot-password")({
  head: () => NOINDEX,
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const t = useTranslations("auth");
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setPending(true);
    // Always report success — never reveal whether the account exists.
    await authClient
      .requestPasswordReset({ email, redirectTo: "/auth/reset-password" })
      .catch(() => undefined);
    setPending(false);
    setSent(true);
  }

  return (
    <main>
      <h1>{t("forgotTitle")}</h1>
      {sent ? (
        <p>{t("forgotSent")}</p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)}>
          <p>{t("forgotBody")}</p>
          <input name="email" type="email" required autoComplete="email" />
          <button type="submit" disabled={pending}>
            {t("forgotSubmit")}
          </button>
        </form>
      )}
      <Link to="/auth/login">{t("signIn")}</Link>
    </main>
  );
}
```

Style it with the same wrapper/classes `login.tsx` uses around `SignInForm` (read `apps/web-hono/src/routes/auth/login.tsx` and `components/sign-in-form.tsx` and reuse their container markup and class names — do not introduce a new visual language). If `t("signIn")` is not an existing key, use the key the login page uses for its title.

- [ ] **Step 3: Create `/auth/reset-password`**

```tsx
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useTranslations } from "@kaipu/i18n";
import { authClient } from "@/lib/auth/auth-client";
import { NOINDEX } from "@/lib/seo";

export const Route = createFileRoute("/auth/reset-password")({
  head: () => NOINDEX,
  validateSearch: z.object({ token: z.string().optional() }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const t = useTranslations("auth");
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!token) {
    return (
      <main>
        <h1>{t("resetTitle")}</h1>
        <p>{t("resetMissingToken")}</p>
        <Link to="/auth/forgot-password">{t("forgotTitle")}</Link>
      </main>
    );
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const newPassword = String(new FormData(event.currentTarget).get("password") ?? "");
    setPending(true);
    setError(null);
    const result = await authClient.resetPassword({ newPassword, token: token! });
    setPending(false);
    if (result.error) {
      setError(t("resetInvalid"));
      return;
    }
    // Success: all sessions were revoked server-side; go sign in again.
    void navigate({ to: "/auth/login" });
  }

  return (
    <main>
      <h1>{t("resetTitle")}</h1>
      <form onSubmit={(e) => void handleSubmit(e)}>
        <input name="password" type="password" required minLength={8} autoComplete="new-password" />
        <button type="submit" disabled={pending}>{t("resetSubmit")}</button>
      </form>
      {error ? (
        <p role="alert">
          {error} <Link to="/auth/forgot-password">{t("forgotTitle")}</Link>
        </p>
      ) : null}
    </main>
  );
}
```

On success also show `toast.success(t("resetSuccess"))` if the login/signup forms use a toast helper (check `sign-in-form.tsx` for the import and reuse it).

- [ ] **Step 4: Create `/auth/email-verified`.** Better Auth redirects here after `GET /api/auth/verify-email`; on failure it appends `?error=…` to the callback.

```tsx
import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { useTranslations } from "@kaipu/i18n";
import { authClient } from "@/lib/auth/auth-client";
import { NOINDEX } from "@/lib/seo";

export const Route = createFileRoute("/auth/email-verified")({
  head: () => NOINDEX,
  validateSearch: z.object({ error: z.string().optional() }),
  component: EmailVerifiedPage,
});

function EmailVerifiedPage() {
  const t = useTranslations("auth");
  const { error } = Route.useSearch();
  const [resent, setResent] = useState(false);
  const [pending, setPending] = useState(false);

  if (!error) {
    return (
      <main>
        <h1>{t("verifiedTitle")}</h1>
        <p>{t("verifiedBody")}</p>
        <Link to="/auth/login">{t("signIn")}</Link>
      </main>
    );
  }

  async function resend(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email") ?? "");
    setPending(true);
    await authClient
      .sendVerificationEmail({ email, callbackURL: "/auth/email-verified" })
      .catch(() => undefined);
    setPending(false);
    setResent(true);
  }

  return (
    <main>
      <h1>{t("verifiedError")}</h1>
      {resent ? (
        <p>{t("verifiedResendSent")}</p>
      ) : (
        <form onSubmit={(e) => void resend(e)}>
          <input name="email" type="email" required autoComplete="email" />
          <button type="submit" disabled={pending}>{t("verifiedResend")}</button>
        </form>
      )}
    </main>
  );
}
```

- [ ] **Step 5: Add the forgot-password link on the login page.** In `apps/web-hono/src/routes/auth/login.tsx`, next to the existing link to `/auth/signup`, add:

```tsx
<Link to="/auth/forgot-password">{t("forgotPassword")}</Link>
```

- [ ] **Step 6: Verify SSR renders.** Run `cd apps/web-hono && bun run dev` (port 3001 via wrangler:dev, or vite dev), then:

```bash
curl -s http://localhost:3001/auth/forgot-password | grep -i "reset"
curl -s "http://localhost:3001/auth/reset-password?token=x" | grep -i "password"
curl -s http://localhost:3001/auth/email-verified | grep -i "verified"
```

Expected: each page renders its heading; no 500s in the dev console. (web-hono has no test script — typecheck + build + these smoke checks are the verification.)

- [ ] **Step 7: Build and typecheck**

Run: `cd apps/web-hono && bun run build` and `bunx tsc --noEmit -p apps/web-hono` (or the root `bun run check-types`).
Expected: exit 0. TanStack Router regenerates `routeTree.gen.ts` on build — commit the regenerated file.

- [ ] **Step 8: Commit**

```bash
git add apps/web-hono packages/i18n/messages
git commit -m "feat(web): forgot-password, reset-password and email-verified pages"
```

---

### Task 7: Desktop — forgot-password link and resend-verification action

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/auth/auth-form.tsx`
- Modify: `apps/kaipu-record/src/main/services/auth-client.ts` (add `resendVerificationEmail`)
- Modify: `apps/kaipu-record/src/main/infrastructure/auth-store.ts` (IPC handler)
- Modify: `apps/kaipu-record/src/shared/types/ipc.ts`, `src/shared/types/electron-api.ts`, `src/preload/index.ts`
- Modify: `apps/kaipu-record/src/renderer/src/features/storage-cloud/storage-cloud-settings.tsx` (resend button in the `beta-unavailable` view)
- Modify: `packages/i18n/messages/{en,es}.json` (storageCloud keys)
- Test: `apps/kaipu-record/src/renderer/src/features/storage-cloud/storage-cloud-settings.test.tsx` (extend)

**Interfaces:**

- Consumes: `LEGAL_WEB_URL` (already exported from `auth-form.tsx`); IPC pattern from `auth-store.ts`.
- Produces: IPC channel `authResendVerification: "auth:resend-verification"`; preload method `resendVerificationEmail(): Promise<{ ok: boolean }>`.

- [ ] **Step 1: i18n keys.** Add to `storageCloud` in both catalogs (es equivalents alongside):

```json
"resendVerification": "Resend verification email",
"resendVerificationSent": "Verification email sent. Check your inbox."
```

es: `"Reenviar correo de verificación"`, `"Correo de verificación enviado. Revisa tu bandeja."`

And to `auth`: `"forgotPassword": "Forgot your password?"` / `"¿Olvidaste tu contraseña?"` (skip if Task 6 already added it — it is shared).

- [ ] **Step 2: Forgot-password link in the desktop form.** In `auth-form.tsx`, in sign-in mode next to the mode-switch control, add:

```tsx
<a href={`${LEGAL_WEB_URL}/auth/forgot-password`} target="_blank" rel="noopener noreferrer">
  {t("forgotPassword")}
</a>
```

(The main process converts window-opens to `shell.openExternal` via the existing `setWindowOpenHandler`; no new IPC is needed for the link.)

- [ ] **Step 3: Main-process resend call.** In `auth-client.ts`, add alongside `signOutRemote` (same fetch style, no bearer needed — the endpoint takes the email):

```ts
export async function resendVerificationEmail(
  config: { serverUrl: string },
  email: string,
): Promise<boolean> {
  try {
    const res = await fetch(`${config.serverUrl}/api/auth/send-verification-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: "kaipu-record://app" },
      body: JSON.stringify({ email, callbackURL: "/auth/email-verified" }),
      signal: AbortSignal.timeout(15_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
```

(The server builds the real link itself — the `callbackURL` value here is required by the endpoint schema but not used for link construction; see plan Task 5.)

- [ ] **Step 4: IPC plumbing.** Add `authResendVerification: "auth:resend-verification"` to `IPC_CHANNELS` in `ipc.ts`; in `auth-store.ts` register (inside `registerAuth`, guarded by `requireMainWindow` like the other handlers):

```ts
ipcMain.handle(IPC_CHANNELS.authResendVerification, async (event): Promise<{ ok: boolean }> => {
  requireMainWindow(event);
  const account = getCurrentAccount();
  if (!account) return { ok: false };
  return { ok: await resendVerificationEmail({ serverUrl }, account.email) };
});
```

Expose in `preload/index.ts` (`resendVerificationEmail: () => ipcRenderer.invoke(IPC_CHANNELS.authResendVerification)`) and add the method to `KaipuElectronAPI` in `electron-api.ts`. Also add a default stub to the renderer test setup's `window.electronAPI` object (`apps/kaipu-record/src/renderer/src/test/setup.ts`): `resendVerificationEmail: async () => ({ ok: true })`.

- [ ] **Step 5: Failing renderer test.** Extend `storage-cloud-settings.test.tsx` with:

```tsx
it("lets an unverified account resend the verification email with a cooldown", async () => {
  vi.spyOn(window.electronAPI, "getAuthStatus").mockResolvedValue({
    kind: "signed-in",
    userId: "u1",
    email: "me@example.com",
    name: "Me",
    entitlements: null,
  } as never);
  vi.spyOn(window.electronAPI, "getStorageUsage").mockResolvedValue({
    kind: "ok",
    usage: {
      capacityBytes: 0, usedBytes: 0, reservedBytes: 0, availableBytes: 0,
      pendingUploads: 0, uploadsEnabled: true, cloudUploads: false,
    },
    fetchedAt: Date.now(),
  } as never);
  const resend = vi
    .spyOn(window.electronAPI, "resendVerificationEmail")
    .mockResolvedValue({ ok: true });

  renderSettings(); // reuse the file's existing render helper
  const button = await screen.findByRole("button", { name: /resend verification email/i });
  await userEvent.click(button);
  expect(resend).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/verification email sent/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /resend verification email/i })).toBeDisabled();
});
```

Match the exact `AuthStatus`/`StorageUsageResult` shapes from `src/shared/types/{auth,cloud-storage}.ts` — the casts above are only where the file's existing tests already cast. `cloudUploads: false` is what routes `toCapacityView` to `beta-unavailable`; confirm in `capacity-view.ts` and adjust the mock to whatever field that branch actually reads.

- [ ] **Step 6: Run it to make sure it fails**

Run: `cd apps/kaipu-record && bun run test -- storage-cloud-settings`
Expected: FAIL (button not found).

- [ ] **Step 7: Implement the button.** In `storage-cloud-settings.tsx`, in the branch that renders the `beta-unavailable` view, add local state and the button:

```tsx
const [resendState, setResendState] = useState<"idle" | "pending" | "sent">("idle");

async function handleResend(): Promise<void> {
  setResendState("pending");
  const result = await window.electronAPI.resendVerificationEmail();
  setResendState(result.ok ? "sent" : "idle");
}
```

```tsx
<button type="button" disabled={resendState !== "idle"} onClick={() => void handleResend()}>
  {t("resendVerification")}
</button>
{resendState === "sent" ? <p>{t("resendVerificationSent")}</p> : null}
```

Use the project's existing button component/classes from that file's imports rather than a bare `<button>` if one is in scope. "sent" is a terminal state for the session — that is the user-side cooldown.

- [ ] **Step 8: Run tests to verify they pass**

Run: `cd apps/kaipu-record && bun run test`
Expected: PASS (whole desktop suite).

- [ ] **Step 9: Commit**

```bash
git add apps/kaipu-record packages/i18n/messages
git commit -m "feat(desktop): forgot-password link and resend-verification action"
```

---

### Task 8: Documentation and rollout notes

**Files:**

- Modify: `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` (Decision 2 section: flows now implemented)
- Modify: `apps/documentation/src/content/docs/backlog/cloud-error-states.md` (gap 2 "No way out of unverified" → done via real verification)

- [ ] **Step 1: Update both docs.** In the spec's Decision 2 section, change "These flows remain to be implemented." to a short implemented note naming the package and routes. In `cloud-error-states.md`, strike gap 2 the way gap 4 was struck (`~~…~~ Done: …`).

- [ ] **Step 2: Record the operator checklist** at the end of the spec's Decision 2 section:

```md
Rollout requires, in order: (1) `updates.niway.dev` verified in Resend with its
DKIM/SPF records (check the Resend dashboard; nothing in this repo configures
DNS); (2) the `RESEND_API_KEY` secret added to the GitHub `production`
environment and deployed via Release API; (3) a manual end-to-end pass: sign up
with a real inbox, receive the email, verify, see the Cloud page unlock;
request a reset, set a new password, confirm every session was signed out.
```

- [ ] **Step 3: Commit and open the PR**

```bash
git add apps/documentation
git commit -m "docs(email): mark verification flows implemented and record rollout checklist"
```

Open a PR titled `feat(email): transactional email with Resend (verification + password reset)` targeting `main`, summarizing tasks 1–8 and the rollout checklist.

## Execution order note

This plan has no dependency on plans 02–06 and should land **first**: plans 03 and 04 send the approval email through the `EXPANSION_APPROVED` template shipped here.
