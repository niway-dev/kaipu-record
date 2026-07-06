---
title: "Testing: Library flow"
description: "How the Library browse/open/rename/delete/reveal flow works and how to E2E-test it against a seeded vault."
---

# Library flow

## The flow

The Library is where a user manages everything they have captured locally:

1. **Browse** — `/library` lists every recording and screenshot in the vault as cards
   (grid) or rows (list), with search, kind/storage filters, and a sort menu.
2. **Open detail** — clicking a card/row navigates to `/library/:id`. Recordings show a
   playable `<video>`; screenshots show the still image; both show title + metadata and an
   action bar.
3. **Rename** — inline pencil on the title; type a new name, press Enter to commit.
4. **Delete** — the trash action opens an in-app confirm dialog; confirming removes the
   file from the vault and (from detail) navigates back to the list.
5. **Reveal in Finder** — the folder action asks the OS to reveal the file (native).
6. **Enter an editor** — recordings expose _"Editar video"_ (→ `/video-editor`);
   screenshots expose _"Edit"_ (→ `/screenshot-editor`) and _"Copy"_ (clipboard).

## Under the hood

**List page** — `src/renderer/src/pages/library/library-page.tsx`. Pulls
`videos/isLoading/hasError/refresh/remove` from `useLocalLibrary` and derives the visible
set through `useLibraryFilters`. Cards/rows are
`features/library/components/video-card.tsx` (`library-page.tsx:202`) and `video-row.tsx`
(`:214`); each fires `onNavigate` → `navigate('/library/:id')` and `onDelete` → sets
`pendingDelete`, which renders the shared `DeleteConfirmDialog` (`library-page.tsx:226`).

**Detail page** — `src/renderer/src/pages/library-detail/library-detail-page.tsx`. Finds
the item by `:id` in the same `useLocalLibrary` list (`:22`), branches on
`video.kind === "screenshot"` to render `ScreenshotViewer` vs `RecordingPlayer` (`:100`),
and wires the action bar (`:124`): _Editar video_ is gated on
`video.durationSeconds > 0` (`:85`), _Reveal_ calls `reveal(id)` (`:153`), _Delete_ opens
the in-app dialog then `doDelete` → `remove(id)` + `back()` (`:49`). Screenshot actions:
`editScreenshot` navigates to the screenshot editor with an `ImageSource` (`:72`) and
`copyScreenshot` calls the clipboard IPC (`:57`).

**Data hook** — `src/renderer/src/features/library/hooks/use-local-library.ts` is the one
bridge to main. It maps `LocalRecording → LibraryVideo`, and exposes:
`refresh()` → `listLocalRecordings` (`:39`), `rename()` → `renameLocalRecording` +
optimistic local update (`:57`), `remove()` → `deleteLocalRecording` + optimistic filter
(`:66`), `reveal()` → `revealLocalRecording` (`:75`). On mount it lists once and
subscribes to `onLibraryChanged` to re-list when the vault folder changes (`:82`).

**Rename state machine** — `hooks/use-rename-recording.ts`: a rename fires only when the
trimmed draft is non-empty and differs from the current title (`:37`). Pure/injectable —
already unit-tested.

**Confirm dialog** — `components/delete-confirm-dialog.tsx` renders through
`ui/modal.tsx`'s `ModalOverlay`, an in-renderer `role="alertdialog"` `aria-modal` overlay
(Escape / backdrop cancel). _This app does not use a native `dialog.showMessageBox` for
delete_ — deletion is confirmed entirely in the renderer, so it is fully driveable
headless. (A native `showMessageBox` only appears in the unrelated "change vault folder"
flow in `src/main/library/index.ts:88`.)

**Vault IPC (main)** — `src/main/library/index.ts:49` registers the handlers over a fresh
`LibraryVault` bound to the current folder (`currentVault()`, `:31`):
`listLocalRecordings` → `vault.list()`, `renameLocalRecording` → `vault.rename()`,
`deleteLocalRecording` → `vault.remove()` + best-effort edit-session cleanup (`:54`),
`revealLocalRecording` → `shell.showItemInFolder(...)` (`:59`).

**Vault store** — `src/main/library/library-vault.ts`. A recording is `<id><ext>` in the
vault root; metadata lives in a `.kaipu/<id>.json` sidecar and a `.kaipu/<id>.jpg`
thumbnail. `list()` deliberately lets a `readdir` failure propagate rather than returning
`[]` (an empty array reads as data loss) (`:56`). `rename()` merges `{ title }` into the
sidecar (`:128`). `remove()` best-effort-deletes the sidecar+thumbnail, then deletes the
real file and lets _that_ failure propagate (`:138`).

**Media protocol** — `src/main/media-protocol.ts` serves
`kaipu-media://recording|screenshot|thumb/<id>` with Range support (`streamFile`, `:55`);
the `206`/`Content-Range` behavior is what keeps `<video>` seeking alive. `RecordingPlayer`
points its `<video src>` at `kaipu-media://recording/<id>` (`recording-player.tsx:6`).

**Native / non-headless touchpoints:**

- _Reveal in Finder_ → `shell.showItemInFolder` (`index.ts:60`) — native, no renderer-side
  effect to observe.
- _Copy screenshot_ → `copyScreenshotById` IPC (`screenshot:copy-by-id`,
  `ipc.ts:168`) writes to the OS clipboard in main (fetch on `kaipu-media://` doesn't
  return bytes to the renderer, hence the by-id IPC).
- Delete confirm is _renderer-only_ (no native dialog) — driveable headless.

## Testability

✅ **Implemented** — `e2e/library-actions.e2e.ts` (rename, delete, reveal); the seeded-list
open is covered by `e2e/library.e2e.ts`.

**🟢 Fully E2E-able** (with two native exceptions asserted at the IPC boundary, not the OS
effect). The whole flow is renderer + a local temp vault, exactly what `launchApp()` seeds,
so listing, opening, `<video>` playback, rename, and delete all run headless on Linux CI
(`xvfb`, `--no-sandbox`).

**Already covered** by `e2e/library.e2e.ts`: one test that hash-navigates straight to
`#/library/:id` and asserts the _"Editar video"_ button is visible — i.e. the detail page
renders for a seeded recording and exposes the editor entry point. Adjacent coverage:
`e2e/playback.e2e.ts` guards the media-protocol Range/seek behavior, and
`e2e/export.e2e.ts` covers the video-editor → save → back-to-detail round trip.

**Not yet covered:** browsing the actual list (`#/library`), rename, delete, reveal, and
screenshot copy/edit.

## Proposed E2E test(s)

All use `launchApp()` + `dismissOnboarding(page)` from `e2e/helpers/launch.ts`. The helper
already seeds one recording (`RECORDING_ID = "e2e-sample"`) and returns `vaultDir` — the
deterministic boundary to assert against.

**1. List shows the seeded recording.**

```ts
const { page, teardown } = await launchApp();
await dismissOnboarding(page);
await page.evaluate(() => { location.hash = "#/library"; });
await expect(page.getByText("E2E Sample")).toBeVisible();
// clicking the card opens detail
await page.getByText("E2E Sample").click();
await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/#\/library\/e2e-sample/);
```

**2. Rename → assert list + sidecar updated.** Open detail, click the title's _Rename_
button (`title="Rename"`), type, Enter; then assert the on-disk sidecar reflects it:

```ts
await page.evaluate((id) => { location.hash = `#/library/${id}`; }, RECORDING_ID);
await page.getByRole("button", { name: "Rename" }).click();
const input = page.locator("input:focus");
await input.fill("Renamed Clip");
await input.press("Enter");
await expect(page.getByRole("heading", { name: "Renamed Clip" })).toBeVisible();
// deterministic boundary: the sidecar title was persisted
const sidecar = JSON.parse(
  await readFile(path.join(vaultDir, ".kaipu", `${RECORDING_ID}.json`), "utf-8"),
);
expect(sidecar.title).toBe("Renamed Clip");
```

**3. Delete → assert vault file gone + navigation back.** From detail, click _Delete_,
confirm in the in-app `alertdialog`, then assert the file is gone and the app is back on
the list:

```ts
await page.evaluate((id) => { location.hash = `#/library/${id}`; }, RECORDING_ID);
await page.getByRole("button", { name: "Delete" }).click();          // action bar
await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
await expect.poll(() => page.evaluate(() => location.hash)).toMatch(/#\/library$/);
// deterministic boundary: the mp4 is removed from disk
await expect.poll(() => access(path.join(vaultDir, `${RECORDING_ID}.mp4`)).then(() => true, () => false))
  .toBe(false);
```

(An in-list variant: navigate to `#/library`, click the card's trash button
(`title="Delete"`), confirm, assert the card disappears + file gone.)

**4. Reveal → assert the IPC was invoked (stub the native call).** `shell.showItemInFolder`
is native; override it in the _main_ process via `app.evaluate` before clicking, and assert
it was called with the seeded file path:

```ts
const { app, page, vaultDir, teardown } = await launchApp();
await app.evaluate(({ shell }) => {
  (globalThis as any).__revealed = [];
  shell.showItemInFolder = (p: string) => { (globalThis as any).__revealed.push(p); };
});
// open detail, click Reveal ...
await page.getByRole("button", { name: "Reveal" }).click();
const revealed = await app.evaluate(() => (globalThis as any).__revealed);
expect(revealed[0]).toBe(path.join(vaultDir, `${RECORDING_ID}.mp4`));
```

The handler reads `shell.showItemInFolder` off the module object at call time
(`index.ts:60`), so patching the property takes effect. _Unverified: exact `app.evaluate`
patch timing vs. handler registration — the handler is registered at startup and only reads
the property when invoked, so a pre-click patch is expected to hold._

**5. (Optional) Screenshot copy.** Requires extending `seedVault` to drop a `<id>.png`
(seed helper currently only writes `.mp4`). Then from a screenshot's detail, click _Copy_
and assert the clipboard in main: `await app.evaluate(({ clipboard }) =>
!clipboard.readImage().isEmpty())`. Deterministic (clipboard is process-local under the
throwaway profile) but needs a committed PNG fixture — mark as an add if screenshot flows
are in scope.

## Not covered / manual

- **Reveal-in-Finder actual effect** — that Finder actually opens and highlights the file
  is a native OS side effect with no renderer/vault signal. Assert the IPC/`shell` call
  only (test 4); verify the real Finder behavior manually on macOS.
- **`copyScreenshotById` real clipboard paste** — asserting the OS clipboard round-trips
  into another app is out of scope; assert `clipboard.readImage()` in main (test 5) and
  paste manually if needed.
- **Native "change vault folder" dialogs** — `chooseVaultDirectory` uses
  `dialog.showOpenDialog` / `showMessageBox` (`index.ts:65`); that is the Settings/Files
  flow, not Library, and would need dialog stubbing. Out of scope here.
- **`hasError` "can't read folder" panel** — reproducible by pointing the vault at an
  unreadable path, but environment-specific; treat as manual/targeted.
