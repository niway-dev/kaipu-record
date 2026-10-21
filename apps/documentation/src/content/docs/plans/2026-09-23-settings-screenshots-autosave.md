---
title: "Plan — Settings → Screenshots (save automatically or on click)"
description: "Implementation plan: a persisted screenshotSave preference (auto | manual), a Screenshots section on the Settings → App page, and the screenshot editor saving a fresh capture on open in auto mode with a Discard action that removes it."
---

# Settings → Screenshots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings preference decides whether a screenshot is saved to the Library the moment its editor opens (default) or only when the user clicks Save; in auto mode the editor offers Discard, which deletes the auto-saved item.

**Architecture:** One new `AppSettings` field flows through the existing settings pipeline (`mergeSettings` validation → `settings-store` persistence → `useAppSettings` in the renderer). The screenshot editor already tracks `savedId`/`dirty`; auto mode just performs the first `persist()` as soon as the image is ready, so every later path (overwrite/copy dialog, discard guard) keeps working unchanged. Manual mode is today's behaviour, untouched.

**Tech Stack:** Electron main (settings service + store), React 19, vitest + Testing Library, `@kaipu/i18n`. Commands from `apps/kaipu-record/`: `bunx vitest run <path>`, `bun run check-types`, `bunx oxlint <path>`, `bunx oxfmt <path>`.

**Spec:** [`backlog/settings-screenshots`](/backlog/settings-screenshots/) · parent analysis [`backlog/screenshot-save-strategy`](/backlog/screenshot-save-strategy/).

## Global Constraints

- All code, comments, tests and commit messages in **English**; UI copy in **both** `packages/i18n/messages/en.json` and `es.json` (neutral Spanish). Run the i18n parity tests after editing them: `bunx vitest run --root ../../packages/i18n`.
- `@shared/types` must not import `@kaipu/i18n` (preload bundle) — the default value is a literal there, like `locale`.
- No new IPC channels: `getSettings` / `updateSettings` / `onSettingsChanged` and `saveScreenshot` / `deleteLocalRecording` already exist.
- Commit after every task; end each commit message with a blank line then `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`. In a worktree without `node_modules`, format with `../../node_modules/.bin/oxfmt` and commit `--no-verify`, saying so in the body.

## Review Focus

1. **A stored `screenshotSave` with an unknown value** (e.g. `"always"` from a future build) — must coerce to `"auto"`, never crash `mergeSettings`. → Task 1.
2. **Re-opening an already-saved screenshot from the Library in auto mode** (`source.kind === "local"`) — must NOT create a second item; auto-save applies only to fresh captures. → Task 3 (pure helper test).
3. **Auto mode, the auto-save fails** (vault on a disconnected drive) — the editor must fall back to dirty/manual behaviour: the discard guard is active and Save retries; no silent loss. → Task 3.
4. **Discard while a save is in flight** — must not delete before the item exists; Discard is enabled only when `savedId !== null` and `busy` is false. → Task 3.
5. **Settings changed while an editor is open** — the mode is read once at open; a later change does not retro-save or un-save the open capture. → Task 3 (documented in code, verified manually).

---

### Task 1: `AppSettings.screenshotSave`

**Files:**

- Modify: `src/shared/types/ipc.ts` (`AppSettings` interface ~line 110–135, `DEFAULT_SETTINGS` ~line 140–152)
- Modify: `src/main/services/settings.service.ts` (`mergeSettings`)
- Test: `src/main/services/settings.service.test.ts`

**Interfaces:**

- Produces: `export const SCREENSHOT_SAVE_MODES = ["auto", "manual"] as const; export type ScreenshotSaveMode = (typeof SCREENSHOT_SAVE_MODES)[number];` and `AppSettings.screenshotSave: ScreenshotSaveMode` (default `"auto"`); `isValidScreenshotSaveMode(value: unknown): value is ScreenshotSaveMode`.

- [ ] **Step 1: Write the failing tests**

Append to `src/main/services/settings.service.test.ts`:

```ts
describe("screenshotSave", () => {
  it("defaults to auto", () => {
    expect(DEFAULT_SETTINGS.screenshotSave).toBe("auto");
    expect(mergeSettings(null).screenshotSave).toBe("auto");
  });

  it("keeps a valid stored mode and coerces anything else to the default", () => {
    expect(mergeSettings({ screenshotSave: "manual" }).screenshotSave).toBe("manual");
    expect(mergeSettings({ screenshotSave: "always" as never }).screenshotSave).toBe("auto");
    expect(mergeSettings({ screenshotSave: 3 as never }).screenshotSave).toBe("auto");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run src/main/services/settings.service.test.ts`
Expected: FAIL — `screenshotSave` undefined.

- [ ] **Step 3: Implement**

`src/shared/types/ipc.ts` — near `UPLOAD_MODES` (keep the same style):

```ts
/** Whether a fresh screenshot is written to the Library when its editor opens, or on Save. */
export const SCREENSHOT_SAVE_MODES = ["auto", "manual"] as const;
export type ScreenshotSaveMode = (typeof SCREENSHOT_SAVE_MODES)[number];
```

In `interface AppSettings`, after `showBarInRecording: boolean;`:

```ts
  /**
   * "auto" (default): a capture is saved to the Library the moment its editor opens,
   * like recordings; Save then overwrites that item. "manual": kept in memory until
   * Save (backlog/settings-screenshots).
   */
  screenshotSave: ScreenshotSaveMode;
```

In `DEFAULT_SETTINGS`, after `showBarInRecording: false,`: `screenshotSave: "auto",`.

`src/main/services/settings.service.ts` — import `SCREENSHOT_SAVE_MODES, type ScreenshotSaveMode` from `@shared/types`; add:

```ts
export function isValidScreenshotSaveMode(value: unknown): value is ScreenshotSaveMode {
  return (
    typeof value === "string" && (SCREENSHOT_SAVE_MODES as readonly string[]).includes(value)
  );
}
```

and in `mergeSettings` after `showBarInRecording`:

```ts
    screenshotSave: isValidScreenshotSaveMode(safe.screenshotSave)
      ? safe.screenshotSave
      : DEFAULT_SETTINGS.screenshotSave,
```

- [ ] **Step 4: Run tests + typecheck**

Run: `bunx vitest run src/main/services && bun run check-types`
Expected: PASS; fix any `AppSettings` fixture `check-types` flags (`src/renderer/src/test/setup.ts` `STUB_SETTINGS` needs `screenshotSave: "auto"`).

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/ipc.ts src/main/services src/renderer/src/test/setup.ts
git commit -m "feat(settings): screenshotSave preference (auto | manual), default auto

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Settings UI + copy

**Files:**

- Modify: `packages/i18n/messages/en.json`, `es.json` (`settings` namespace)
- Create: `src/renderer/src/pages/settings/screenshot-save-settings.tsx`
- Modify: `src/renderer/src/pages/settings/settings-pages.tsx` (`AppSettingsPage`, ~line 228–252)
- Test: `src/renderer/src/pages/settings/screenshot-save-settings.test.tsx`

**Interfaces:**

- Consumes: `useAppSettings()` → `{ settings, update }`.
- Produces: `<ScreenshotSaveSettings />`, a `Row` with two buttons (same primary/outline pattern as `LanguageSettings`).

- [ ] **Step 1: Add copy**

`settings` namespace, both files, after `"appDescription"`:

en:

```json
    "screenshots": "Screenshots",
    "screenshotSave": "Save screenshots",
    "screenshotSaveDescription": "Automatically keeps every capture in your Library the moment it is taken. When I click Save keeps it in the editor until you save it — closing without saving discards it.",
    "screenshotSaveAuto": "Automatically",
    "screenshotSaveManual": "When I click Save",
```

es:

```json
    "screenshots": "Capturas",
    "screenshotSave": "Guardar capturas",
    "screenshotSaveDescription": "Automáticamente guarda cada captura en tu Biblioteca en cuanto la tomas. Al hacer clic en Guardar la mantiene en el editor hasta que la guardes; cerrar sin guardar la descarta.",
    "screenshotSaveAuto": "Automáticamente",
    "screenshotSaveManual": "Al hacer clic en Guardar",
```

Run: `bunx vitest run --root ../../packages/i18n` → PASS.

- [ ] **Step 2: Write the failing component test**

Create `src/renderer/src/pages/settings/screenshot-save-settings.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { DEFAULT_SETTINGS } from "@shared/types";
import { ScreenshotSaveSettings } from "./screenshot-save-settings";

describe("ScreenshotSaveSettings", () => {
  it("marks the stored mode and writes the other one on click", async () => {
    const update = vi.fn().mockResolvedValue({ ...DEFAULT_SETTINGS, screenshotSave: "manual" });
    window.electronAPI.getSettings = vi.fn().mockResolvedValue(DEFAULT_SETTINGS);
    window.electronAPI.updateSettings = update;
    render(<ScreenshotSaveSettings />);

    const auto = await screen.findByRole("button", { name: /automatically/i });
    const manual = screen.getByRole("button", { name: /when i click save/i });
    await waitFor(() => expect(auto).toHaveAttribute("aria-pressed", "true"));
    expect(manual).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(manual);
    expect(update).toHaveBeenCalledWith({ screenshotSave: "manual" });
  });
});
```

- [ ] **Step 3: Run to verify it fails**

Run: `bunx vitest run src/renderer/src/pages/settings/screenshot-save-settings.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement**

`screenshot-save-settings.tsx`:

```tsx
import React from "react";
import { useTranslations } from "@kaipu/i18n";
import type { ScreenshotSaveMode } from "@shared/types";
import { Row } from "@renderer/ui/row";
import { Button } from "@renderer/ui/button";
import { useAppSettings } from "./use-app-settings";

/** Auto-save vs explicit save for screenshots — writes AppSettings.screenshotSave. */
export function ScreenshotSaveSettings(): React.JSX.Element {
  const t = useTranslations("settings");
  const { settings, update } = useAppSettings();
  const current = settings?.screenshotSave ?? "auto";

  const options: ReadonlyArray<{ value: ScreenshotSaveMode; label: string }> = [
    { value: "auto", label: t("screenshotSaveAuto") },
    { value: "manual", label: t("screenshotSaveManual") },
  ];

  return (
    <Row
      label={t("screenshotSave")}
      description={t("screenshotSaveDescription")}
      action={
        <div style={{ display: "flex", gap: 8 }}>
          {options.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={current === option.value ? "primary" : "outline"}
              aria-pressed={current === option.value}
              onClick={() => void update({ screenshotSave: option.value })}
            >
              {option.label}
            </Button>
          ))}
        </div>
      }
    />
  );
}
```

(If `Button` does not forward arbitrary props such as `aria-pressed`, check `src/renderer/src/ui/button.tsx` — it spreads `...props` onto the `<button>` in the same way `IconButton` does; if not, add the spread.)

In `settings-pages.tsx` `AppSettingsPage`, after the existing `<Section title={t("app")}>…</Section>` add:

```tsx
      <Section title={t("screenshots")}>
        <ScreenshotSaveSettings />
      </Section>
```

and import `{ ScreenshotSaveSettings } from "./screenshot-save-settings";`.

- [ ] **Step 5: Run tests + typecheck**

Run: `bunx vitest run src/renderer/src/pages/settings && bun run check-types`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
bunx oxlint src/renderer/src/pages/settings && bunx oxfmt src/renderer/src/pages/settings ../../packages/i18n/messages
git add src/renderer/src/pages/settings ../../packages/i18n/messages
git commit -m "feat(settings): Screenshots section with the save-mode preference

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Auto-save on open + Discard in the screenshot editor

**Files:**

- Create: `src/renderer/src/features/screenshots/auto-save-policy.ts` (pure)
- Test: `src/renderer/src/features/screenshots/auto-save-policy.test.ts`
- Modify: `src/renderer/src/pages/screenshot-editor/screenshot-editor-page.tsx` (state block ~lines 60–100, `persist` ~157, toolbar buttons ~240, dialogs ~305–330)
- Modify: `packages/i18n/messages/en.json`, `es.json` (`screenshots` namespace: `discardSaved`, `discardSavedTitle`)

**Interfaces:**

- Produces: `shouldAutoSaveOnOpen(mode: ScreenshotSaveMode, sourceKind: "local" | "blob" | string): boolean` — true only for `mode === "auto"` and a non-`"local"` source.
- Editor: a **Discard** toolbar button visible when `savedId !== null && autoSaved` that calls `window.electronAPI.deleteLocalRecording(savedId)` and navigates to `/screenshots`.

- [ ] **Step 1: Write the failing policy test**

```ts
import { describe, expect, it } from "vitest";
import { shouldAutoSaveOnOpen } from "./auto-save-policy";

describe("shouldAutoSaveOnOpen", () => {
  it("saves a fresh capture on open only in auto mode", () => {
    expect(shouldAutoSaveOnOpen("auto", "blob")).toBe(true);
    expect(shouldAutoSaveOnOpen("manual", "blob")).toBe(false);
  });

  it("never re-saves a screenshot re-opened from the Library", () => {
    expect(shouldAutoSaveOnOpen("auto", "local")).toBe(false);
    expect(shouldAutoSaveOnOpen("manual", "local")).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `bunx vitest run src/renderer/src/features/screenshots/auto-save-policy.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the policy**

```ts
import type { ScreenshotSaveMode } from "@shared/types";

/**
 * Auto mode writes a FRESH capture to the vault as soon as the editor can export it.
 * A screenshot re-opened from the Library already has a row (`source.kind === "local"`)
 * and must never get a second one on open.
 */
export function shouldAutoSaveOnOpen(mode: ScreenshotSaveMode, sourceKind: string): boolean {
  return mode === "auto" && sourceKind !== "local";
}
```

Run the test → PASS.

- [ ] **Step 4: Add the Discard copy**

`screenshots` namespace, both files, after `"discard"`:

en: `"discardSaved": "Discard", "discardSavedTitle": "Delete this capture from the Library",`
es: `"discardSaved": "Descartar", "discardSavedTitle": "Eliminar esta captura de la Biblioteca",`

Run: `bunx vitest run --root ../../packages/i18n` → PASS.

- [ ] **Step 5: Wire the editor**

In `screenshot-editor-page.tsx`:

1. Imports: `import { useNavigate } from "react-router-dom";` (extend the existing import), `import { shouldAutoSaveOnOpen } from "@renderer/features/screenshots/auto-save-policy";`, `import { useAppSettings } from "@renderer/pages/settings/use-app-settings";`.

2. After the `savedId` state (line ~72) add:

```ts
  // Auto-save mode is read ONCE when the editor opens; a Settings change while this
  // capture is open neither retro-saves nor un-saves it.
  const { settings } = useAppSettings();
  const autoSaveRef = useRef<boolean | null>(null);
  if (autoSaveRef.current === null && settings) {
    autoSaveRef.current = shouldAutoSaveOnOpen(settings.screenshotSave, source.kind);
  }
  // True once THIS editor created the item on open — enables Discard.
  const [autoSaved, setAutoSaved] = useState(false);
  const navigate = useNavigate();
```

3. `persist` is declared as a `const` arrow below; the auto-save effect must run after the image is ready. Add this effect **after** the `persist` definition (so the closure sees it):

```ts
  // Auto mode: the first save happens the moment the image can be exported, before any
  // edit. Failure leaves the editor in manual behaviour (dirty, guarded) — `persist`
  // already reports with a retry.
  const autoSaveFired = useRef(false);
  useEffect(() => {
    if (!imageReady || autoSaveFired.current || !autoSaveRef.current || savedId) return;
    autoSaveFired.current = true;
    void persist({}).then(() => setAutoSaved(true));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once when the image is ready
  }, [imageReady]);
```

`persist` resolves even on failure (it catches), so `setAutoSaved(true)` must be guarded: change `persist` to return a boolean — `return true` after `showFeedback(...)`, `return false` in the `catch` — and use `.then((ok) => { if (ok) setAutoSaved(true); })`. Update `persist`'s signature: `Promise<boolean>`. The two existing callers ignore the return value, so nothing else changes.

4. Discard handler, next to `onSaveCopy`:

```ts
  const onDiscardSaved = async (): Promise<void> => {
    if (!savedId || busy.current) return;
    busy.current = true;
    try {
      await window.electronAPI.deleteLocalRecording(savedId);
      setDirty(false);
      navigate("/screenshots");
    } catch (error) {
      reportError(t("saveError"), error, { context: { phase: "discard", id: savedId } });
    } finally {
      busy.current = false;
    }
  };
```

5. Toolbar: next to the Save button (line ~240) add, only when `autoSaved && savedId`:

```tsx
          {autoSaved && savedId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void onDiscardSaved()}
              title={t("discardSavedTitle")}
            >
              {t("discardSaved")}
            </Button>
          )}
```

(match whatever button component the toolbar already uses for Save; if it uses a raw `<button className={styles.toolButton}>`, use the same.)

- [ ] **Step 6: Typecheck, lint, run the neighbouring tests**

Run: `bun run check-types && bunx oxlint src/renderer/src/pages/screenshot-editor src/renderer/src/features/screenshots && bunx vitest run src/renderer/src/features/screenshots src/renderer/src/pages/settings src/main/services`
Expected: clean and PASS.

- [ ] **Step 7: Manual verification (record in the PR body)**

`bun run dev`, then:

- Default (auto): ⌃⌘X → capture → editor opens → the Library (other tab) shows the item immediately; close the editor without touching Save → no dialog, item present.
- Auto: Save → the overwrite/copy dialog; Overwrite → still one item. Discard → item gone, back on `/screenshots`.
- Settings → Screenshots → _When I click Save_: capture → close → discard dialog appears; confirm → nothing in the Library.
- Re-open a saved screenshot from the Library in auto mode → no duplicate created.

- [ ] **Step 8: Commit**

```bash
bunx oxfmt src/renderer/src/pages/screenshot-editor src/renderer/src/features/screenshots ../../packages/i18n/messages
git add src/renderer/src/pages/screenshot-editor src/renderer/src/features/screenshots ../../packages/i18n/messages
git commit -m "feat(screenshots): auto-save a fresh capture on open (per setting) with Discard

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Docs + PR

- [ ] **Step 1:** `apps/documentation/src/content/docs/backlog/settings-screenshots.md` status → `🟢 Ready to validate — implemented in [#NNN](…) (2026-09-23)`; `backlog/index.mdx` row → same; in `backlog/screenshot-save-strategy.md` § 1, add one line: "_Resolved 2026-09-23 as a preference — see [Settings → Screenshots](./settings-screenshots)._". Format with oxfmt.
- [ ] **Step 2:** Full run: `bun run check-types && bunx vitest run` from `apps/kaipu-record`.
- [ ] **Step 3:** Commit `docs(backlog): settings → screenshots ready to validate` and open the PR: title `feat(screenshots): save automatically or on click (Settings → Screenshots)`, body with summary, **What to review** (route: `auto-save-policy.ts` → the editor's auto-save effect and the `persist` boolean → settings row), the manual checklist from Task 3 Step 7, and the `🤖 Generated with [Claude Code](https://claude.com/claude-code)` footer.
