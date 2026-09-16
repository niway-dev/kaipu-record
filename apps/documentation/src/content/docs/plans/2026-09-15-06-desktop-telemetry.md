---
title: "Plan 06 — Desktop telemetry split (diagnostics opt-out, analytics opt-in)"
description: "Implementation plan splitting the existing desktop PostHog integration into sanitized technical diagnostics (default on) and product analytics (default off), with settings toggles and privacy-policy copy."
---

# Desktop Telemetry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The desktop app already ships PostHog (posthog-node in main, posthog-js in renderer, persisted `deviceId`). Split it into two user-controlled streams per Decision 6: **technical diagnostics** (crashes, sanitized errors — enabled by default, opt-out) and **product analytics** (feature usage — disabled by default, opt-in), route both through `https://kaipu.app/ingest`, and add the settings UI plus privacy-policy copy.

**Architecture:** Two booleans in `AppSettings.telemetry` gate the existing capture paths in the main process; the renderer's posthog-js initializes only when analytics is on. A pure sanitizer module scrubs every diagnostic payload before it is enqueued. Sign-in links `deviceId → userId` via `identify` only when analytics is on. All ingestion goes through the plan-05 proxy (EU region behind it).

**Tech Stack:** Electron (main/preload/renderer), posthog-node + posthog-js (already installed), Vitest (node project for main, jsdom for renderer), `@kaipu/i18n`.

**Spec:** `apps/documentation/src/content/docs/specs/2026-09-15-cloud-trial-and-approval.md` — "Decision 6 — local-first diagnostics".

**Depends on:** Plan 05 merged and deployed (the `/ingest` proxy must exist in production before pointing clients at it). Legal copy task also touches the privacy policy from PR #102.

## Global Constraints

- Diagnostics: **default ON**, opt-out in Settings. Product analytics: **default OFF**, opt-in. The two switches are independent.
- The sanitizer must remove: emails, local paths (`/Users/...`, `/home/...`, `C:\...`, `file://...`), file names with media/document extensions, titles, prompts, content, tokens/secrets (long opaque strings), authorization headers, cookies, form values. Diagnostics carry ONLY: sanitized stack/message, error code, app version, OS platform + arch, operation state, the anonymous installation `deviceId`.
- Opting out of diagnostics stops remote desktop reports entirely; local logs stay (console logging is unchanged); server-side events (plan 05) are unaffected by these switches.
- Ingestion host: `https://kaipu.app/ingest` (both processes). Never a direct PostHog URL in the desktop app.
- English artifacts; product copy es/en in `@kaipu/i18n` with parity; renderer tests via the `window.electronAPI` stub in `test/setup.ts`.

## File Structure

```
apps/kaipu-record/src/shared/types/settings.ts (or wherever AppSettings lives — locate by grepping "deviceId")   # + telemetry field
apps/kaipu-record/src/main/infrastructure/settings-store.ts        # defaults/migration
apps/kaipu-record/src/main/services/telemetry-sanitizer.ts         # NEW pure module
apps/kaipu-record/src/main/services/telemetry-sanitizer.test.ts    # NEW
apps/kaipu-record/src/main/services/analytics.service.ts           # gating + host + identify
apps/kaipu-record/src/main/services/analytics-ipc.ts               # gate forwarded exceptions
apps/kaipu-record/src/renderer/src/features/analytics/use-init-analytics.ts  # opt-in gate
apps/kaipu-record/src/renderer/src/features/analytics/analytics-client.ts    # host
apps/kaipu-record/src/renderer/src/pages/settings/privacy-page.tsx  # NEW settings page
apps/kaipu-record/src/renderer/src/pages/settings/settings-layout.tsx  # + nav entry
packages/i18n/messages/{en,es}.json                                 # settings + legal copy
apps/web-hono legal privacy-policy route content (via legal.* i18n keys)
```

---

### Task 1: Settings model

**Files:**

- Modify: the `AppSettings` type (find it: `grep -rn "deviceId" apps/kaipu-record/src/shared apps/kaipu-record/src/main/infrastructure/settings-store.ts`) and `settings-store.ts`.
- Test: extend the settings-store test if one exists (`ls apps/kaipu-record/src/main/infrastructure/*.test.ts`); otherwise add `settings-telemetry.test.ts` beside it.

**Interfaces:**

- Produces: `AppSettings.telemetry: { diagnostics: boolean; analytics: boolean }` with defaults `{ diagnostics: true, analytics: false }`; settings loaded from disk without the field are migrated to the defaults (never `undefined` downstream). Renderer reads it via the existing `getSettings`/`updateSettings`/`onSettingsChanged` IPC — no new channels.

- [ ] **Step 1: Failing test** — in the main-process test file:

```ts
it("defaults telemetry to diagnostics on, analytics off, and migrates old files", () => {
  // Use the store's exported normalize/defaults helper (find the function that
  // fills missing fields when reading the settings file; deviceId minting lives
  // in the same path). Assert on a settings object lacking `telemetry`:
  const settings = normalizeSettings({} as never);
  expect(settings.telemetry).toEqual({ diagnostics: true, analytics: false });
});
```

Adapt `normalizeSettings` to the store's real exported name; if defaulting is inline in the read path, extract it into an exported pure `normalizeSettings(partial): AppSettings` first (that refactor is part of this task).

- [ ] **Step 2: Run → FAIL. Step 3: Implement** — add the field to the type, add `telemetry: { diagnostics: true, analytics: false }` to the defaults object, and in the read/normalize path `telemetry: { diagnostics: stored.telemetry?.diagnostics ?? true, analytics: stored.telemetry?.analytics ?? false }`. Run the desktop main tests → PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/kaipu-record
git commit -m "feat(desktop): telemetry settings with diagnostics-on/analytics-off defaults"
```

---

### Task 2: The sanitizer

**Files:**

- Create: `apps/kaipu-record/src/main/services/telemetry-sanitizer.ts`
- Test: `apps/kaipu-record/src/main/services/telemetry-sanitizer.test.ts`

**Interfaces:**

- Produces:
  - `sanitizeText(input: string): string` — scrubs emails, paths, file names, long opaque tokens.
  - `sanitizeError(error: unknown): { name: string; message: string; stack: string | null }` — applies `sanitizeText` to message and every stack line.
  - `ALLOWED_DIAGNOSTIC_KEYS = ["errorCode", "operation", "appVersion", "platform", "arch"] as const` and `sanitizeProperties(props: Record<string, unknown>): Record<string, string | number | boolean>` — drops every key not allowlisted (allowlist, not blocklist, for structured properties).

- [ ] **Step 1: Failing tests**

```ts
import { describe, expect, it } from "vitest";

import { sanitizeError, sanitizeProperties, sanitizeText } from "./telemetry-sanitizer";

describe("sanitizeText", () => {
  it("redacts emails", () => {
    expect(sanitizeText("user cristian.soto@example.com failed")).toBe("user [email] failed");
  });

  it("redacts unix and windows paths and file URLs", () => {
    expect(sanitizeText("ENOENT /Users/cristian/Movies/demo final.mp4")).toBe("ENOENT [path]");
    expect(sanitizeText("read C:\\Users\\c\\Videos\\clip.mov failed")).toBe("read [path] failed");
    expect(sanitizeText("at file:///Users/c/app/index.js:10:3")).toBe("at [path]");
  });

  it("redacts bare media file names", () => {
    expect(sanitizeText('cannot open "mi grabacion secreta.mp4"')).toBe('cannot open "[file]"');
  });

  it("redacts long opaque tokens", () => {
    expect(sanitizeText("Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9abcdef")).toBe("Bearer [redacted]");
  });

  it("keeps ordinary error prose", () => {
    expect(sanitizeText("upload failed with status 413")).toBe("upload failed with status 413");
  });
});

describe("sanitizeError", () => {
  it("scrubs message and every stack line", () => {
    const err = new Error("save to /Users/c/Movies/x.mp4 denied for a@b.com");
    const out = sanitizeError(err);
    expect(out.name).toBe("Error");
    expect(out.message).toBe("save to [path] denied for [email]");
    expect(out.stack === null || !out.stack.includes("/Users/")).toBe(true);
  });

  it("handles non-Error values", () => {
    expect(sanitizeError("boom /home/c/x")).toEqual({ name: "Unknown", message: "boom [path]", stack: null });
  });
});

describe("sanitizeProperties", () => {
  it("keeps only allowlisted keys with primitive values", () => {
    expect(
      sanitizeProperties({
        errorCode: "E_UPLOAD",
        operation: "confirm",
        title: "my private recording",
        filePath: "/Users/c/x.mp4",
        appVersion: "0.6.0",
      }),
    ).toEqual({ errorCode: "E_UPLOAD", operation: "confirm", appVersion: "0.6.0" });
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement**

```ts
/** Scrubs personal data from diagnostics before anything leaves the device
 * (spec Decision 6). Order matters: URLs/paths before file names. */

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const FILE_URL = /file:\/\/\S+/g;
const UNIX_PATH = /(?:\/(?:Users|home|var|tmp|private)\/)[^\s"']*(?:[^\s"']|\\ )*/g;
const WINDOWS_PATH = /[A-Za-z]:\\[^\s"']+/g;
const MEDIA_FILE = /[\w][\w .()\-]*\.(?:mp4|mov|mkv|webm|avi|png|jpe?g|gif|webp|pdf|txt|md)\b/gi;
const LONG_TOKEN = /\b[A-Za-z0-9_-]{24,}\b/g;

export function sanitizeText(input: string): string {
  return input
    .replace(FILE_URL, "[path]")
    .replace(UNIX_PATH, "[path]")
    .replace(WINDOWS_PATH, "[path]")
    .replace(EMAIL, "[email]")
    .replace(MEDIA_FILE, "[file]")
    .replace(LONG_TOKEN, "[redacted]");
}

export function sanitizeError(error: unknown): {
  name: string;
  message: string;
  stack: string | null;
} {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: sanitizeText(error.message),
      stack: error.stack ? error.stack.split("\n").map(sanitizeText).join("\n") : null,
    };
  }
  return { name: "Unknown", message: sanitizeText(String(error)), stack: null };
}

export const ALLOWED_DIAGNOSTIC_KEYS = ["errorCode", "operation", "appVersion", "platform", "arch"] as const;

export function sanitizeProperties(
  props: Record<string, unknown>,
): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const key of ALLOWED_DIAGNOSTIC_KEYS) {
    const value = props[key];
    if (typeof value === "string") out[key] = sanitizeText(value);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
  }
  return out;
}
```

Iterate the regexes until the tests pass exactly (the path regex must swallow the trailing file segment including spaces in the quoted-string case — adjust the test or pattern coherently, keeping the invariant: no fragment of a real path or file name survives).

- [ ] **Step 4: Run → PASS. Step 5: Commit**

```bash
git add apps/kaipu-record/src/main/services/telemetry-sanitizer*
git commit -m "feat(desktop): diagnostics sanitizer with allowlisted properties"
```

---

### Task 3: Gate and reroute the main-process client

**Files:**

- Modify: `apps/kaipu-record/src/main/services/analytics.service.ts`
- Modify: `apps/kaipu-record/src/main/services/analytics-ipc.ts`
- Modify: `apps/kaipu-record/src/main/index.ts` (init order: settings before analytics — verify `registerSettings()` already precedes `initMainAnalytics`)
- Test: `apps/kaipu-record/src/main/services/analytics.service.test.ts` (create if absent)

**Interfaces:**

- Consumes: Task 1 settings (expose a synchronous getter from the settings store, e.g. `getSettingsSnapshot(): AppSettings` — add one if only async IPC access exists); Task 2 sanitizer.
- Produces:
  - `captureDiagnostic(event: string, properties: Record<string, unknown>): void` — no-ops when `telemetry.diagnostics` is false; sanitizes properties; always attaches `appVersion` (`app.getVersion()`), `platform` (`process.platform`), `arch` (`process.arch`); distinct id = `deviceId`.
  - `captureException(error: unknown, operation: string): void` — diagnostics-gated, runs `sanitizeError` and sends `{ $exception_message, $exception_type, $exception_stack_trace_raw }`-style properties (keep whatever property names the current `captureSerializedException` uses — only add the gate + sanitizer in front).
  - `captureProduct(event: string, properties?: Record<string, string | number | boolean>): void` — no-ops when `telemetry.analytics` is false.
  - `identifyUser(userId: string): void` — analytics-gated `client.identify`/alias linking `deviceId → userId`.
  - PostHog constructed with `host: "https://kaipu.app/ingest"` (make it `MAIN_VITE_POSTHOG_HOST ?? "https://kaipu.app/ingest"` so local dev can point elsewhere).

- [ ] **Step 1: Failing tests** — the service currently builds a real `PostHog` client; refactor for testability by extracting the decision layer:

```ts
// analytics.service.test.ts
import { describe, expect, it } from "vitest";

import { routeCapture } from "./analytics.service";

const settings = (d: boolean, a: boolean) => ({ telemetry: { diagnostics: d, analytics: a } });

describe("routeCapture", () => {
  it("drops diagnostics when opted out", () => {
    expect(routeCapture("diagnostic", settings(false, true))).toBe(false);
    expect(routeCapture("diagnostic", settings(true, false))).toBe(true);
  });

  it("drops product events unless opted in", () => {
    expect(routeCapture("product", settings(true, false))).toBe(false);
    expect(routeCapture("product", settings(true, true))).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL. Step 3: Implement.** Export from `analytics.service.ts`:

```ts
export function routeCapture(
  stream: "diagnostic" | "product",
  settings: { telemetry: { diagnostics: boolean; analytics: boolean } },
): boolean {
  return stream === "diagnostic" ? settings.telemetry.diagnostics : settings.telemetry.analytics;
}
```

Then rework the service: every public capture function first checks `routeCapture(stream, getSettingsSnapshot())`; diagnostics run through `sanitizeError`/`sanitizeProperties` before `client.capture`; add `identifyUser`; change the client construction to pass `host`. Wire `identifyUser` where the auth store broadcasts a `signed-in` status (in `auth-store.ts`, after `broadcast(status)` on successful sign-in: `if (status.kind === "signed-in") identifyUser(status.userId)` — import from the analytics service; the gate lives inside `identifyUser`). In `analytics-ipc.ts`, route the forwarded renderer exceptions through the same gated `captureException`. The existing `uncaughtException`/`unhandledRejection` handlers call the gated+sanitized path too.

- [ ] **Step 4: Full desktop test run** — `cd apps/kaipu-record && bun run test` → PASS (fix any main-suite fallout from the refactor). **Step 5: Commit**

```bash
git add apps/kaipu-record
git commit -m "feat(desktop): gate and sanitize main-process telemetry, route via kaipu.app/ingest"
```

---

### Task 4: Renderer opt-in and the Privacy settings page

**Files:**

- Modify: `apps/kaipu-record/src/renderer/src/features/analytics/use-init-analytics.ts`, `analytics-client.ts`
- Create: `apps/kaipu-record/src/renderer/src/pages/settings/privacy-page.tsx`
- Modify: `apps/kaipu-record/src/renderer/src/pages/settings/settings-layout.tsx` (nav key `privacy` + route registration wherever settings routes are declared)
- Modify: `packages/i18n/messages/{en,es}.json`
- Test: `apps/kaipu-record/src/renderer/src/pages/settings/privacy-page.test.tsx`

**Interfaces:**

- Consumes: `useAppSettings()` (the hook `CloudPage` uses — same read/update surface), Task 1's `telemetry` field.
- Produces: `/settings/privacy` page with two toggles; posthog-js initialized only when `settings.telemetry.analytics === true` with `api_host: "https://kaipu.app/ingest"`.

- [ ] **Step 1: i18n keys** (`settings` namespace; es equivalents in the same keys):

```json
"privacy": "Privacy",
"privacyDiagnostics": "Technical diagnostics",
"privacyDiagnosticsDesc": "Anonymous crash and error reports. No file names, titles or content — ever. Helps us fix bugs.",
"privacyAnalytics": "Product analytics",
"privacyAnalyticsDesc": "Anonymous usage of features to guide what we build. Off unless you turn it on.",
"privacyLocalNote": "Logs always stay on this device either way. Support: contacto@niway.dev"
```

es: "Privacidad" / "Diagnósticos técnicos" / "Reportes anónimos de errores y crashes. Nunca incluyen nombres de archivos, títulos ni contenido. Nos ayudan a corregir fallos." / "Analítica de producto" / "Uso anónimo de funciones para guiar lo que construimos. Desactivada salvo que la enciendas." / "Los registros siempre se quedan en este equipo. Soporte: contacto@niway.dev" — run the i18n parity test.

- [ ] **Step 2: Failing renderer test** — render `<PrivacyPage />` with the settings stub returning `telemetry: { diagnostics: true, analytics: false }`; assert both switches render with the right checked state; toggle analytics; assert `updateSettings` (the stub) was called with `{ telemetry: { diagnostics: true, analytics: true } }`. Mirror how existing settings pages/tests read `useAppSettings` (find one with `grep -rln useAppSettings apps/kaipu-record/src/renderer`).

- [ ] **Step 3: Implement the page** using the `Card`/`Row` primitives (`ui/card.tsx`, `ui/row.tsx`) with a switch/checkbox control in `action` (reuse whichever toggle control other settings rows use):

```tsx
export function PrivacyPage(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();
  const telemetry = settings?.telemetry ?? { diagnostics: true, analytics: false };
  return (
    <div>
      <Card>
        <Row
          label={t("privacyDiagnostics")}
          description={t("privacyDiagnosticsDesc")}
          action={
            <input
              type="checkbox"
              role="switch"
              checked={telemetry.diagnostics}
              onChange={(e) => void update({ telemetry: { ...telemetry, diagnostics: e.target.checked } })}
              aria-label={t("privacyDiagnostics")}
            />
          }
        />
        <Row
          label={t("privacyAnalytics")}
          description={t("privacyAnalyticsDesc")}
          action={
            <input
              type="checkbox"
              role="switch"
              checked={telemetry.analytics}
              onChange={(e) => void update({ telemetry: { ...telemetry, analytics: e.target.checked } })}
              aria-label={t("privacyAnalytics")}
            />
          }
        />
      </Card>
      <p>{t("privacyLocalNote")}</p>
    </div>
  );
}
```

Add `privacy` to `SettingsNavKey`/`NAV` in `settings-layout.tsx` (pick an appropriate lucide icon consistent with the others, e.g. `ShieldCheck`) and register the route the same way sibling settings pages are registered (find the router file that maps `general`, `files`, etc.).

- [ ] **Step 4: Renderer opt-in gate.** In `use-init-analytics.ts`: read settings first; call `initAnalytics(deviceId)` only when `settings.telemetry.analytics` is true, and if posthog was already initialized and the flag turns false, call the client's `opt_out_capturing()` (posthog-js) — subscribe to `onSettingsChanged` for live toggling. In `analytics-client.ts`, set `api_host: "https://kaipu.app/ingest"` (env-overridable like the main process).

- [ ] **Step 5: Full test run** — `cd apps/kaipu-record && bun run test` → PASS. **Step 6: Commit**

```bash
git add apps/kaipu-record packages/i18n/messages
git commit -m "feat(desktop): privacy settings page and opt-in product analytics"
```

---

### Task 5: Privacy-policy copy

**Files:**

- Modify: `packages/i18n/messages/{en,es}.json` (`legal` namespace — the privacy policy content the web legal routes render)
- Verify: `apps/web-hono/src/routes/legal/privacy-policy.tsx` renders the new clause (it consumes `legal.*` keys; find where the providers/processors list lives — PR #102 wrote providers as "currently including").

- [ ] **Step 1: Add the clause.** Locate the privacy policy's data-processors/analytics section key in the `legal` namespace and add (en; es equivalent in the same key):

```
"Analytics and diagnostics. We use PostHog, processed in the European Union, in two separate streams: (a) product analytics from the desktop app, which is off by default and only active if you enable it in Settings; (b) technical diagnostics (crash and error reports), on by default and disabled from Settings at any time, which never include file names, titles, file content or local paths. Our servers additionally record operational events about your account (sign-ins, verification, storage operations) needed to run the service. See Settings → Privacy in the app for both switches."
```

If the policy is structured as arrays of clause keys, follow that structure exactly (read how existing clauses are keyed and rendered before editing). Update the "currently including" providers list to name PostHog.

- [ ] **Step 2: Verify SSR** — `cd apps/web-hono && bun run dev` and `curl -s http://localhost:3001/legal/privacy-policy | grep -i posthog` → the clause renders in both locales (switch via the locale cookie `KAIPU_LOCALE` or the UI).

- [ ] **Step 3: Run the i18n parity test, commit and open the PR**

```bash
git add packages/i18n/messages apps/web-hono
git commit -m "feat(legal): privacy policy names PostHog EU and the two telemetry streams"
```

PR title: `feat(desktop): split telemetry into opt-out diagnostics and opt-in analytics`. PR body notes: requires plan 05's `/ingest` deployed; defaults change nothing for existing users except that error reports now pass the sanitizer.
