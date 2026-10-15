---
title: "05 · Screenshot editor save races"
description: "Closes SHOT-B1, SHOT-B2, SHOT-B4, SHOT-B8, SHOT-B9: edits during a save are marked clean and lost; a capture taken while dirty is discarded; Discard deletes the wrong item; auto actions can be skipped; clicks during an export are dropped."
---

# Screenshot editor save races — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The screenshot editor never marks an edit as saved that is not on disk, never drops a click, never deletes a user's own save on Discard, never loses a capture taken while it is dirty, and always runs the configured auto actions.

**Architecture:** In `screenshot-editor-page.tsx` (545 lines, no tests today) a promise queue (`enqueue`) replaces the `busy` ref so clicks wait instead of being dropped; a `sceneRevision` ref bumped by the existing dirty effect lets `persist()` clear `dirty` only if no edit landed during the save; a `latest` ref (scene + title draft, refreshed every render) lets queued jobs and toast Retry export the current scene; an `alive` ref makes post-unmount retries no-ops; `autoSavedId` is the only id Discard may delete; the auto-actions effect also waits for settings (`actionsReady`). For a capture that arrives while dirty, "Keep editing" saves the incoming raw PNG to the vault and offers "Open" in a toast (durable, unlike an in-memory stash). `useEditorScene` is untouched.

**Tech Stack:** React 18 + react-router `useBlocker`, vitest + `@testing-library/react` with a memory router (the `editor-routes.test.tsx` setup), `test/setup.ts`'s `window.electronAPI` stub.

**Spec:** [Audit report](/audits/2026-10-15/report/) → SHOT-B1, B2, B4, B8, B9 in [screenshot lens B](/audits/2026-10-15/findings/screenshot-b/). Closes: **SHOT-B1, SHOT-B2, SHOT-B4, SHOT-B8, SHOT-B9**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/renderer/src/` unless stated. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- No IPC, preload or shared-type changes.
- jsdom never fires `<img>` load and lacks `URL.createObjectURL`: page tests fire `load` by hand and stub the URL functions.
- Behaviour changes to state in the PR: (1) after **any** manual save the Discard button disappears (Discard only ever deletes the auto-saved item); (2) a click during a running export waits instead of being dropped — a hung IPC call now blocks later clicks; (3) "Keep editing" on a new capture creates a vault item the user did not ask for (raw PNG, `manual: false`, so it does not appear in Editor home "Continue").
- Plan 01 adds `timed()` around `exportAs` and `trackExport` calls to the same page; plan 31 reworks the composite cache. Whichever lands later rebases; keep `exportAs(format, snap)` as the single export entry point.
- i18n keys go in `packages/i18n/messages/{en,es}.json` under `screenshots` (neutral Spanish).
- Commit messages in English, conventional-commit style.

## Review Focus

1. Edit during an in-flight save → `dirty` stays true → leaving the editor shows the discard dialog — Task 2 test (B1), plus the control without the edit.
2. Title typed during a save is not overwritten by `adopt(saved.title)` — Task 2 test.
3. Toast Retry after unmount must not call `saveScreenshot` again — Task 2 test (B9).
4. Settings resolving **after** the image loaded must still auto-save — Task 2 test (B8).
5. Double-click Save on a fresh shot: the second call carries `overwriteId` = first id, never a duplicate item — Task 2 test.

---

### Task 1: Page test harness (first test, red for the right reason)

**Files:**

- Create: `pages/screenshot-editor/screenshot-editor-page.test.tsx`

**Interfaces:**

- Consumes: `ScreenshotEditorPage` (route `/editor/capture`, reads the source from router state), `getToasts`/`dismissToast` from `@renderer/ui/toast-store`, `window.electronAPI` stub from `test/setup.ts` (`getSettings` → `screenshotSave: "auto"`, `screenshotCopy: "auto"`; `saveScreenshot` throws "not implemented").

- [ ] **Step 1: Write the harness and the B1 test**

```tsx
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dismissToast, getToasts } from "@renderer/ui/toast-store";
import { ScreenshotEditorPage } from "./screenshot-editor-page";

const exportScene = vi.hoisted(() => vi.fn());
vi.mock("@renderer/features/screenshots/export", () => ({ exportScene }));

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};
const SOURCE = { kind: "blob" as const, bytes: new Uint8Array([1, 2, 3]).buffer, width: 4, height: 4, title: "Shot" };
const saved = (id: string, title = "Shot") => ({ id, assetId: `a-${id}`, title, kind: "screenshot" });

type Settings = Awaited<ReturnType<typeof window.electronAPI.getSettings>>;
let base: Settings;
beforeEach(async () => {
  base = await window.electronAPI.getSettings();
  URL.createObjectURL = vi.fn(() => "blob:shot");
  URL.revokeObjectURL = vi.fn();
  exportScene.mockResolvedValue(new ArrayBuffer(1));
  window.electronAPI.saveScreenshot = vi.fn(async () => saved("s1")) as never;
  window.electronAPI.copyImageToClipboard = vi.fn(async () => {});
});
afterEach(() => getToasts().forEach((x) => dismissToast(x.id)));

function mount(
  mode: { screenshotSave: "auto" | "manual"; screenshotCopy: "auto" | "manual" },
  getSettings?: () => Promise<Settings>,
) {
  window.electronAPI.getSettings = getSettings ?? vi.fn(async () => ({ ...base, ...mode }));
  const router = createMemoryRouter(
    [
      { path: "/editor/capture", element: <ScreenshotEditorPage /> },
      { path: "/library", element: <div>library</div> },
      { path: "/screenshots", element: <div>screenshots</div> },
    ],
    { initialEntries: [{ pathname: "/editor/capture", state: SOURCE }] },
  );
  return { router, view: render(<RouterProvider router={router} />) };
}
const MANUAL = { screenshotSave: "manual" as const, screenshotCopy: "manual" as const };
// jsdom never fires <img> load; firing it flips `imageReady`.
const loadImage = async () => fireEvent.load(await screen.findByRole("img"));
// The Padding slider calls onLive -> setLive, which changes scene.beautify.state and fires the dirty effect.
const editPadding = () => {
  const range = screen.getByText("Padding").parentElement!.parentElement!.querySelector("input[type=range]")!;
  fireEvent.keyDown(range);
  fireEvent.change(range, { target: { value: "40" } });
  fireEvent.keyUp(range);
};

describe("ScreenshotEditorPage — save races", () => {
  it("keeps the editor dirty when an edit lands during a save (SHOT-B1)", async () => {
    const { router } = mount(MANUAL);
    await loadImage();
    const d = deferred<ArrayBuffer>();
    exportScene.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    editPadding();
    d.resolve(new ArrayBuffer(1));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalled());
    await act(async () => {});
    act(() => void router.navigate("/library"));
    expect(await screen.findByRole("alertdialog")).toBeInTheDocument();
  });

  it("navigates freely after a save with no edit in between (control)", async () => {
    const { router } = mount(MANUAL);
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalled());
    await act(async () => {});
    act(() => void router.navigate("/library"));
    expect(await screen.findByText("library")).toBeInTheDocument();
  });
});
```

If a selector does not match (e.g. the slider's DOM), fix the selector, not the assertion.

- [ ] **Step 2: Run to verify the right red**

Run: `node_modules/.bin/vitest run src/renderer/src/pages/screenshot-editor/screenshot-editor-page.test.tsx`
Expected: the B1 test FAILS because `/library` renders (the save cleared `dirty`); the control PASSES.

- [ ] **Step 3: Commit the harness**

```bash
git add src/renderer/src/pages/screenshot-editor/screenshot-editor-page.test.tsx
git commit -m "test(desktop): screenshot editor page harness with a failing save-race case"
```

### Task 2: Queue, revision, `latest`, `alive`, `autoSavedId`, settings gate (B1, B4, B8, B9)

**Files:**

- Modify: `pages/screenshot-editor/screenshot-editor-page.tsx` — imports; L104-109 (`busy`, `savedId`); L112-122 (auto actions); L150-163 (dirty effect); L197-352 (export/copy/persist/pdf/auto/discard/save handlers); L316-323 (auto effect); JSX L447 (Discard button)
- Test: the file from Task 1

- [ ] **Step 1: Add the remaining failing tests**

```tsx
  it("does not overwrite a title typed during the save", async () => {
    mount(MANUAL);
    await loadImage();
    const d = deferred<ArrayBuffer>();
    exportScene.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    const title = screen.getByRole("textbox", { name: /title/i });
    fireEvent.change(title, { target: { value: "Mine" } });
    d.resolve(new ArrayBuffer(1));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalled());
    await act(async () => {});
    expect((title as HTMLInputElement).value).toBe("Mine");
  });

  it("runs a Copy clicked during a save after it, instead of dropping it (SHOT-B9)", async () => {
    mount(MANUAL);
    await loadImage();
    const d = deferred<ArrayBuffer>();
    exportScene.mockReturnValueOnce(d.promise);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(window.electronAPI.copyImageToClipboard).not.toHaveBeenCalled();
    d.resolve(new ArrayBuffer(1));
    await waitFor(() => expect(window.electronAPI.copyImageToClipboard).toHaveBeenCalledTimes(1));
  });

  it("ignores a toast Retry after unmount (SHOT-B9)", async () => {
    window.electronAPI.saveScreenshot = vi.fn().mockRejectedValueOnce(new Error("disk")) as never;
    const { view } = mount(MANUAL);
    await loadImage();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(getToasts()).toHaveLength(1));
    view.unmount();
    getToasts()[0].action!.onClick();
    await act(async () => {});
    expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(1);
  });

  it("auto-saves when settings resolve after the image loaded (SHOT-B8)", async () => {
    const s = deferred<Settings>();
    mount(MANUAL, () => s.promise);
    await loadImage();
    expect(window.electronAPI.saveScreenshot).not.toHaveBeenCalled();
    await act(async () => s.resolve({ ...base, screenshotSave: "auto", screenshotCopy: "manual" }));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(1));
  });

  it("hides Discard after a manual Save copy and only deletes the auto-saved id (SHOT-B4)", async () => {
    window.electronAPI.saveScreenshot = vi
      .fn()
      .mockResolvedValueOnce(saved("auto1"))
      .mockResolvedValueOnce(saved("copy1", "Shot (copy)")) as never;
    window.electronAPI.deleteLocalRecording = vi.fn(async () => {});
    mount({ screenshotSave: "auto", screenshotCopy: "manual" });
    await loadImage();
    await waitFor(() => expect(screen.getByRole("button", { name: /discard/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.click(await screen.findByRole("button", { name: /save (a )?copy/i }));
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole("button", { name: /discard/i })).toBeNull();
  });

  it("turns a double Save on a fresh shot into an overwrite of the first save", async () => {
    mount(MANUAL);
    await loadImage();
    const save = screen.getByRole("button", { name: "Save" });
    fireEvent.click(save);
    fireEvent.click(save);
    await waitFor(() => expect(window.electronAPI.saveScreenshot).toHaveBeenCalledTimes(2));
    expect(vi.mocked(window.electronAPI.saveScreenshot).mock.calls[1][1]).toMatchObject({ overwriteId: "s1" });
  });
```

- [ ] **Step 2: Run to verify they fail** — all FAIL except possibly the title one.

- [ ] **Step 3: Implement**

Imports: add `import { ROUTES } from "@shared/routes";`, `import { showToast } from "@renderer/ui/toast-store";`, `import { editorPathFor } from "@renderer/features/editor/open-in-editor";` (the last two are used in Task 3), and `type Scene` to the annotations import.

Replace L104-106 (`busy`):

```tsx
  // Exports/saves run one at a time, in click order. A click during another export
  // WAITS instead of being dropped (SHOT-B9); the queue also keeps a double-click on a
  // fresh shot from creating two library entries (see `bindToSaved`).
  const queueTail = useRef<Promise<unknown>>(Promise.resolve());
  const enqueue = <T,>(job: () => Promise<T>): Promise<T> => {
    const run = queueTail.current.then(job);
    queueTail.current = run.catch(() => undefined);
    return run;
  };
  // False after unmount: jobs that start later and toast Retry buttons become no-ops.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true; // StrictMode re-runs effects
    return () => {
      alive.current = false;
    };
  }, []);
```

After `const [savedId, setSavedId] = …`:

```tsx
  // Queued jobs read these when they RUN, not from the render that queued them.
  const savedIdRef = useRef(savedId);
  // The item auto-save created on open: the ONLY thing Discard may delete (SHOT-B4).
  const autoSavedId = useRef<string | null>(null);
```

Replace L150-163:

```tsx
  const isFreshCapture = source.kind !== "local";
  const [dirty, setDirty] = useState(isFreshCapture);
  // Bumped per scene edit. A save clears `dirty` only if no edit landed meanwhile (SHOT-B1).
  const sceneRevision = useRef(0);
  const latest = useRef<{ scene: Scene; draft: string }>({
    scene: { beautify: scene.beautify.state, annotations: scene.annotations, crop: scene.crop },
    draft: captureTitle.draft,
  });
  latest.current = {
    scene: { beautify: scene.beautify.state, annotations: scene.annotations, crop: scene.crop },
    draft: captureTitle.draft,
  };
  const sceneSettled = useRef(false);
  useEffect(() => {
    if (!sceneSettled.current) {
      sceneSettled.current = true;
      return;
    }
    sceneRevision.current += 1;
    setDirty(true);
  }, [scene.beautify.state, scene.annotations, scene.crop]);
```

Replace L197-352 (the handlers) with:

```tsx
  const exportAs = async (format: ExportFormat, snap: Scene): Promise<ArrayBuffer> =>
    exportScene(format, {
      scene: snap,
      bytes: await image!.getBytes(),
      displayedW: imgRef.current?.clientWidth ?? 0,
    });

  const copyToClipboard = (): Promise<boolean> => {
    if (!imageReady) return Promise.resolve(false);
    return enqueue(async () => {
      if (!alive.current) return false;
      try {
        await window.electronAPI.copyImageToClipboard(await exportAs("png", latest.current.scene));
        return true;
      } catch (error) {
        reportError(t("copyError"), error, {
          context: { phase: "copy" },
          retry: () => {
            if (alive.current) void onCopy();
          },
        });
        return false;
      }
    });
  };
  const onCopy = async (): Promise<void> => {
    if (await copyToClipboard()) showFeedback({ kind: "copied" });
  };

  /** Returns the saved title, or null when the save failed (already reported). */
  const persist = (opts: {
    overwriteId?: string;
    title?: string;
    silent?: boolean;
    /** First Save of an unsaved shot: if an earlier queued save already created the item, overwrite it. */
    bindToSaved?: boolean;
  }): Promise<string | null> =>
    enqueue(async () => {
      if (!alive.current) return null;
      const revision = sceneRevision.current;
      const snap = latest.current.scene;
      const draftAtStart = latest.current.draft;
      const overwriteId =
        opts.overwriteId ?? (opts.bindToSaved ? (savedIdRef.current ?? undefined) : undefined);
      try {
        const saved = await window.electronAPI.saveScreenshot(await exportAs("png", snap), {
          title: opts.title ?? resolveCaptureTitle(draftAtStart, captureTitle.autoTitle),
          overwriteId,
          manual: !opts.silent,
        });
        savedIdRef.current = saved.id;
        setSavedId(saved.id);
        if (latest.current.draft === draftAtStart) captureTitle.adopt(saved.title); // don't clobber typing
        if (sceneRevision.current === revision) setDirty(false); // no edit landed during the save
        if (opts.silent) {
          autoSavedId.current = saved.id;
          setAutoSaved(true);
        } else {
          autoSavedId.current = null; // the user's own save is the keeper: hide Discard
          setAutoSaved(false);
          showFeedback({ kind: "saved", name: saved.title });
        }
        return saved.title;
      } catch (error) {
        reportError(t("saveError"), error, {
          context: { phase: "save", overwrite: overwriteId !== undefined },
          retry: () => {
            if (alive.current) void persist(opts);
          },
        });
        return null;
      }
    });

  const onExportPdf = (): Promise<void> => {
    if (!imageReady) return Promise.resolve();
    return enqueue(async () => {
      if (!alive.current) return;
      try {
        const written = await window.electronAPI.exportScreenshotFile(
          await exportAs("pdf", latest.current.scene),
          {
            suggestedName: resolveCaptureTitle(latest.current.draft, captureTitle.autoTitle),
            extension: "pdf",
          },
        );
        if (written) showFeedback({ kind: "exported", name: fileName(written.path) });
      } catch (error) {
        reportError(t("exportPdfError"), error, {
          context: { phase: "export", format: "pdf" },
          retry: () => {
            if (alive.current) void onExportPdf();
          },
        });
      }
    });
  };

  const runAutoActions = async (actions: AutoActions): Promise<void> => {
    const copied = actions.copy ? await copyToClipboard() : false;
    const savedTitle = actions.save ? await persist({ silent: true }) : null;
    if (savedTitle && copied) showFeedback({ kind: "savedAndCopied", name: savedTitle });
    else if (savedTitle) showFeedback({ kind: "saved", name: savedTitle });
    else if (copied) showFeedback({ kind: "copied" });
  };

  const autoActionsFired = useRef(false);
  const actionsReady = autoActionsRef.current !== null; // true on the render settings resolve
  useEffect(() => {
    const actions = autoActionsRef.current;
    if (!imageReady || !actionsReady || autoActionsFired.current || !actions || savedId) return;
    if (!actions.save && !actions.copy) return;
    autoActionsFired.current = true;
    void runAutoActions(actions);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fire once, when image AND settings are ready
  }, [imageReady, actionsReady]);

  const onDiscardSaved = (): Promise<void> =>
    enqueue(async () => {
      const id = autoSavedId.current;
      if (!id) return;
      try {
        await window.electronAPI.deleteLocalRecording(id);
        setDiscarding(true);
      } catch (error) {
        reportError(t("saveError"), error, { context: { phase: "discard", id } });
      }
    });

  const onSave = (): void => {
    if (!imageReady) return;
    if (savedId) setAskSave(true);
    else void persist({ bindToSaved: true });
  };
  const onOverwrite = (): void => {
    setAskSave(false);
    if (savedId) void persist({ overwriteId: savedId });
  };
  const onSaveCopy = (): void => {
    setAskSave(false);
    void persist({ title: `${captureTitle.title} (${t("copySuffix")})` });
  };
```

Delete the old L316-323 auto effect (now inside the block above). JSX: the Discard button condition `{autoSaved && savedId && (` becomes `{autoSaved && (`. `grep busy` in the file must return nothing.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/pages/screenshot-editor src/renderer/src/pages/editor && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/screenshot-editor/
git commit -m "fix(desktop): screenshot editor saves never drop edits, clicks or the wrong item"
```

### Task 3: Keep a capture that arrives while the editor is dirty (B2)

**Files:**

- Modify: `pages/screenshot-editor/screenshot-editor-page.tsx` (after the `blocker` line, L171-175; JSX L536-542)
- Modify: `features/screenshots/discard-changes-dialog.tsx:12-17`, `:33`
- Modify: `packages/i18n/messages/en.json`, `es.json` (`screenshots` namespace)
- Test: `features/screenshots/discard-changes-dialog.test.tsx`, the page test file

- [ ] **Step 1: Write the failing tests**

Dialog:

```tsx
it("explains that a new screenshot is waiting", () => {
  render(<DiscardChangesDialog neverSaved incomingCapture onDiscard={vi.fn()} onCancel={vi.fn()} />);
  expect(screen.getByText(/new screenshot is waiting/i)).toBeInTheDocument();
});
```

Page:

```tsx
  it("saves the incoming capture on Keep editing and offers to open it (SHOT-B2)", async () => {
    const { router } = mount(MANUAL);
    await loadImage();
    editPadding();
    act(() => void router.navigate("/editor/capture", { state: { ...SOURCE, title: "New", bytes: new Uint8Array([9]).buffer } }));
    fireEvent.click(await screen.findByRole("button", { name: /keep editing/i }));
    await waitFor(() =>
      expect(window.electronAPI.saveScreenshot).toHaveBeenCalledWith(
        expect.any(ArrayBuffer),
        expect.objectContaining({ title: "New", manual: false }),
      ),
    );
    expect(getToasts()[0].action?.label).toBe("Open");
  });
```

- [ ] **Step 2: Run to verify they fail.**

- [ ] **Step 3: Implement**

Page, after the `blocker` line and before `if (!image)`:

```tsx
  // A capture that arrived while this editor is dirty: its bytes exist only in the blocked navigation.
  const incomingShot =
    blocker.state === "blocked" && blocker.location.pathname === ROUTES.editorCapture
      ? (blocker.location.state as ImageSource | null)
      : null;
  const rescueIncoming = async (shot: ImageSource & { kind: "blob" }): Promise<void> => {
    try {
      // Raw PNG, not routed through the auto-save settings: the point is only not to lose it.
      const saved = await window.electronAPI.saveScreenshot(shot.bytes, {
        title: shot.title ?? autoTitle,
        manual: false,
      });
      showToast({
        message: t("incomingSaved"),
        durationMs: 15_000,
        action: {
          label: t("incomingOpen"),
          // The dirty blocker asks again, which is right: opening it discards the current edits.
          onClick: () => navigate(editorPathFor({ assetId: saved.assetId, kind: "screenshot" })),
        },
      });
    } catch (error) {
      reportError(t("saveError"), error, {
        context: { phase: "rescue-incoming" },
        retry: () => void rescueIncoming(shot),
      });
    }
  };
  const onKeepEditing = (): void => {
    blocker.reset();
    if (incomingShot?.kind === "blob") void rescueIncoming(incomingShot);
  };
```

JSX:

```tsx
      {blocker.state === "blocked" && (
        <DiscardChangesDialog
          neverSaved={savedId === null}
          incomingCapture={incomingShot !== null}
          onDiscard={() => blocker.proceed()}
          onCancel={onKeepEditing}
        />
      )}
```

Dialog: props gain `incomingCapture?: boolean`; body becomes `{incomingCapture ? t("discardBodyIncoming") : neverSaved ? t("discardBodyNeverSaved") : t("discardBody")}`.

i18n `screenshots` — en: `discardBodyIncoming`: "A new screenshot is waiting. If you keep editing, it is saved to your library as it is. If you discard, your edits and the new screenshot are both lost."; `incomingSaved`: "New screenshot saved to your library"; `incomingOpen`: "Open". es: "Hay una captura nueva esperando. Si sigues editando, se guarda en tu biblioteca tal cual. Si descartas, pierdes tus cambios y también la captura nueva."; "Captura nueva guardada en tu biblioteca"; "Abrir".

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/pages/screenshot-editor src/renderer/src/features/screenshots && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/screenshot-editor/ src/renderer/src/features/screenshots/discard-changes-dialog.tsx src/renderer/src/features/screenshots/discard-changes-dialog.test.tsx ../../packages/i18n/messages/en.json ../../packages/i18n/messages/es.json
git commit -m "feat(desktop): keep a screenshot taken while the editor has unsaved edits"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): screenshot editor save races (audit SHOT-B1/B2/B4/B8/B9)` linking this plan and the findings; list the three behaviour changes from Global Constraints. End with **How to test it yourself**:
  1. Auto-save on. Capture; immediately drag Padding while "Saving…" shows; after "Saved", click a sidebar item → the discard dialog appears (the edit is still unsaved).
  2. Capture; click Save twice fast → one library item.
  3. Edit a capture, press ⌘⌃X and take another → dialog says a new screenshot is waiting → "Keep editing" → toast "New screenshot saved…" with Open; the Library has the new raw shot.
  4. Auto-save on: Discard button visible; Save → Save copy → Discard button gone; the auto-saved item and the copy both remain.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
