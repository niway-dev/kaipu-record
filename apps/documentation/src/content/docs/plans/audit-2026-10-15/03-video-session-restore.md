---
title: "03 · Video session restore"
description: "Closes VID-A1 and VID-B3: a session that fails to load opens a blank editor, and the first autosave overwrites the saved session and prunes its slide PNGs."
---

# Video session restore — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A saved edit session that cannot be restored is never overwritten: "no session" means only a missing file, any other load failure tells the user and locks persistence for that editor session.

**Architecture:** `loadSession` returns `null` only on ENOENT and rethrows every other read error (EACCES, EISDIR, EBUSY…); asset PNGs are written temp-and-rename. The loader in `video-editor-page.tsx` distinguishes "fresh" (persist) from "unreadable / invalid" (do not persist): it opens a blank scene with `persist: false`, shows `restoreError`, and reports the cause. `useSessionAutosave` gains an `enabled` argument; both export `onSaved` saves honour the same flag. The IPC contract is unchanged (a `{none|ok|corrupt}` union was rejected: main cannot run `parseSession`, which lives in the renderer).

**Tech Stack:** Node fs, vitest, `@testing-library/react` (the existing `video-editor-page.test.tsx` harness).

**Spec:** [Audit report](/audits/2026-10-15/report/) → VID-A1 in [video lens A](/audits/2026-10-15/findings/video-a/), VID-B3 in [video lens B](/audits/2026-10-15/findings/video-b/). Closes: **VID-A1, VID-B3**.

## Global Constraints

- Paths are relative to `apps/kaipu-record/src/`. Tests: `node_modules/.bin/vitest run <file>` from `apps/kaipu-record` — never `bunx`.
- IPC shape stays `LoadResult | null`; only the doc comment at `shared/types/electron-api.ts:358-360` changes ("null only when the file does not exist; rejects on any other read error").
- `loadSession` can now reject. Its only renderer callers are the loader (outer `catch`) and the MP4 `onSaved` unmounted branch (`video-editor-page.tsx:670`) — Task 3 guards both.
- A locked editor still has no unsaved-changes warning (`pendingRef` stays false). Accepted for this rare path; say so in the PR (follow-up: drive the blocker from `controller.dirty` when locked).
- Plan 09 (autosave assets) edits the asset-write loop too; whichever lands second rebases on the other (both keep temp-and-rename).
- i18n is consumed from `packages/i18n/dist`; rebuild the package if the page test still sees the old string.
- Commit messages in English, conventional-commit style.

## Review Focus

1. Invalid JSON on disk → toast, edit, wait past the 800 ms debounce → `saveVideoEditSession` never called — Task 3 test.
2. `loadVideoEditSession` rejecting (EACCES) → same as 1 — Task 3 test.
3. `loadSession` on a path that is a directory (EISDIR) must reject, not return `null` — Task 1 test.
4. One undecodable slide PNG must not discard the rest of the session — Task 3 test with `FailingImage`.
5. Control: a genuinely missing session must still autosave — Task 3 test.

---

### Task 1: `loadSession` distinguishes ENOENT; atomic asset writes

**Files:**

- Modify: `main/library/video-edit-session.ts:119-121`, `:169-206`
- Test: `main/library/video-edit-session.test.ts`

- [ ] **Step 1: Write the failing tests**

(The suite mocks `./vault-location` through `vi.hoisted` state and uses a real temp dir.)

```ts
it("rethrows a read error other than ENOENT instead of reporting no session", async () => {
  await mkdir(join(state.dir, ".kaipu", "rec-1.edit.json"), { recursive: true }); // a directory where the file should be
  await expect(loadSession("rec-1")).rejects.toThrow();
});

it("leaves no .tmp file next to an asset after a save", async () => {
  await saveSession("rec-1", "{}", [{ assetId: "asset-a", bytes: bytesOf("png") }]);
  expect(await readdir(join(state.dir, ".kaipu", "rec-1.assets"))).toEqual(["asset-a.png"]);
});
```

Add `mkdir` to the fs import.

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/main/library/video-edit-session.test.ts` → the first FAILS (resolves `null`).

- [ ] **Step 3: Implement**

Above `loadSession`:

```ts
function isNotFound(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}
```

Session read catch:

```ts
  } catch (error) {
    // Only a missing file means "no session yet". Any other failure (EACCES, EMFILE,
    // EBUSY, EISDIR) must surface, or the editor opens fresh and its first autosave
    // overwrites a valid session.
    if (isNotFound(error)) return null;
    throw error;
  }
```

`readdir(ad)` catch → `catch (error) { if (!isNotFound(error)) throw error; /* missing dir = no slides */ }`. Asset read catch:

```ts
    } catch (error) {
      if (isNotFound(error)) continue; // vanished between readdir and read
      throw error; // a skipped asset would be pruned by the next save: fail loudly instead
    }
```

Asset write (lines 119-121):

```ts
  for (const { assetId, bytes } of assets) {
    const target = assetPath(id, assetId);
    // temp + rename like the session JSON: a crash mid-write must not leave a truncated PNG.
    await writeFile(`${target}.tmp`, Buffer.from(bytes));
    await rename(`${target}.tmp`, target);
  }
```

(`rename` is already imported for the session JSON; prune and load filter on `.png`, so a stray `.png.tmp` is ignored. If plan 04 has landed, use `atomicWriteFile(target, Buffer.from(bytes))` instead.)

Update the doc comment at `shared/types/electron-api.ts:358-360`.

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/main/library/video-edit-session.test.ts src/main/library/edit-project-probe.test.ts` → PASS.

```bash
git add src/main/library/video-edit-session.ts src/main/library/video-edit-session.test.ts src/shared/types/electron-api.ts
git commit -m "fix(desktop): only a missing edit session reads as 'no session'; atomic asset writes"
```

### Task 2: `useSessionAutosave(…, enabled)`

**Files:**

- Modify: `renderer/src/features/video-editor/use-session-autosave.ts:46-51`, `:102-119`
- Test: `renderer/src/features/video-editor/use-session-autosave.test.ts`

**Interfaces:**

- Produces: `useSessionAutosave(sourceId, scene, interacting, assetStoreRef, enabled = true)`.

- [ ] **Step 1: Write the failing test**

Extend the suite's `render` helper so the hook receives a fifth `enabled` prop (default `true`), then:

```ts
it("never writes when disabled", async () => {
  const { rerender, result } = render(OPENED, false, /* enabled */ false);
  rerender({ scene: EDITED, interacting: false, enabled: false });
  await act(async () => {
    vi.advanceTimersByTime(AUTOSAVE_DEBOUNCE_MS + 10);
  });
  expect(saved).toEqual([]);
  expect(result.current.pendingRef.current).toBe(false);
});
```

(Use whatever edited-scene fixture the suite already has next to `OPENED`.)

- [ ] **Step 2: Run to verify it fails** — `node_modules/.bin/vitest run src/renderer/src/features/video-editor/use-session-autosave.test.ts` → FAIL (a save is recorded).

- [ ] **Step 3: Implement**

Signature:

```ts
export function useSessionAutosave(
  sourceId: string,
  scene: VideoScene,
  interacting: boolean,
  assetStoreRef: React.MutableRefObject<SlideAssetStore>,
  /** False when the session on disk could not be restored: nothing is ever written. */
  enabled = true,
): SessionAutosave {
```

Schedule effect: first line `if (!enabled) return;`, deps `[scene, interacting, write, enabled]`. Because `pendingRef` never becomes true, `flush` and the `beforeunload`/unmount effect are no-ops.

- [ ] **Step 4: Run and commit** — PASS.

```bash
git add src/renderer/src/features/video-editor/use-session-autosave.ts src/renderer/src/features/video-editor/use-session-autosave.test.ts
git commit -m "feat(desktop): session autosave can be disabled for an unrestorable session"
```

### Task 3: Loader locks persistence on restore failure

**Files:**

- Modify: `renderer/src/pages/video-editor/video-editor-page.tsx:269-272` (state), `:289-298` (`open`), `:299-337` (load block), `:350-374` (render + props), `:381` (autosave), `:659-698` (MP4 `onSaved`), `:769-796` (GIF `onSaved`)
- Modify: `packages/i18n/messages/en.json:670`, `es.json:670`
- Test: `renderer/src/pages/video-editor/video-editor-page.test.tsx`

- [ ] **Step 1: Write the failing tests**

New `describe("VideoEditorPage — restore failure")` using the suite's `renderEditor()`, `waitForEditorLoaded()`, `makeDirty(footer)`, `getToasts()`, `vi.stubGlobal("Image", FakeImage)`; `afterEach` dismisses toasts and `vi.restoreAllMocks()`:

```tsx
it("does not autosave over a session that failed validation", async () => {
  vi.spyOn(window.electronAPI, "loadVideoEditSession").mockResolvedValue({ sessionJson: "{not json", assets: [] });
  const save = vi.spyOn(window.electronAPI, "saveVideoEditSession");
  const { footer } = await renderEditor();
  await waitForEditorLoaded();
  await waitFor(() =>
    expect(getToasts()).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/Couldn't restore/) })),
  );
  makeDirty(footer);
  await new Promise((r) => setTimeout(r, 1200)); // past the 800 ms debounce
  expect(save).not.toHaveBeenCalled();
});

it("does not autosave when the session read rejects", async () => {
  vi.spyOn(window.electronAPI, "loadVideoEditSession").mockRejectedValue(new Error("EACCES"));
  const save = vi.spyOn(window.electronAPI, "saveVideoEditSession");
  const { footer } = await renderEditor();
  await waitForEditorLoaded();
  makeDirty(footer);
  await new Promise((r) => setTimeout(r, 1200));
  expect(save).not.toHaveBeenCalled();
});

it("still autosaves a genuinely new session", async () => {
  vi.spyOn(window.electronAPI, "loadVideoEditSession").mockResolvedValue(null);
  const save = vi.spyOn(window.electronAPI, "saveVideoEditSession");
  const { footer } = await renderEditor();
  await waitForEditorLoaded();
  makeDirty(footer);
  await waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 3000 });
});

it("keeps the session when one slide asset cannot be decoded", async () => {
  vi.stubGlobal("Image", FailingImage);
  vi.spyOn(window.electronAPI, "loadVideoEditSession").mockResolvedValue({
    sessionJson: serializeSession(initialScene(30)),
    assets: [{ assetId: "bad", bytes: new ArrayBuffer(4) }],
  });
  await renderEditor();
  await waitForEditorLoaded();
  await waitFor(() =>
    expect(getToasts()).toContainEqual(expect.objectContaining({ message: expect.stringMatching(/Restored/) })),
  );
  expect(getToasts()).not.toContainEqual(expect.objectContaining({ message: expect.stringMatching(/Couldn't restore/) }));
});
```

- [ ] **Step 2: Run to verify they fail** — `node_modules/.bin/vitest run src/renderer/src/pages/video-editor/video-editor-page.test.tsx -t "restore failure"` → the first two FAIL (a save happens).

- [ ] **Step 3: Implement**

1. `resolved` state gains `persist: boolean`; `open` becomes:

```tsx
      const open = (scene: VideoScene, hasZoomData: boolean, persist = true): void => {
        if (cancelled) return;
        setResolved({
          scene: withInitialZooms(scene, hasZoomData, cursorTrack, source.durationSeconds),
          cursorTrack,
          persist,
        });
      };
```

2. Load block (happy path unchanged except the per-asset try/catch):

```tsx
      try {
        const saved = await window.electronAPI.loadVideoEditSession(source.id);
        if (cancelled) return;
        if (saved !== null) {
          const session = parseSession(saved.sessionJson);
          if (session !== null) {
            const loadedIds = new Set<string>();
            for (const { assetId, bytes } of saved.assets) {
              if (cancelled) return; // bail before creating a URL that would leak
              try {
                await assetStoreRef.current.restoreAsset(assetId, bytes, "image/png");
                loadedIds.add(assetId);
              } catch (error) {
                // One undecodable slide must not discard the rest: skip it; the filter
                // below drops only the slide items that point at it.
                captureException(error, { context: "video-edit-session-restore-asset" });
              }
            }
            if (cancelled) return;
            const filteredScene: VideoScene = {
              ...session.scene,
              items: session.scene.items.filter(
                (item) => item.kind !== "slide" || loadedIds.has(item.assetId),
              ),
            };
            showToast({ message: t("restored") });
            open(filteredScene, session.hasZoomData);
          } else {
            captureException(new Error("video edit session failed validation"), {
              context: "video-edit-session-restore",
            });
            showToast({ message: t("restoreError") });
            // The file on disk stays untouched: do not let autosave replace it.
            open(initialScene(source.durationSeconds), false, false);
          }
        } else {
          open(initialScene(source.durationSeconds), false); // fresh start, no toast
        }
      } catch (error) {
        captureException(error, { context: "video-edit-session-restore" });
        showToast({ message: t("restoreError") });
        open(initialScene(source.durationSeconds), false, false);
      }
```

3. Render `<VideoEditor … persistSession={resolved.persist} />`; add `persistSession: boolean` to the `VideoEditor` props; line 381 → `useSessionAutosave(source.id, scene, controller.interacting, assetStoreRef, persistSession)`.

4. MP4 `onSaved`: first statement `if (!persistSession) return;`. In the unmounted branch replace the read with:

```tsx
            const saved = await window.electronAPI.loadVideoEditSession(source.id).catch(() => undefined);
            if (saved === undefined) return; // could not read: never stamp over it
            const savedScene = saved ? parseSession(saved.sessionJson)?.scene : null;
```

Add `persistSession` to that `useCallback`'s deps.

5. GIF `onSaved`: keep `autosave.cancel()` and the toast; wrap the `try { … saveVideoEditSession … markClean() } catch {…}` in `if (persistSession) { … }`; add `persistSession` to its deps.

6. i18n `videoEditor.restoreError` — en: `"Couldn't restore your previous edit. It is still on disk, but changes made now won't be saved."`; es: `"No se pudo restaurar tu edición anterior. Sigue en el disco, pero los cambios que hagas ahora no se guardarán."`

- [ ] **Step 4: Run and commit**

Run: `node_modules/.bin/vitest run src/renderer/src/pages/video-editor/ && bun run check-types` → PASS.

```bash
git add src/renderer/src/pages/video-editor/video-editor-page.tsx src/renderer/src/pages/video-editor/video-editor-page.test.tsx ../../packages/i18n/messages/en.json ../../packages/i18n/messages/es.json
git commit -m "fix(desktop): never overwrite an edit session that failed to restore"
```

### Task 4: Ship

- [ ] Open a PR titled `fix(desktop): protect an unrestorable edit session from autosave (audit VID-A1, VID-B3)` linking this plan and both findings; mention the accepted gap (no unsaved warning while locked). End with **How to test it yourself**:
  1. Edit a recording (add a slide), wait 2 s, quit. Truncate `<vault>/.kaipu/<id>.edit.json` to half its bytes. Reopen the recording → toast "Couldn't restore your previous edit…". Make an edit, wait 3 s → the file is byte-identical to the truncated one and `<id>.assets/` still holds the slide PNG.
  2. Restore a valid file, `chmod 000` it, reopen → same toast, file untouched. `chmod 644` and reopen → "Restored your previous edit".
  3. Fresh recording (no session): edit, wait 2 s → `.edit.json` appears.
- [ ] The PR deletes this plan file and removes its row from `plans/audit-2026-10-15/00-index.md`.
