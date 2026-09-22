---
title: "Video editor v2 — 08 editor layout and tracks"
description: "How the UI spec's new screen maps onto the editor page that exists: a label column and three new lanes in the timeline, a 288 px inspector column with the Detection panel and Zoom inspector, Zoom as an action button, contextual hints, counts, tokens and i18n. Verified diffs against main. Fixes audit W12."
sidebar:
  order: 8
---

# 08 — Editor layout and tracks

> **Status: 🔵 Proposed** (2026-09-21). PR 6 ("Timeline lanes + inspector panel") in the
> [audit](/plans/video-editor-v2/00-audit/), plus the polish list for PR 10. Fixes W12.
> Requires PR 5 ([07](/plans/video-editor-v2/07-scene-session-and-history/)).

## Problem

The UI spec draws a **new screen** — titlebar with traffic lights, a navigation rail, a
288 px properties panel, a four-track timeline (Filmstrip · Activity · Zooms · Privacy)
with a 62 px label column, literal hex colors, English copy. The editor that exists is a
page inside the app shell: header, toolbar, stage with a floating `OverlayOptions`
panel, transport, and a timeline with a ruler, **one annotation lane** and the clip track.
The overview says "generalize the single overlay lane into a track stack" without saying
where annotations go (the four-track design has no annotation track), whether the page
layout is replaced, or how spec copy and colors become i18n keys and tokens.

## Decisions

**Evolve the existing page; do not build a second screen.** The app shell already
provides the titlebar and rail. Mapping:

| UI spec zone                             | In the page                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Titlebar (name, metadata, pill)          | Existing header (title). The "ORIGINAL UNTOUCHED" pill is PR 10 polish.                                                    |
| Toolbar group 1 (select/rect/arrow/text) | Existing tool group, unchanged.                                                                                            |
| Toolbar group 2 (zoom/blur/cover)        | New group. **Zoom is an action button** (add at playhead / select the one there). Blur and Cover are drawing modes (PR 8). |
| Contextual hint                          | New span between the groups and the actions, from the active tool.                                                         |
| Preview                                  | Existing `PreviewStage` (doc 09 adds the camera).                                                                          |
| Properties panel 288 px                  | New `EditorInspector` column to the right of the stage, full stage height.                                                 |
| Transport counts                         | New `N zooms detected` span (and `N private regions` in PR 8), only when the recording has a cursor track.                 |
| Filmstrip track                          | Existing clip track (stays interactive: select, trim).                                                                     |
| Activity / Zooms / Privacy tracks        | New lanes **below** the clip track.                                                                                        |
| —                                        | The existing **annotation lane stays** above the clip track (labelled "ANOTACIONES").                                      |

Final lane order: ruler · annotations · clips · activity · zooms · privacy.

- **Label column**: `.timelineBody` becomes a two-column grid (labels + lanes). The width
  lives in one place, `--lane-label-w: 62px` on `.timelineBody`, and both the
  `grid-template-columns` and the playhead layer's `left` read it — the two must never
  drift apart. The playhead moves into an absolutely positioned layer covering the lanes
  column, so its `left: %` is relative to the lanes' width — the same reference every
  block uses.
- **Extra lanes** are passed to `TimelineStrip` as `extraLanes: { key, label, node }[]`
  so the strip stays generic; the page composes them. `node` is typed **`ReactElement`,
  not `ReactNode`**, and `LaneRow` wraps it in its own cell `<div>`: the grid
  auto-places one child per cell, so a lane that rendered a fragment with two roots
  would push every following label into the lanes column and every lane into the label
  column. The element type plus the wrapper make that unrepresentable.
- **Activity lane** only when a cursor track exists. **Zooms lane** always (manual zooms
  work without a track).
- **Inspector content**: zoom selected → `ZoomInspector`; otherwise → `DetectionPanel`
  (with an explanatory empty state when there is no track). PR 8 adds blur/cover
  inspectors ahead of the Detection fallback. Annotation options stay in the floating
  `OverlayOptions` (unchanged).
- **The Zoom inspector in PR 6 is Level · Smoothness · Remove.** The Follow / Lock
  **Mode** control moves to PR 7 ([09](/plans/video-editor-v2/09-preview-compositing/)).
  Reason: "Lock here" must pin the camera **where the user is currently looking**, which
  is `cameraAt(cameraPath, …)` — and `cameraPath` does not exist until PR 7. A PR 6
  button could only commit `{ mode: "fixed" }` with no anchor, and
  [07](/plans/video-editor-v2/07-scene-session-and-history/)'s `updateZoom` fills a
  missing anchor with `{ x: 0.5, y: 0.5 }`, so the camera would snap to the frame centre
  — the opposite of what the button's own copy promises. **Interim (PR 6 only):** a zoom
  stays in the mode detection gave it; every detected and hand-added zoom is `follow`,
  and a `fixed` zoom can only come from a session saved by a later build. The lane still
  renders its lock icon, and the inspector still shows its badge and range. PR 7 adds the
  control, the `anchorNow` prop and the `zoomMode` / `zoomFollow` / `zoomLock` /
  `zoomFollowNote` / `zoomLockNote` keys; `inspector.module.css` already ships the
  `.segmented` / `.segment` / `.segmentActive` classes it will use.
- **Zoom is an action, so it has no hint row.** `TOOL_HINT` is keyed by `VideoTool`, and
  Zoom is not a tool — the hint row keeps showing the active _drawing_ tool's hint while
  the Zoom button is clicked. `videoEditor.hintZoom` therefore only ever appears as that
  button's `title` tooltip. This is deliberate: a hint that flashed and reverted on a
  click would be noise. When PR 8 adds `blur` and `cover` to `VideoTool`, the exhaustive
  `Record<VideoTool, HintKey>` **stops compiling until `hintBlur` / `hintCover` are added**
  — that is the intended reminder, not a break.
- **Handles assume the timeline preserves source order.** The "first block carries the
  start handle, last block the end handle" rule reads `blocks[0]` / `blocks.at(-1)` in
  _timeline_ order and compares them to the segment's source edges. That is only
  equivalent to "the piece holding the real start/end" while clips appear on the timeline
  in source order — true today, because v2 has no reorder UI (only split, trim and
  delete). If reordering ever ships, pick the handle blocks by `sourceStart` /
  `sourceEnd` instead of by position.
- **Why a new `HistorySlider` and `inspector.module.css`** instead of reusing the
  screenshot editor's `beautify-panel` `Slider` and `<aside>`: that slider has no
  discrete-commit path (it fires `onBegin` on `keydown` and `onLive` on change, so a
  keyboard step becomes a fake drag), and its panel is sized for the beautify rail, not
  the spec's 288 px `--bg-card` column (§ 7). Copying it would mean forking it anyway.
  Note that `inspector.module.css` uses CSS Modules' `composes:` (`.badgeBlur`,
  `.noteInfo`) — a **new pattern in this repo** (no existing module uses it), supported
  out of the box by the Vite CSS Modules pipeline. It is only used within one file, which
  is the form with no build caveats.
- **Colors**: tokens wherever one exists (`--accent-primary` = `#F6055C`, `--bg-input`,
  `--text-muted`, `--accent-red`); the spec's dwell blue-grey `#3d5570` and blur blue
  `#58a6ff` have no token and stay literal, commented with the spec section.
- **Copy**: every string is an i18n key under `videoEditor`, neutral Spanish + English.
  `use-intl` types keys from `messages/es.json`, so a key missing from `es.json` is a
  **typecheck error** — add keys first.
- **Keydown dependencies**: PR 5's revised page diff
  ([07](/plans/video-editor-v2/07-scene-session-and-history/), Task 5 + 6) already lists
  `clearSelection` in the keydown effect's dependency array alongside the `Escape`
  branch it introduces, so PR 6 only adds `selectedZoomId` and `handleRemoveZoom`.

### Layout side-effects of the new rows

Three things change size or centring; all three are handled in the diffs below.

1. **The transport bar stops being symmetric.** `.transport` is `justify-content: center`
   over a flat row, so inserting the counts span between the time display and the
   fullscreen button drags the play button left. It becomes a **three-column grid**
   (`1fr auto 1fr`): mute on the left, play in the centre column (optically centred
   whatever the sides weigh), and time · counts · fullscreen right-aligned on the right.
   PR 8's "N private regions" span joins the right cluster and changes nothing else.
2. **The footer grows.** Rows 20 (ruler) + 20 (annotations) + 44 (clips) + 34 (activity)
   - 40 (zooms) = 158 px, four `--space-xs` row gaps = 16 px, `.strip` padding
     `--space-sm` + `--space-md` = 20 px, `.timeline` borders = 2 px → **≈ 196 px**, up
     from the fixed 160 px. PR 8's 38 px Privacy lane plus one more gap takes it to
     **≈ 238 px**. `.timeline` therefore becomes `min-height: 160px` (the `auto` grid row
     sizes to content). Re-checked against `.videoRegion { max-height: 50vh }`: the page is
     a `auto auto 1fr auto` grid, so header (≈ 46) + toolbar (≈ 56) + transport (≈ 60) +
     footer (196) + a full 50 vh video needs a window **≈ 810 px tall** (≈ 850 px after
     PR 8). Below that the `1fr` stage row shrinks while `.video`'s cap stays `46vh`, and
     `.videoRegion { overflow: hidden }` clips the picture — a pre-existing behaviour the
     taller footer reaches sooner. Not fixed here (the vh caps are the real cause); listed
     as a PR 10 polish row.
3. **The annotations lane looked unfinished next to the new ones.** Activity, Zooms and
   (PR 8) Privacy are `--bg-input` slabs with `--radius-md`; the existing overlay lane is
   a bare 20 px strip. It gets the same background and radius so the stack reads as one
   timeline. Its pills are unchanged.

## Files

| Action | Path (under `apps/kaipu-record/src/renderer/src/`)                                                                                                                              |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create | `features/video-editor/components/history-slider.tsx` + `.module.css` + `.test.tsx`                                                                                             |
| Create | `features/video-editor/components/activity-lane.tsx` + `.module.css` + `.test.tsx`                                                                                              |
| Create | `features/video-editor/components/zoom-lane.tsx` + `.module.css` + `.test.tsx`                                                                                                  |
| Create | `features/video-editor/components/inspector/format.ts` + `.test.ts`                                                                                                             |
| Create | `features/video-editor/components/inspector/{editor-inspector,detection-panel,zoom-inspector}.tsx`, `inspector.module.css`, `editor-inspector.module.css`, `inspector.test.tsx` |
| Create | `features/video-editor/zoom/use-zoom-editing.ts` + `.test.ts`                                                                                                                   |
| Modify | `features/video-editor/components/timeline-strip.tsx` + `.module.css`                                                                                                           |
| Modify | `features/video-editor/components/overlay-lane.module.css`                                                                                                                      |
| Modify | `features/video-editor/components/editor-toolbar.tsx` + `.module.css` + `.test.tsx`                                                                                             |
| Modify | `pages/video-editor/video-editor-page.tsx` + `.module.css`                                                                                                                      |
| Modify | `packages/i18n/messages/es.json`, `packages/i18n/messages/en.json` (monorepo root)                                                                                              |

## Tasks

### Task 1 — i18n keys (do first: the typecheck depends on them)

Add inside the `"videoEditor"` object of **both** files, in this order, after the last
existing key:

| Key                     | es                                                                                                                            | en                                                                                                               |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `laneAnnotations`       | ANOTACIONES                                                                                                                   | ANNOTATIONS                                                                                                      |
| `laneClips`             | CLIPS                                                                                                                         | CLIPS                                                                                                            |
| `laneActivity`          | ACTIVIDAD                                                                                                                     | ACTIVITY                                                                                                         |
| `laneZooms`             | ZOOMS                                                                                                                         | ZOOMS                                                                                                            |
| `toolZoom`              | Zoom                                                                                                                          | Zoom                                                                                                             |
| `hintSelect`            | Haz clic en un segmento de la línea de tiempo para editarlo.                                                                  | Click a segment on the timeline to edit it.                                                                      |
| `hintBox`               | Arrastra sobre la vista previa para dibujar un rectángulo.                                                                    | Drag on the preview to draw a rectangle.                                                                         |
| `hintArrow`             | Arrastra sobre la vista previa para dibujar una flecha.                                                                       | Drag on the preview to draw an arrow.                                                                            |
| `hintText`              | Haz clic en la vista previa para colocar texto.                                                                               | Click on the preview to place text.                                                                              |
| `hintZoom`              | Agrega un zoom en el cursor de reproducción, o arrastra el recuadro de cámara para reencuadrarlo.                             | Add a zoom at the playhead, or drag the camera box to re-aim it.                                                 |
| `zoomNotOnSlide`        | Las imágenes no tienen zoom. Mueve el cursor de reproducción a un clip.                                                       | Images can't be zoomed. Move the playhead onto a clip.                                                           |
| `zoomNoRoom`            | No hay espacio para otro zoom aquí.                                                                                           | There's no room for another zoom here.                                                                           |
| `zoomCount`             | {count, plural, one {# zoom detectado} other {# zooms detectados}}                                                            | {count, plural, one {# zoom detected} other {# zooms detected}}                                                  |
| `detectionTitle`        | Detección                                                                                                                     | Detection                                                                                                        |
| `detectionBody`         | Vuelve a analizar la grabación y reemplaza los zooms automáticos. Tus ediciones manuales se conservan.                        | Re-analyses the recording and replaces the automatic zooms. Your manual edits are kept.                          |
| `sensitivityLabel`      | Sensibilidad                                                                                                                  | Sensitivity                                                                                                      |
| `sensitivityNote`       | Más baja conserva solo los clics más claros. Más alta también detecta pausas largas.                                          | Lower keeps only the strongest clicks. Higher also picks up long pauses.                                         |
| `detectionSummary`      | {count, plural, one {# zoom} other {# zooms}} · {percent}% del clip                                                           | {count, plural, one {# zoom} other {# zooms}} · {percent}% of clip                                               |
| `reanalyse`             | Volver a analizar                                                                                                             | Re-analyse                                                                                                       |
| `detectionNoTrack`      | Esta grabación no tiene datos del cursor, así que no hay zooms automáticos. Puedes agregarlos a mano con la herramienta Zoom. | This recording has no cursor data, so there are no automatic zooms. You can add them by hand with the Zoom tool. |
| `clicksUnavailableHint` | Activa el permiso de Accesibilidad para que los clics también generen zoom.                                                   | Turn on Accessibility access so clicks also create zooms.                                                        |
| `selectionLabel`        | SELECCIÓN                                                                                                                     | SELECTION                                                                                                        |
| `selectionHint`         | Elige un zoom o una región privada en la línea de tiempo para editarlo aquí.                                                  | Pick a zoom or a private region on the timeline to edit it here.                                                 |
| `exportSafetyNote`      | Al exportar, el desenfoque y la cobertura quedan grabados en los píxeles. La grabación original en tu disco conserva todo.    | Export burns blur and cover into the pixels. The original recording on disk keeps everything.                    |
| `zoomTitle`             | Zoom {n}                                                                                                                      | Zoom {n}                                                                                                         |
| `zoomBadgeClick`        | CLIC DETECTADO                                                                                                                | CLICK DETECTED                                                                                                   |
| `zoomBadgeDwell`        | PAUSA LARGA                                                                                                                   | LONG PAUSE                                                                                                       |
| `zoomBadgeManual`       | MANUAL                                                                                                                        | MANUAL                                                                                                           |
| `zoomLevel`             | Nivel                                                                                                                         | Level                                                                                                            |
| `zoomSmoothness`        | Suavidad                                                                                                                      | Smoothness                                                                                                       |
| `zoomSmoothnessNote`    | Más alta: la cámara entra más despacio y se desplaza menos.                                                                   | Higher means the camera eases in longer and drifts less.                                                         |
| `zoomRemove`            | Quitar este zoom                                                                                                              | Remove this zoom                                                                                                 |

The Mode control's five keys (`zoomMode`, `zoomFollow`, `zoomLock`, `zoomFollowNote`,
`zoomLockNote`) are **not** added here — they ship with the control itself in PR 7, see
[09 Task 4](/plans/video-editor-v2/09-preview-compositing/#task-4--zoom-inspector-follow--lock).

Paste into `packages/i18n/messages/es.json` → `"videoEditor"` (without the outer braces):

```json
{
  "laneAnnotations": "ANOTACIONES",
  "laneClips": "CLIPS",
  "laneActivity": "ACTIVIDAD",
  "laneZooms": "ZOOMS",
  "toolZoom": "Zoom",
  "hintSelect": "Haz clic en un segmento de la línea de tiempo para editarlo.",
  "hintBox": "Arrastra sobre la vista previa para dibujar un rectángulo.",
  "hintArrow": "Arrastra sobre la vista previa para dibujar una flecha.",
  "hintText": "Haz clic en la vista previa para colocar texto.",
  "hintZoom": "Agrega un zoom en el cursor de reproducción, o arrastra el recuadro de cámara para reencuadrarlo.",
  "zoomNotOnSlide": "Las imágenes no tienen zoom. Mueve el cursor de reproducción a un clip.",
  "zoomNoRoom": "No hay espacio para otro zoom aquí.",
  "zoomCount": "{count, plural, one {# zoom detectado} other {# zooms detectados}}",
  "detectionTitle": "Detección",
  "detectionBody": "Vuelve a analizar la grabación y reemplaza los zooms automáticos. Tus ediciones manuales se conservan.",
  "sensitivityLabel": "Sensibilidad",
  "sensitivityNote": "Más baja conserva solo los clics más claros. Más alta también detecta pausas largas.",
  "detectionSummary": "{count, plural, one {# zoom} other {# zooms}} · {percent}% del clip",
  "reanalyse": "Volver a analizar",
  "detectionNoTrack": "Esta grabación no tiene datos del cursor, así que no hay zooms automáticos. Puedes agregarlos a mano con la herramienta Zoom.",
  "clicksUnavailableHint": "Activa el permiso de Accesibilidad para que los clics también generen zoom.",
  "selectionLabel": "SELECCIÓN",
  "selectionHint": "Elige un zoom o una región privada en la línea de tiempo para editarlo aquí.",
  "exportSafetyNote": "Al exportar, el desenfoque y la cobertura quedan grabados en los píxeles. La grabación original en tu disco conserva todo.",
  "zoomTitle": "Zoom {n}",
  "zoomBadgeClick": "CLIC DETECTADO",
  "zoomBadgeDwell": "PAUSA LARGA",
  "zoomBadgeManual": "MANUAL",
  "zoomLevel": "Nivel",
  "zoomSmoothness": "Suavidad",
  "zoomSmoothnessNote": "Más alta: la cámara entra más despacio y se desplaza menos.",
  "zoomRemove": "Quitar este zoom"
}
```

and into `packages/i18n/messages/en.json` → `"videoEditor"`:

```json
{
  "laneAnnotations": "ANNOTATIONS",
  "laneClips": "CLIPS",
  "laneActivity": "ACTIVITY",
  "laneZooms": "ZOOMS",
  "toolZoom": "Zoom",
  "hintSelect": "Click a segment on the timeline to edit it.",
  "hintBox": "Drag on the preview to draw a rectangle.",
  "hintArrow": "Drag on the preview to draw an arrow.",
  "hintText": "Click on the preview to place text.",
  "hintZoom": "Add a zoom at the playhead, or drag the camera box to re-aim it.",
  "zoomNotOnSlide": "Images can't be zoomed. Move the playhead onto a clip.",
  "zoomNoRoom": "There's no room for another zoom here.",
  "zoomCount": "{count, plural, one {# zoom detected} other {# zooms detected}}",
  "detectionTitle": "Detection",
  "detectionBody": "Re-analyses the recording and replaces the automatic zooms. Your manual edits are kept.",
  "sensitivityLabel": "Sensitivity",
  "sensitivityNote": "Lower keeps only the strongest clicks. Higher also picks up long pauses.",
  "detectionSummary": "{count, plural, one {# zoom} other {# zooms}} · {percent}% of clip",
  "reanalyse": "Re-analyse",
  "detectionNoTrack": "This recording has no cursor data, so there are no automatic zooms. You can add them by hand with the Zoom tool.",
  "clicksUnavailableHint": "Turn on Accessibility access so clicks also create zooms.",
  "selectionLabel": "SELECTION",
  "selectionHint": "Pick a zoom or a private region on the timeline to edit it here.",
  "exportSafetyNote": "Export burns blur and cover into the pixels. The original recording on disk keeps everything.",
  "zoomTitle": "Zoom {n}",
  "zoomBadgeClick": "CLICK DETECTED",
  "zoomBadgeDwell": "LONG PAUSE",
  "zoomBadgeManual": "MANUAL",
  "zoomLevel": "Level",
  "zoomSmoothness": "Smoothness",
  "zoomSmoothnessNote": "Higher means the camera eases in longer and drifts less.",
  "zoomRemove": "Remove this zoom"
}
```

### Task 2 — history slider

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/history-slider.tsx`**

```tsx
/**
 * A range input wired to the scene-history contract (plans/video-editor-v2/07): a
 * pointer gesture is ONE undo step (onBegin → onLive… → onEnd), a keyboard step is a
 * discrete onCommit. Used by every continuous inspector control.
 *
 * Accessibility: the row is NOT a <label> wrapping the control. A wrapping label would
 * fold the live value ("2.4×") into the slider's accessible name, so every arrow-key
 * step would re-announce "Level 2.4× slider" instead of just the new value — which the
 * range role already reports. Instead the control is named with `aria-label`, the muted
 * helper text is a sibling referenced by `aria-describedby`, and the on-screen value is
 * `aria-hidden` (it duplicates the value the role announces).
 */
import { useId, useRef } from "react";
import styles from "./history-slider.module.css";

export interface HistorySliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Text shown next to the label, e.g. "2.1×". Defaults to the raw value. */
  format?: (value: number) => string;
  /** Muted helper text under the slider. */
  note?: string;
  disabled?: boolean;
  onBegin(): void;
  onLive(value: number): void;
  onEnd(): void;
  onCommit(value: number): void;
}

export function HistorySlider({
  label,
  value,
  min,
  max,
  step,
  format,
  note,
  disabled = false,
  onBegin,
  onLive,
  onEnd,
  onCommit,
}: HistorySliderProps): React.JSX.Element {
  const dragging = useRef(false);
  const noteId = useId();
  const finish = (): void => {
    if (!dragging.current) return;
    dragging.current = false;
    onEnd();
  };
  return (
    <div className={styles.row}>
      <span className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.value} aria-hidden>
          {format ? format(value) : String(value)}
        </span>
      </span>
      <input
        className={styles.input}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-label={label}
        aria-describedby={note ? noteId : undefined}
        onPointerDown={(event) => {
          // Optional call: jsdom has no setPointerCapture (same guard as the timeline).
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragging.current = true;
          onBegin();
        }}
        onPointerUp={finish}
        onPointerCancel={finish}
        onChange={(event) => {
          const next = Number(event.currentTarget.value);
          if (dragging.current) onLive(next);
          else onCommit(next);
        }}
      />
      {note && (
        <p id={noteId} className={styles.note}>
          {note}
        </p>
      )}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/history-slider.module.css`**

```css
/* Inspector slider row — label + live value on one line, the range below. */
.row {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
}

.label {
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.value {
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
}

.input {
  width: 100%;
  accent-color: var(--accent-primary);
}

/* Sibling of the input (aria-describedby), not a child of a wrapping label. */
.note {
  margin: 0;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/history-slider.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { HistorySlider } from "./history-slider";

function setup() {
  const handlers = { onBegin: vi.fn(), onLive: vi.fn(), onEnd: vi.fn(), onCommit: vi.fn() };
  render(
    <HistorySlider
      label="Level"
      value={2}
      min={1}
      max={4}
      step={0.1}
      format={(v) => `${v}×`}
      {...handlers}
    />,
  );
  return { handlers, input: screen.getByRole("slider") };
}

describe("HistorySlider", () => {
  it("a pointer gesture is begin → live → end", () => {
    const { handlers, input } = setup();
    fireEvent.pointerDown(input, { pointerId: 1 });
    fireEvent.change(input, { target: { value: "2.5" } });
    fireEvent.pointerUp(input, { pointerId: 1 });
    expect(handlers.onBegin).toHaveBeenCalledTimes(1);
    expect(handlers.onLive).toHaveBeenCalledWith(2.5);
    expect(handlers.onEnd).toHaveBeenCalledTimes(1);
    expect(handlers.onCommit).not.toHaveBeenCalled();
  });

  it("a change without a pointer (keyboard) is a commit", () => {
    const { handlers, input } = setup();
    fireEvent.change(input, { target: { value: "2.1" } });
    expect(handlers.onCommit).toHaveBeenCalledWith(2.1);
    expect(handlers.onBegin).not.toHaveBeenCalled();
  });

  it("shows the formatted value", () => {
    setup();
    expect(screen.getByText("2×")).toBeInTheDocument();
  });

  it("names the control with the label alone and describes it with the note", () => {
    render(
      <HistorySlider
        label="Smoothness"
        value={70}
        min={0}
        max={100}
        step={1}
        note="Higher means the camera eases in longer."
        onBegin={vi.fn()}
        onLive={vi.fn()}
        onEnd={vi.fn()}
        onCommit={vi.fn()}
      />,
    );
    // The accessible name must not absorb the live value — otherwise every arrow-key
    // step re-announces the control instead of just the new value.
    const input = screen.getByRole("slider", { name: "Smoothness" });
    const note = screen.getByText("Higher means the camera eases in longer.");
    expect(input.getAttribute("aria-describedby")).toBe(note.id);
    expect(note.tagName).toBe("P");
  });
});
```

### Task 3 — zoom editing hook

Two things this task depends on from PR 5
([07](/plans/video-editor-v2/07-scene-session-and-history/)), both already in that
document — do not re-implement them here:

- `dragZoomEdge(scene, id, edge, to, sourceDuration)` in `zoom-edits.ts`, which wraps
  [06](/plans/video-editor-v2/06-time-base-cuts-and-mapping/)'s `dragRangeEdge` with the
  zoom siblings, `ZOOM_LIMITS.minSeconds` and the `origin: "manual"` flip. `ZoomPatch`
  deliberately has **no** `start`/`end`, so an edge drag cannot go through `updateZoom`.
- `applySensitivity` returns the **same scene reference** when the recomputed segments
  and the sensitivity value are unchanged. That is what makes `reanalyse()` free:
  `controller.commit(next)` no-ops on a reference-equal scene, so re-analysing an
  untouched recording adds no undo entry and does not mark the editor dirty (audit W11).

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/use-zoom-editing.ts`**

```ts
/**
 * Zoom editing handlers for the editor page, following the scene-history contract of
 * plans/video-editor-v2/07: discrete actions commit; continuous gestures (sliders, edge
 * drags, camera-box drag) run begin → live… → end.
 *
 * Every handler reads `controller.scene` — the scene as of the last render. That is NOT
 * useVideoScene's private `sceneRef` (the ref is what makes endInteract's comparison
 * exact and is not exposed), but it is correct here because each pointer/change event
 * flushes its own render before the next one arrives, so a live handler always sees the
 * result of the previous live update. What must never happen is closing over a `scene`
 * captured in the page's render body and kept across renders — hence `controller` in
 * every dependency array.
 */
import { useCallback, useMemo } from "react";
import type { CursorTrack } from "@shared/cursor-track";
import { freeWindowAt, isSourceRangeVisible, sourceTimeAtTimeline } from "../source-time";
import type { LayoutEntry } from "../timeline";
import type { VideoSceneController } from "../use-video-scene";
import {
  addManualZoom,
  applySensitivity,
  dragZoomEdge,
  lockZoomAt,
  removeZoom,
  updateZoom,
  type ZoomPatch,
} from "./zoom-edits";
import { ZOOM_LIMITS, type ZoomSegment } from "./zoom-model";

export type AddZoomResult =
  | { ok: true; id: string }
  | { ok: false; reason: "on-slide" | "no-room" | "busy" };

export interface ZoomEditing {
  /** Segments with at least one visible piece — what the lane, counts and inspector use. */
  visibleZooms: ZoomSegment[];
  /** Fraction (0–1) of the TIMELINE covered by visible zoom pieces, for the Detection summary. */
  coverage: number;
  addAtPlayhead(timelineTime: number): AddZoomResult;
  remove(id: string): void;
  commitPatch(id: string, patch: ZoomPatch): void;
  begin(): void;
  livePatch(id: string, patch: ZoomPatch): void;
  end(): void;
  /** Zoom lane edge drag — same phase contract as the overlay lane. */
  edgeDrag(
    id: string,
    edge: "start" | "end",
    sourceTime: number | null,
    phase: "start" | "move" | "end",
  ): void;
  /** Camera-box drag in the preview: locks the segment at `center` (doc 05). */
  liveLock(id: string, center: { x: number; y: number }): void;
  sensitivityLive(value: number): void;
  sensitivityCommit(value: number): void;
  reanalyse(): void;
  /** False when the recording has no cursor track (Detection panel shows its empty state). */
  canDetect: boolean;
}

export function useZoomEditing({
  controller,
  layout,
  timelineDuration,
  sourceDuration,
  cursorTrack,
}: {
  controller: VideoSceneController;
  layout: LayoutEntry[];
  timelineDuration: number;
  sourceDuration: number;
  cursorTrack: CursorTrack | null;
}): ZoomEditing {
  const { scene } = controller;

  const visibleZooms = useMemo(
    () => scene.zoomSegments.filter((z) => isSourceRangeVisible(layout, z.start, z.end)),
    [scene.zoomSegments, layout],
  );

  const coverage = useMemo(() => {
    if (timelineDuration <= 0) return 0;
    let covered = 0;
    for (const entry of layout) {
      if (entry.kind !== "clip") continue;
      for (const z of scene.zoomSegments) {
        covered += Math.max(
          0,
          Math.min(z.end, entry.sourceEnd) - Math.max(z.start, entry.sourceStart),
        );
      }
    }
    return Math.min(1, covered / timelineDuration);
  }, [scene.zoomSegments, layout, timelineDuration]);

  const addAtPlayhead = useCallback(
    (timelineTime: number): AddZoomResult => {
      if (controller.interacting) return { ok: false, reason: "busy" };
      const at = sourceTimeAtTimeline(layout, timelineTime);
      if (at === null) return { ok: false, reason: "on-slide" };
      const window = freeWindowAt(
        controller.scene.zoomSegments,
        at,
        ZOOM_LIMITS.manualSeconds,
        sourceDuration,
        ZOOM_LIMITS.minSeconds,
      );
      if (!window) return { ok: false, reason: "no-room" };
      const { scene: next, id } = addManualZoom(controller.scene, window);
      controller.commit(next);
      return { ok: true, id };
    },
    [controller, layout, sourceDuration],
  );

  const remove = useCallback(
    (id: string) => {
      if (controller.interacting) return;
      controller.commit(removeZoom(controller.scene, id));
    },
    [controller],
  );

  const commitPatch = useCallback(
    (id: string, patch: ZoomPatch) => {
      if (controller.interacting) return;
      controller.commit(updateZoom(controller.scene, id, patch));
    },
    [controller],
  );

  const livePatch = useCallback(
    (id: string, patch: ZoomPatch) =>
      controller.updateLive(updateZoom(controller.scene, id, patch)),
    [controller],
  );

  const edgeDrag = useCallback(
    (
      id: string,
      edge: "start" | "end",
      sourceTime: number | null,
      phase: "start" | "move" | "end",
    ) => {
      if (phase === "start") controller.beginInteract();
      if (phase === "move" && sourceTime !== null) {
        controller.updateLive(dragZoomEdge(controller.scene, id, edge, sourceTime, sourceDuration));
      }
      if (phase === "end") controller.endInteract();
    },
    [controller, sourceDuration],
  );

  const liveLock = useCallback(
    (id: string, center: { x: number; y: number }) =>
      controller.updateLive(lockZoomAt(controller.scene, id, center)),
    [controller],
  );

  const sensitivityLive = useCallback(
    (value: number) => {
      if (!cursorTrack) return;
      controller.updateLive(applySensitivity(controller.scene, cursorTrack, sourceDuration, value));
    },
    [controller, cursorTrack, sourceDuration],
  );

  const sensitivityCommit = useCallback(
    (value: number) => {
      if (!cursorTrack || controller.interacting) return;
      controller.commit(applySensitivity(controller.scene, cursorTrack, sourceDuration, value));
    },
    [controller, cursorTrack, sourceDuration],
  );

  // Re-run detection at the current sensitivity. Free when nothing changes:
  // applySensitivity returns the same scene reference and commit() no-ops on it, so the
  // button never manufactures an undo entry or a dirty editor (doc 07).
  const reanalyse = useCallback(() => {
    sensitivityCommit(controller.scene.zoomSensitivity);
  }, [controller, sensitivityCommit]);

  return {
    visibleZooms,
    coverage,
    addAtPlayhead,
    remove,
    commitPatch,
    begin: controller.beginInteract,
    livePatch,
    end: controller.endInteract,
    edgeDrag,
    liveLock,
    sensitivityLive,
    sensitivityCommit,
    reanalyse,
    canDetect: cursorTrack !== null,
  };
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/zoom/use-zoom-editing.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { CursorTrack } from "@shared/cursor-track";
import { withInitialZooms } from "../initial-zooms";
import { initialScene } from "../scene";
import { toLayout } from "../timeline";
import { useVideoScene } from "../use-video-scene";
import { useZoomEditing } from "./use-zoom-editing";

const TRACK: CursorTrack = {
  version: 1,
  display: { id: "1", width: 1600, height: 1000, scaleFactor: 2 },
  anchor: "exact",
  clicksAvailable: true,
  t: [0, 20_000],
  x: [0.5, 0.5],
  y: [0.5, 0.5],
  clicks: [{ t: 10_000, x: 0.5, y: 0.5, button: 0 }],
};

function setup(track: CursorTrack | null = TRACK, initial = initialScene(20)) {
  return renderHook(() => {
    const controller = useVideoScene(initial);
    const layout = toLayout(controller.scene.items);
    const zooms = useZoomEditing({
      controller,
      layout,
      timelineDuration: 20,
      sourceDuration: 20,
      cursorTrack: track,
    });
    return { controller, zooms };
  });
}

describe("useZoomEditing", () => {
  it("adds a manual zoom at the playhead as one undo step", () => {
    const { result } = setup();
    let added: ReturnType<typeof result.current.zooms.addAtPlayhead> | undefined;
    act(() => {
      added = result.current.zooms.addAtPlayhead(4);
    });
    expect(added).toMatchObject({ ok: true });
    expect(result.current.controller.scene.zoomSegments[0]).toMatchObject({ start: 4, end: 7 });
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.zoomSegments).toEqual([]);
  });

  it("a sensitivity drag is one undo step", () => {
    const { result } = setup();
    act(() => result.current.zooms.begin());
    act(() => result.current.zooms.sensitivityLive(60));
    act(() => result.current.zooms.sensitivityLive(70));
    act(() => result.current.zooms.end());
    expect(result.current.controller.scene.zoomSensitivity).toBe(70);
    expect(result.current.controller.scene.zoomSegments).toHaveLength(1);
    act(() => result.current.controller.undo());
    expect(result.current.controller.scene.zoomSensitivity).toBe(55);
    expect(result.current.controller.canUndo).toBe(false);
  });

  it("edge drag ignores moves over slides (null) and clamps", () => {
    const { result } = setup();
    act(() => {
      result.current.zooms.addAtPlayhead(4);
    });
    const id = result.current.controller.scene.zoomSegments[0].id;
    act(() => result.current.zooms.edgeDrag(id, "end", 7, "start"));
    act(() => result.current.zooms.edgeDrag(id, "end", null, "move"));
    act(() => result.current.zooms.edgeDrag(id, "end", 4.2, "move"));
    act(() => result.current.zooms.edgeDrag(id, "end", null, "end"));
    expect(result.current.controller.scene.zoomSegments[0]).toMatchObject({ start: 4, end: 5 });
  });

  it("re-analysing an unchanged scene adds no history entry", () => {
    // Seeded exactly like the loader does (PR 5), so detection at the stored sensitivity
    // reproduces what is already there and applySensitivity returns the same reference.
    const { result } = setup(TRACK, withInitialZooms(initialScene(20), false, TRACK, 20));
    expect(result.current.controller.scene.zoomSegments).toHaveLength(1);
    const before = result.current.controller.scene;
    act(() => result.current.zooms.reanalyse());
    expect(result.current.controller.scene).toBe(before);
    expect(result.current.controller.canUndo).toBe(false);
    expect(result.current.controller.dirty).toBe(false);
  });

  it("cannot detect without a cursor track", () => {
    const { result } = setup(null);
    expect(result.current.zooms.canDetect).toBe(false);
    act(() => result.current.zooms.sensitivityCommit(90));
    expect(result.current.controller.scene.zoomSensitivity).toBe(55);
  });
});
```

### Task 4 — lanes

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/activity-lane.tsx`**

```tsx
/**
 * Activity lane — the EVIDENCE for the zooms (UI spec § 6.2): a tall accent tick per
 * click, a short muted bar per pointer pause (height = how long it lasted). Read-only.
 * Marks are in SOURCE seconds and mapped through source-time.ts, so a cut hides the
 * evidence of deleted footage exactly like it hides the footage.
 */
import type { ActivityMark } from "../zoom/detect-zoom-segments";
import { sourceRangeToTimelineBlocks } from "../source-time";
import { type LayoutEntry, layoutDuration, sourceToTimeline } from "../timeline";
import { timeToFraction } from "./timeline-geometry";
import styles from "./activity-lane.module.css";

const DWELL_MIN_PX = 6;
const DWELL_MAX_PX = 18;

export function ActivityLane({
  marks,
  layout,
}: {
  marks: ActivityMark[];
  layout: LayoutEntry[];
}): React.JSX.Element {
  const duration = layoutDuration(layout);
  return (
    <div className={styles.lane} data-testid="activity-lane" aria-hidden>
      {marks.flatMap((mark, i) => {
        if (mark.kind === "click") {
          const t = sourceToTimeline(layout, mark.t);
          if (t === null) return [];
          return [
            <span
              key={`c${i}`}
              className={styles.click}
              style={{ left: `${timeToFraction(t, duration) * 100}%` }}
            />,
          ];
        }
        const height = DWELL_MIN_PX + (DWELL_MAX_PX - DWELL_MIN_PX) * mark.strength;
        return sourceRangeToTimelineBlocks(layout, mark.start, mark.end).map((block, j) => (
          <span
            key={`d${i}-${j}`}
            className={styles.dwell}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
              height: `${height}px`,
            }}
          />
        ));
      })}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/activity-lane.module.css`**

```css
.lane {
  position: relative;
  height: 34px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
  overflow: hidden;
  pointer-events: none;
}

/* Click: UI spec #F6055C, 24 px — the main trigger. */
.click {
  position: absolute;
  bottom: 5px;
  width: 2px;
  height: 24px;
  margin-left: -1px;
  border-radius: 1px;
  background: var(--accent-primary);
}

/* Dwell: UI spec #3d5570, 6–18 px (height set inline from the pause length). */
.dwell {
  position: absolute;
  bottom: 5px;
  min-width: 2px;
  border-radius: 2px;
  background: #3d5570;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/activity-lane.test.tsx`**

```tsx
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import { ActivityLane } from "./activity-lane";

// Source 0–20 s with 5–10 s deleted → timeline 15 s.
const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
];
const layout = toLayout(items);

describe("ActivityLane", () => {
  it("places clicks on the timeline and hides clicks in deleted footage", () => {
    const { container } = render(
      <ActivityLane
        layout={layout}
        marks={[
          { kind: "click", t: 1.5 },
          { kind: "click", t: 7 },
          { kind: "click", t: 12 },
        ]}
      />,
    );
    const clicks = [...container.querySelectorAll<HTMLElement>("span")].filter(
      (s) => s.style.height === "",
    );
    expect(clicks.map((c) => c.style.left)).toEqual(["10%", `${(7 / 15) * 100}%`]);
  });

  it("splits a dwell across a cut and sizes it by strength", () => {
    const { container } = render(
      <ActivityLane layout={layout} marks={[{ kind: "dwell", start: 4, end: 11, strength: 1 }]} />,
    );
    const bars = [...container.querySelectorAll<HTMLElement>("span")];
    expect(bars).toHaveLength(2);
    expect(bars.every((b) => b.style.height === "18px")).toBe(true);
  });
});
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/zoom-lane.tsx`**

```tsx
/**
 * Zooms lane — one block per VISIBLE piece of each zoom segment (source-anchored, see
 * plans/video-editor-v2/06). Click selects the whole segment; the selected segment shows
 * an edge handle only where its real start/end is visible (not at inner cut edges).
 * Edge drags report SOURCE time (null while over a slide) with the same
 * start/move/end phase contract as the overlay lane.
 *
 * The handle rule picks blocks[0] / blocks.at(-1) — i.e. by TIMELINE position — and then
 * checks them against the segment's source edges. Those two orders coincide only while
 * clips stay on the timeline in source order, which they do in v2 (split, trim and
 * delete preserve it; there is no reorder UI). If reordering ever ships, select the
 * handle blocks by sourceStart/sourceEnd instead of by position.
 */
import { useRef } from "react";
import { Lock } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks, sourceTimeAtTimeline } from "../source-time";
import { type LayoutEntry, layoutDuration } from "../timeline";
import type { ZoomSegment } from "../zoom/zoom-model";
import { fractionToTime, timeToFraction } from "./timeline-geometry";
import styles from "./zoom-lane.module.css";

export type EdgePhase = "start" | "move" | "end";

export interface ZoomLaneProps {
  segments: ZoomSegment[];
  layout: LayoutEntry[];
  selectedId: string | null;
  onSelect(id: string): void;
  /** `sourceTime` is null when the pointer is over a slide — ignore that move. */
  onEdgeDrag(id: string, edge: "start" | "end", sourceTime: number | null, phase: EdgePhase): void;
}

export function ZoomLane({
  segments,
  layout,
  selectedId,
  onSelect,
  onEdgeDrag,
}: ZoomLaneProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const laneRef = useRef<HTMLDivElement | null>(null);
  const dragEdge = useRef<{ id: string; edge: "start" | "end" } | null>(null);
  const duration = layoutDuration(layout);

  const sourceFromPointer = (clientX: number): number | null => {
    const rect = laneRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return null;
    return sourceTimeAtTimeline(
      layout,
      fractionToTime((clientX - rect.left) / rect.width, duration),
    );
  };

  const handle = (segment: ZoomSegment, edge: "start" | "end", timelineAt: number) => {
    // A pointer gesture can end without a pointerup (system gesture, capture stolen,
    // the handle unmounting mid-drag). Without this the controller stays in
    // `interacting` forever and every later commit/undo/redo silently no-ops. Same
    // abort contract as VideoAnnotationLayer's onPointerAbort.
    const abort = (): void => {
      if (!dragEdge.current) return;
      dragEdge.current = null;
      onEdgeDrag(segment.id, edge, null, "end");
    };
    return (
      <div
        key={`${segment.id}-${edge}`}
        className={styles.handle}
        style={{ left: `calc(${timeToFraction(timelineAt, duration) * 100}% - 3px)` }}
        data-zoom-handle={edge}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture?.(event.pointerId);
          dragEdge.current = { id: segment.id, edge };
          onEdgeDrag(segment.id, edge, edge === "start" ? segment.start : segment.end, "start");
        }}
        onPointerMove={(event) => {
          event.stopPropagation();
          const drag = dragEdge.current;
          if (!drag || drag.id !== segment.id || drag.edge !== edge) return;
          onEdgeDrag(segment.id, edge, sourceFromPointer(event.clientX), "move");
        }}
        onPointerUp={(event) => {
          event.stopPropagation();
          if (!dragEdge.current) return;
          // Release first: the lostpointercapture this queues finds dragEdge already
          // null after abort(), so the "end" phase is reported exactly once.
          event.currentTarget.releasePointerCapture?.(event.pointerId);
          abort();
        }}
        onPointerCancel={abort}
        onLostPointerCapture={abort}
      />
    );
  };

  return (
    <div ref={laneRef} className={styles.lane} data-testid="zoom-lane">
      {segments.flatMap((segment, index) => {
        const blocks = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
        const selected = segment.id === selectedId;
        const nodes = blocks.map((block, i) => (
          <button
            key={`${segment.id}-${i}`}
            type="button"
            className={selected ? `${styles.block} ${styles.selected}` : styles.block}
            style={{
              left: `${timeToFraction(block.timelineStart, duration) * 100}%`,
              width: `${timeToFraction(block.timelineEnd - block.timelineStart, duration) * 100}%`,
            }}
            data-zoom-id={segment.id}
            // A block's visible text is "2.1×", which says nothing on its own; name it
            // the same way the inspector heading does. Every piece of a split segment
            // carries the same name and pressed state — they are one toggle.
            aria-label={t("zoomTitle", { n: index + 1 })}
            aria-pressed={selected}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelect(segment.id);
            }}
          >
            <span className={styles.level}>{segment.scale.toFixed(1)}×</span>
            {segment.mode === "fixed" && <Lock size={10} className={styles.lock} />}
          </button>
        ));
        if (selected && blocks.length > 0) {
          const first = blocks[0];
          const last = blocks[blocks.length - 1];
          if (first.sourceStart === segment.start)
            nodes.push(handle(segment, "start", first.timelineStart));
          if (last.sourceEnd === segment.end) nodes.push(handle(segment, "end", last.timelineEnd));
        }
        return nodes;
      })}
    </div>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/zoom-lane.module.css`**

```css
.lane {
  position: relative;
  height: 40px;
  border-radius: var(--radius-md);
  background: var(--bg-input);
}

/* UI spec § 6.3 — rgba(246,5,92,.15) background, faint border, level in mono. */
.block {
  position: absolute;
  top: 3px;
  bottom: 3px;
  min-width: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  padding: 0 4px;
  overflow: hidden;
  border: 1px solid color-mix(in srgb, var(--accent-primary) 35%, transparent);
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--accent-primary) 15%, transparent);
  color: var(--text-primary);
  cursor: pointer;
}

.selected {
  border-color: var(--accent-primary);
  background: color-mix(in srgb, var(--accent-primary) 32%, transparent);
  z-index: 1;
}

.level {
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
}

.lock {
  flex-shrink: 0;
}

.handle {
  position: absolute;
  top: 0;
  width: 6px;
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent-primary);
  cursor: ew-resize;
  touch-action: none;
  z-index: 2;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/zoom-lane.test.tsx`**

```tsx
import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../scene";
import { toLayout } from "../timeline";
import type { ZoomSegment } from "../zoom/zoom-model";
import { ZoomLane } from "./zoom-lane";

const items: TrackItem[] = [
  { id: "a", kind: "clip", sourceStart: 0, sourceEnd: 5 },
  { id: "b", kind: "clip", sourceStart: 10, sourceEnd: 20 },
];
const layout = toLayout(items);

const zoom = (partial: Partial<ZoomSegment>): ZoomSegment => ({
  id: "z",
  start: 1,
  end: 3,
  scale: 2,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "auto",
  trigger: "click",
  ...partial,
});

describe("ZoomLane", () => {
  it("renders one block per visible piece and hides fully deleted zooms", () => {
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ id: "span", start: 4, end: 12 }), zoom({ id: "gone", start: 6, end: 9 })]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('[data-zoom-id="span"]')).toHaveLength(2);
    expect(container.querySelectorAll('[data-zoom-id="gone"]')).toHaveLength(0);
  });

  it("shows the level and a lock for fixed zooms", () => {
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ scale: 2.14, mode: "fixed", anchor: { x: 0.5, y: 0.5 } })]}
        selectedId={null}
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.textContent).toContain("2.1×");
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("selects on click and exposes handles only on the real edges", () => {
    const onSelect = vi.fn();
    const { container, rerender } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ start: 4, end: 12 })]}
        selectedId={null}
        onSelect={onSelect}
        onEdgeDrag={vi.fn()}
      />,
    );
    fireEvent.click(container.querySelector('[data-zoom-id="z"]')!);
    expect(onSelect).toHaveBeenCalledWith("z");
    rerender(
      <ZoomLane
        layout={layout}
        segments={[zoom({ start: 4, end: 12 })]}
        selectedId="z"
        onSelect={onSelect}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-zoom-handle]")).toHaveLength(2);
  });

  it("omits the handle of an edge buried in deleted footage", () => {
    // start 6 s is inside the 5–10 s cut, so only the end edge is reachable.
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({ start: 6, end: 12 })]}
        selectedId="z"
        onSelect={vi.fn()}
        onEdgeDrag={vi.fn()}
      />,
    );
    expect(container.querySelectorAll("[data-zoom-handle]")).toHaveLength(1);
    expect(container.querySelector('[data-zoom-handle="end"]')).not.toBeNull();
    expect(container.querySelector('[data-zoom-handle="start"]')).toBeNull();
  });

  it("drags an edge with start/move/end phases in source time", () => {
    const onEdgeDrag = vi.fn();
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({})]}
        selectedId="z"
        onSelect={vi.fn()}
        onEdgeDrag={onEdgeDrag}
      />,
    );
    const lane = container.querySelector('[data-testid="zoom-lane"]') as HTMLElement;
    lane.getBoundingClientRect = () =>
      ({
        left: 0,
        width: 1500,
        top: 0,
        height: 40,
        right: 1500,
        bottom: 40,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    const end = container.querySelector('[data-zoom-handle="end"]') as HTMLElement;
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 300 });
    fireEvent.pointerMove(end, { pointerId: 1, clientX: 900 }); // timeline 9 s → source 14 s
    fireEvent.pointerUp(end, { pointerId: 1, clientX: 900 });
    expect(onEdgeDrag.mock.calls).toEqual([
      ["z", "end", 3, "start"],
      ["z", "end", 14, "move"],
      ["z", "end", null, "end"],
    ]);
  });

  it("ends the drag when the pointer capture is lost, and only once", () => {
    const onEdgeDrag = vi.fn();
    const { container } = render(
      <ZoomLane
        layout={layout}
        segments={[zoom({})]}
        selectedId="z"
        onSelect={vi.fn()}
        onEdgeDrag={onEdgeDrag}
      />,
    );
    const end = container.querySelector('[data-zoom-handle="end"]') as HTMLElement;
    fireEvent.pointerDown(end, { pointerId: 1, clientX: 300 });
    // No pointerup: the gesture is aborted by the platform. Without the abort handlers
    // the controller would stay `interacting` and every later commit would no-op.
    fireEvent.lostPointerCapture(end, { pointerId: 1 });
    fireEvent.pointerCancel(end, { pointerId: 1 });
    expect(onEdgeDrag.mock.calls).toEqual([
      ["z", "end", 3, "start"],
      ["z", "end", null, "end"],
    ]);
  });
});
```

### Task 5 — timeline strip: label column + extra lanes

The existing `timeline-strip.test.tsx` passes unchanged after this diff.

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.tsx
@@ -1,5 +1,6 @@
-import { useCallback, useEffect, useRef } from "react";
+import { useCallback, useEffect, useRef, type ReactElement } from "react";
 import { ImagePlus } from "lucide-react";
+import { useTranslations } from "@kaipu/i18n";
 import type { PreviewPlayback } from "../use-preview-playback";
 import type { LayoutEntry } from "../timeline";
 import { layoutDuration } from "../timeline";
@@ -16,6 +17,18 @@

 const THUMBS_PER_BLOCK_PX = 72; // one thumbnail tile roughly every 72px of block width

+/** A lane stacked under the main track (Activity, Zooms, Privacy — video-editor v2). */
+export interface ExtraLane {
+  key: string;
+  /** Short uppercase label for the label column. */
+  label: string;
+  /** A SINGLE element, not a ReactNode: .timelineBody is a two-column grid and
+   *  auto-places one child per cell, so a lane rendering a fragment with two roots
+   *  would push every following label and lane one cell along. LaneRow also wraps it
+   *  in its own cell div, so neither mistake can reach the grid. */
+  node: ReactElement;
+}
+
 export function TimelineStrip({
   layout,
   playback,
@@ -29,6 +42,7 @@
   selectedOverlayId,
   onSelectOverlay,
   onWindowChange,
+  extraLanes = [],
 }: {
   layout: LayoutEntry[];
   playback: PreviewPlayback;
@@ -53,7 +67,10 @@
   selectedOverlayId: string | null;
   onSelectOverlay: (id: string | null) => void;
   onWindowChange?: (id: string, start: number, end: number, phase: WindowChangePhase) => void;
+  /** Lanes rendered below the main track, each with its label, in order. */
+  extraLanes?: ExtraLane[];
 }): React.JSX.Element {
+  const t = useTranslations("videoEditor");
   const trackRef = useRef<HTMLDivElement | null>(null);
   const playheadRef = useRef<HTMLDivElement | null>(null);
   const duration = layoutDuration(layout);
@@ -136,9 +153,12 @@

   return (
     <div className={styles.strip}>
-      {/* timelineBody gives ruler + overlay lane + track a shared stacking context so
-          the playhead can span all three rows as a single continuous scrub indicator. */}
+      {/* timelineBody is a two-column grid: labels (--lane-label-w) + lanes. Every lane
+          sits in column 2, so all lanes share one horizontal extent and the fraction →
+          time mapping is identical on each. The playhead lives in its own layer
+          spanning column 2 across every row (see .playheadLayer). */}
       <div className={styles.timelineBody}>
+        <span className={styles.laneLabel} />
         <div
           data-testid="ruler"
           className={styles.ruler}
@@ -155,6 +175,7 @@
             </span>
           ))}
         </div>
+        <span className={styles.laneLabel}>{t("laneAnnotations")}</span>
         <OverlayLane
           overlays={overlays}
           duration={duration}
@@ -162,6 +183,7 @@
           onSelectOverlay={onSelectOverlay}
           onWindowChange={(id, start, end, phase) => onWindowChange?.(id, start, end, phase)}
         />
+        <span className={styles.laneLabel}>{t("laneClips")}</span>
         <div
           ref={trackRef}
           className={styles.track}
@@ -183,15 +205,38 @@
             />
           ))}
         </div>
-        {/* Playhead lives in timelineBody — not inside .track — so it visually spans
-            ruler → overlay lane → track as one continuous line. Positioned via direct
-            DOM mutation in the subscribeTime callback (avoid React re-renders at 60fps). */}
-        <div ref={playheadRef} className={styles.playhead} />
+        {extraLanes.map((lane) => (
+          <LaneRow key={lane.key} label={lane.label}>
+            {lane.node}
+          </LaneRow>
+        ))}
+        {/* Positioned via direct DOM mutation in the subscribeTime callback (avoid React
+            re-renders at 60fps). The layer spans every row of the lanes column. */}
+        <div className={styles.playheadLayer}>
+          <div ref={playheadRef} className={styles.playhead} />
+        </div>
       </div>
     </div>
   );
 }

+function LaneRow({
+  label,
+  children,
+}: {
+  label: string;
+  children: ReactElement;
+}): React.JSX.Element {
+  return (
+    <>
+      <span className={styles.laneLabel}>{label}</span>
+      {/* Exactly one grid cell, whatever the lane renders — the label/lane pairing of
+          every row below this one depends on it. */}
+      <div className={styles.laneCell}>{children}</div>
+    </>
+  );
+}
+
 function TrackBlock({
   entry,
   duration,
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.module.css`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.module.css
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/timeline-strip.module.css
@@ -14,13 +14,48 @@
    can span all three rows as one continuous vertical line. */
 .timelineBody {
   position: relative;
-  display: flex;
-  flex-direction: column;
-  gap: var(--space-xs);
+  display: grid;
+  /* Label column (UI spec § 6) + the lanes column. Every lane lives in column 2, so all
+     lanes share one horizontal extent. The width is declared ONCE, here: the grid
+     template and .playheadLayer's offset both read it and must never drift apart. */
+  --lane-label-w: 62px;
+  grid-template-columns: var(--lane-label-w) 1fr;
+  align-items: center;
+  column-gap: var(--space-sm);
+  row-gap: var(--space-xs);
   flex: 1;
   min-height: 0;
 }

+.laneLabel {
+  font-family: var(--font-mono);
+  font-size: 9px;
+  letter-spacing: 0.08em;
+  text-transform: uppercase;
+  color: var(--text-muted);
+  white-space: nowrap;
+  overflow: hidden;
+}
+
+/* One grid cell per extra lane (see LaneRow). min-width: 0 stops a wide lane from
+   growing the column past its 1fr share. */
+.laneCell {
+  min-width: 0;
+}
+
+/* Covers the lanes column across every row; the playhead's left % is relative to it,
+   i.e. to the lanes' width, exactly like each lane's own blocks. --lane-label-w is
+   inherited from .timelineBody, so the 62 px lives in exactly one place. */
+.playheadLayer {
+  position: absolute;
+  top: 0;
+  bottom: 0;
+  left: calc(var(--lane-label-w) + var(--space-sm));
+  right: 0;
+  pointer-events: none;
+  z-index: 3;
+}
+
 .ruler {
   position: relative;
   height: 20px;
@@ -48,8 +83,8 @@

 .track {
   position: relative;
-  flex: 1;
-  min-height: 0;
+  /* Filmstrip row: fixed 44 px (UI spec § 6.1) now that the strip stacks more lanes. */
+  height: 44px;
   border-radius: var(--radius-lg);
   background: var(--bg-input);
   cursor: pointer;
```

The annotations lane is the one lane that predates v2, and next to the new `--bg-input`
slabs its bare strip reads as a rendering bug. Give it the same treatment; its pills are
untouched.

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-lane.module.css`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-lane.module.css
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/overlay-lane.module.css
@@ -4,8 +4,12 @@
  * same design tokens.
  */

 .lane {
   position: relative;
   height: 20px;
   flex-shrink: 0;
+  /* v2: same slab as the Activity / Zooms / Privacy lanes so the stack reads as one
+     timeline (UI spec § 6). Pills still fill the row, so it only shows in empty time. */
+  border-radius: var(--radius-md);
+  background: var(--bg-input);
 }
```

### Task 6 — inspector

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/format.ts`**

```ts
/** "0:10.2" — minutes, seconds, one decimal (inspector range labels, UI spec § 7.1). */
export function formatPrecise(seconds: number): string {
  const t = Math.max(0, seconds);
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, "0")}`;
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/format.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { formatPrecise } from "./format";

describe("formatPrecise", () => {
  it("formats minutes, seconds and one decimal", () => {
    expect(formatPrecise(10.24)).toBe("0:10.2");
    expect(formatPrecise(3.05)).toBe("0:03.0");
    expect(formatPrecise(75.5)).toBe("1:15.5");
    expect(formatPrecise(-1)).toBe("0:00.0");
  });
});
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/editor-inspector.tsx`**

```tsx
/**
 * The right-hand properties column. Picks the one panel that applies to the current
 * selection — never shows controls that do not apply (UI spec § 7). Annotation and
 * clip selections keep their existing UI (floating OverlayOptions / timeline) and show
 * the Detection panel here, so the column is never empty.
 */
import type { ReactNode } from "react";
import styles from "./editor-inspector.module.css";

export function EditorInspector({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <aside className={styles.column} data-testid="editor-inspector">
      {children}
    </aside>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/editor-inspector.module.css`**

```css
/* A flex column so a panel can claim the leftover height and push its destructive
   action to the bottom (.panel { flex: 1 } + .dangerButton { margin-top: auto }). */
.column {
  display: flex;
  flex-direction: column;
  width: 288px;
  flex-shrink: 0;
  overflow-y: auto;
  border-left: 1px solid var(--border);
  background: var(--bg-card);
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/detection-panel.tsx`**

```tsx
/**
 * Inspector with nothing selected (UI spec § 7.4): the single Sensitivity slider that
 * re-runs detection, a live summary and Re-analyse. Without a cursor track it explains
 * why there is nothing to detect instead of showing dead controls.
 */
import { RefreshCw } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { ZoomEditing } from "../../zoom/use-zoom-editing";
import { HistorySlider } from "../history-slider";
import styles from "./inspector.module.css";

export function DetectionPanel({
  zooms,
  sensitivity,
  clicksAvailable,
}: {
  zooms: ZoomEditing;
  sensitivity: number;
  /** False when the track has no clicks (macOS without Accessibility, or PR 2 only). */
  clicksAvailable: boolean;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  return (
    <section className={styles.panel} aria-label={t("detectionTitle")}>
      <h2 className={styles.title}>{t("detectionTitle")}</h2>
      {zooms.canDetect ? (
        <>
          <p className={styles.text}>{t("detectionBody")}</p>
          <HistorySlider
            label={t("sensitivityLabel")}
            value={sensitivity}
            min={0}
            max={100}
            step={1}
            note={t("sensitivityNote")}
            onBegin={zooms.begin}
            onLive={zooms.sensitivityLive}
            onEnd={zooms.end}
            onCommit={zooms.sensitivityCommit}
          />
          <p className={styles.summary}>
            {t("detectionSummary", {
              count: zooms.visibleZooms.length,
              percent: Math.round(zooms.coverage * 100),
            })}
          </p>
          <button type="button" className={styles.secondaryButton} onClick={zooms.reanalyse}>
            <RefreshCw size={14} />
            {t("reanalyse")}
          </button>
          {!clicksAvailable && <p className={styles.hint}>{t("clicksUnavailableHint")}</p>}
        </>
      ) : (
        <p className={styles.text}>{t("detectionNoTrack")}</p>
      )}
      <h3 className={styles.sectionLabel}>{t("selectionLabel")}</h3>
      <p className={styles.text}>{t("selectionHint")}</p>
      <p className={styles.note}>{t("exportSafetyNote")}</p>
    </section>
  );
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/zoom-inspector.tsx`**

```tsx
/**
 * Inspector for a selected zoom (UI spec § 7.1): origin badge, range, Level, Smoothness
 * and Remove. Every control edits through ZoomEditing, which flips the segment to
 * `origin: "manual"`.
 *
 * The spec's Follow / Lock Mode control is NOT here yet: "Lock here" has to pin the
 * camera where the user is currently looking, and that position only exists once the
 * camera path does. It ships with the preview in PR 7 (plans/video-editor-v2/09).
 */
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { sourceRangeToTimelineBlocks } from "../../source-time";
import type { LayoutEntry } from "../../timeline";
import type { ZoomEditing } from "../../zoom/use-zoom-editing";
import type { ZoomSegment } from "../../zoom/zoom-model";
import { ZOOM_LIMITS } from "../../zoom/zoom-model";
import { HistorySlider } from "../history-slider";
import { formatPrecise } from "./format";
import styles from "./inspector.module.css";

export function ZoomInspector({
  segment,
  index,
  layout,
  zooms,
  onRemoved,
}: {
  segment: ZoomSegment;
  /** 1-based position among the visible zooms, for the "Zoom 2" header. */
  index: number;
  layout: LayoutEntry[];
  zooms: ZoomEditing;
  onRemoved(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const blocks = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
  const from = blocks[0]?.timelineStart ?? 0;
  const to = blocks[blocks.length - 1]?.timelineEnd ?? 0;
  const badge =
    segment.trigger === "click"
      ? t("zoomBadgeClick")
      : segment.trigger === "dwell"
        ? t("zoomBadgeDwell")
        : t("zoomBadgeManual");

  return (
    <section className={styles.panel} aria-label={t("zoomTitle", { n: index })}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("zoomTitle", { n: index })}</h2>
        <span className={styles.badge}>{badge}</span>
      </header>
      <p className={styles.range}>
        {formatPrecise(from)} → {formatPrecise(to)}
      </p>
      <HistorySlider
        label={t("zoomLevel")}
        value={segment.scale}
        min={ZOOM_LIMITS.minScale}
        max={ZOOM_LIMITS.maxScale}
        step={0.1}
        format={(v) => `${v.toFixed(1)}×`}
        onBegin={zooms.begin}
        onLive={(scale) => zooms.livePatch(segment.id, { scale })}
        onEnd={zooms.end}
        onCommit={(scale) => zooms.commitPatch(segment.id, { scale })}
      />
      <HistorySlider
        label={t("zoomSmoothness")}
        value={segment.smoothing}
        min={0}
        max={100}
        step={1}
        note={t("zoomSmoothnessNote")}
        onBegin={zooms.begin}
        onLive={(smoothing) => zooms.livePatch(segment.id, { smoothing })}
        onEnd={zooms.end}
        onCommit={(smoothing) => zooms.commitPatch(segment.id, { smoothing })}
      />
      {/* PR 7 inserts the Follow / Lock Mode control and its note here. */}
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          zooms.remove(segment.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("zoomRemove")}
      </button>
    </section>
  );
}
```

`inspector.module.css` also holds the classes later PRs use — `.segmented`, `.segment`
and `.segmentActive` for PR 7's Mode control, `badgeBlur`, `noteInfo`, `swatches`,
`field`… for PR 8's blur/cover inspectors — so every panel shares one look. They are
unused in PR 6 and that is intentional; do not prune them.

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/inspector.module.css`**

```css
/* Properties panel (UI spec § 7): 288 px, content changes with the selection.
   flex: 1 makes the panel fill EditorInspector's flex column, which is what gives
   .dangerButton's `margin-top: auto` something to push against — without it the panel
   is only as tall as its content and the auto margin resolves to zero. */
.panel {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-md);
  padding: var(--space-lg);
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
}

.title {
  margin: 0;
  font-size: var(--font-size-md);
  font-weight: var(--font-weight-semibold);
  color: var(--text-primary);
}

.sectionLabel {
  margin: var(--space-sm) 0 0;
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.badge {
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.06em;
  background: color-mix(in srgb, var(--accent-primary) 18%, transparent);
  color: var(--accent-primary);
  white-space: nowrap;
}

.badgeBlur {
  composes: badge;
  background: color-mix(in srgb, #58a6ff 18%, transparent);
  color: #58a6ff;
}

.range,
.summary {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}

.text {
  margin: 0;
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.note,
.hint {
  margin: 0;
  padding: var(--space-sm);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.noteInfo {
  composes: note;
  color: #58a6ff;
}

.segmented {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-xs);
}

.segment,
.segmentActive,
.secondaryButton,
.dangerButton {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-xs);
  padding: var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
  cursor: pointer;
}

.segmentActive {
  border-color: var(--accent-primary);
  background: var(--accent-primary);
  color: #fff;
}

.dangerButton {
  margin-top: auto;
  border-color: color-mix(in srgb, var(--accent-red) 50%, transparent);
  color: var(--accent-red);
}

.dangerButton:hover {
  background: color-mix(in srgb, var(--accent-red) 12%, transparent);
}

.swatches {
  display: flex;
  gap: var(--space-sm);
}

.swatch,
.swatchActive {
  width: 34px;
  height: 34px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  cursor: pointer;
}

.swatchActive {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}

.fieldInput {
  padding: var(--space-sm);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-input);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}
```

**`apps/kaipu-record/src/renderer/src/features/video-editor/components/inspector/inspector.test.tsx`**

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TrackItem } from "../../scene";
import { toLayout } from "../../timeline";
import type { ZoomEditing } from "../../zoom/use-zoom-editing";
import type { ZoomSegment } from "../../zoom/zoom-model";
import { DetectionPanel } from "./detection-panel";
import { ZoomInspector } from "./zoom-inspector";

const layout = toLayout([{ id: "a", kind: "clip", sourceStart: 0, sourceEnd: 20 }] as TrackItem[]);

const SEGMENT: ZoomSegment = {
  id: "z1",
  start: 10.2,
  end: 16,
  scale: 2.1,
  mode: "follow",
  anchor: null,
  smoothing: 70,
  origin: "auto",
  trigger: "click",
};

function zooms(partial: Partial<ZoomEditing> = {}): ZoomEditing {
  return {
    visibleZooms: [SEGMENT],
    coverage: 0.59,
    addAtPlayhead: vi.fn(),
    remove: vi.fn(),
    commitPatch: vi.fn(),
    begin: vi.fn(),
    livePatch: vi.fn(),
    end: vi.fn(),
    edgeDrag: vi.fn(),
    liveLock: vi.fn(),
    sensitivityLive: vi.fn(),
    sensitivityCommit: vi.fn(),
    reanalyse: vi.fn(),
    canDetect: true,
    ...partial,
  };
}

describe("DetectionPanel", () => {
  it("shows the summary and re-analyses", () => {
    const z = zooms();
    render(<DetectionPanel zooms={z} sensitivity={55} clicksAvailable />);
    expect(screen.getByText("1 zoom · 59% of clip")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Re-analyse/ }));
    expect(z.reanalyse).toHaveBeenCalled();
  });
  it("explains the missing cursor data instead of showing dead controls", () => {
    render(
      <DetectionPanel
        zooms={zooms({ canDetect: false })}
        sensitivity={55}
        clicksAvailable={false}
      />,
    );
    expect(screen.queryByRole("slider")).toBeNull();
    expect(screen.getByText(/no cursor data/)).toBeInTheDocument();
  });
  it("hints at Accessibility when clicks are unavailable", () => {
    render(<DetectionPanel zooms={zooms()} sensitivity={55} clicksAvailable={false} />);
    expect(screen.getByText(/Accessibility access/)).toBeInTheDocument();
  });
});

describe("ZoomInspector", () => {
  it("renders header, badge, range and the two sliders", () => {
    render(
      <ZoomInspector
        segment={SEGMENT}
        index={2}
        layout={layout}
        zooms={zooms()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Zoom 2" })).toBeInTheDocument();
    expect(screen.getByText("CLICK DETECTED")).toBeInTheDocument();
    expect(screen.getByText("0:10.2 → 0:16.0")).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Level" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "Smoothness" })).toBeInTheDocument();
  });
  it("has no Mode control until PR 7 supplies the camera path", () => {
    render(
      <ZoomInspector
        segment={SEGMENT}
        index={1}
        layout={layout}
        zooms={zooms()}
        onRemoved={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /Lock here/ })).toBeNull();
  });
  it("removes and clears the selection", () => {
    const z = zooms();
    const onRemoved = vi.fn();
    render(
      <ZoomInspector segment={SEGMENT} index={1} layout={layout} zooms={z} onRemoved={onRemoved} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Remove this zoom/ }));
    expect(z.remove).toHaveBeenCalledWith("z1");
    expect(onRemoved).toHaveBeenCalled();
  });
});
```

### Task 7 — toolbar: camera group + hint

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.tsx
@@ -10,6 +10,7 @@
   Trash2,
   Type,
   Undo2,
+  ZoomIn,
 } from "lucide-react";
 import { useTranslations } from "@kaipu/i18n";
 import { VIDEO_TOOLS, type VideoTool } from "../annotations/video-tools";
@@ -20,6 +21,19 @@

 type ToolLabelKey = "toolSelect" | "toolBox" | "toolArrow" | "toolText";

+type HintKey = "hintSelect" | "hintBox" | "hintArrow" | "hintText";
+
+/** Contextual one-line hint per active tool (UI spec § 3.2). Exhaustive on purpose:
+ *  when PR 8 adds "blur" and "cover" to VideoTool this stops compiling until their
+ *  hints exist. Zoom is an ACTION, not a tool, so it is absent here by design — its
+ *  `hintZoom` copy lives on the button's title (see the camera group below). */
+const TOOL_HINT: Record<VideoTool, HintKey> = {
+  select: "hintSelect",
+  box: "hintBox",
+  arrow: "hintArrow",
+  text: "hintText",
+};
+
 const TOOL_META: Record<VideoTool, { labelKey: ToolLabelKey; Icon: typeof Square }> = {
   select: { labelKey: "toolSelect", Icon: MousePointer2 },
   box: { labelKey: "toolBox", Icon: Square },
@@ -43,6 +57,8 @@
   /** Current annotation tool. */
   tool: VideoTool;
   onToolChange(tool: VideoTool): void;
+  /** Add a zoom at the playhead, or select the one already there (video-editor v2). */
+  onAddZoom(): void;
   /** Run the export pipeline. Disabled while exporting or when the timeline is empty. */
   onExport(): void;
   exportDisabled: boolean;
@@ -66,6 +82,7 @@
   onAddImage,
   tool,
   onToolChange,
+  onAddZoom,
   onExport,
   exportDisabled,
 }: EditorToolbarProps): React.JSX.Element {
@@ -92,6 +109,21 @@
           );
         })}
       </div>
+      {/* Camera group (UI spec § 3.1 group 2). Zoom is an ACTION, not a drawing mode:
+          it adds a zoom at the playhead (or selects the one there) and the camera box
+          on the preview is how it gets re-aimed. */}
+      <div className={styles.toolGroup}>
+        <button
+          type="button"
+          title={t("hintZoom")}
+          aria-label={t("toolZoom")}
+          className={styles.tool}
+          onClick={onAddZoom}
+        >
+          <ZoomIn size={19} />
+        </button>
+      </div>
+      <span className={styles.hint}>{t(TOOL_HINT[tool])}</span>
       <div className={styles.actions}>
         <button
           type="button"
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.module.css`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.module.css
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.module.css
@@ -128,3 +128,15 @@
   opacity: 0.5;
   cursor: default;
 }
+
+/* Contextual hint (UI spec § 3.2): one line, muted, takes the free space between the
+   tool groups and the actions so the actions stay right-aligned. */
+.hint {
+  flex: 1;
+  min-width: 0;
+  overflow: hidden;
+  text-overflow: ellipsis;
+  white-space: nowrap;
+  font-size: var(--font-size-sm);
+  color: var(--text-muted);
+}
```

**Diff — `apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.test.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.test.tsx
+++ b/apps/kaipu-record/src/renderer/src/features/video-editor/components/editor-toolbar.test.tsx
@@ -15,6 +15,7 @@
     onAddImage: vi.fn(),
     tool: "select",
     onToolChange: vi.fn(),
+    onAddZoom: vi.fn(),
     onExport: vi.fn(),
     exportDisabled: false,
     ...overrides,
@@ -109,3 +110,16 @@
     expect(props.onDeleteSelected).not.toHaveBeenCalled();
   });
 });
+
+describe("EditorToolbar — v2 camera group", () => {
+  it("the Zoom button fires onAddZoom", () => {
+    const props = renderToolbar();
+    fireEvent.click(screen.getByRole("button", { name: "Zoom" }));
+    expect(props.onAddZoom).toHaveBeenCalledTimes(1);
+  });
+
+  it("shows the hint of the active tool", () => {
+    renderToolbar({ tool: "arrow" });
+    expect(screen.getByText("Drag on the preview to draw an arrow.")).toBeInTheDocument();
+  });
+});
```

### Task 8 — page wiring

Applied on top of PR 5's page (doc 07). What it does: builds `useZoomEditing`, memoizes
the Activity marks, adds `handleSelectZoom` (select + seek to the middle of the first
visible piece), `handleAddZoom` (select the zoom under the playhead, else add one; toasts
for slides / no room), `handleRemoveZoom`, the Delete precedence for zooms, the
`workspace` wrapper with the inspector column, the three-column transport with its count,
and the two lanes.

`clearSelection` is already in the keydown effect's dependency array — PR 5 added it with
the `Escape` branch — so this diff only appends `selectedZoomId` and `handleRemoveZoom`.

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.tsx
@@ -48,6 +48,17 @@
 import { parseSession, serializeSession } from "@renderer/features/video-editor/session";
 import { withInitialZooms } from "@renderer/features/video-editor/initial-zooms";
 import { useEditorSelection } from "@renderer/features/video-editor/editor-selection";
+import {
+  sourceRangeToTimelineBlocks,
+  sourceTimeAtTimeline,
+} from "@renderer/features/video-editor/source-time";
+import { activityMarks } from "@renderer/features/video-editor/zoom/detect-zoom-segments";
+import { useZoomEditing } from "@renderer/features/video-editor/zoom/use-zoom-editing";
+import { ActivityLane } from "@renderer/features/video-editor/components/activity-lane";
+import { ZoomLane } from "@renderer/features/video-editor/components/zoom-lane";
+import { EditorInspector } from "@renderer/features/video-editor/components/inspector/editor-inspector";
+import { DetectionPanel } from "@renderer/features/video-editor/components/inspector/detection-panel";
+import { ZoomInspector } from "@renderer/features/video-editor/components/inspector/zoom-inspector";
 import { usePreviewPlayback } from "@renderer/features/video-editor/use-preview-playback";
 import { useSourceThumbnails } from "@renderer/features/video-editor/use-source-thumbnails";
 import { useVideoScene } from "@renderer/features/video-editor/use-video-scene";
@@ -220,6 +231,7 @@
 function VideoEditor({
   source,
   resolvedScene,
+  cursorTrack,
   assetStoreRef,
 }: {
   source: VideoEditorSource;
@@ -261,6 +273,18 @@
   const shouldBlock = useCallback(() => dirtyRef.current && !bypassBlockerRef.current, []);
   const blocker = useBlocker(shouldBlock);
   const playback = usePreviewPlayback(layout);
+  const zooms = useZoomEditing({
+    controller,
+    layout,
+    timelineDuration: playback.duration,
+    sourceDuration: source.durationSeconds,
+    cursorTrack,
+  });
+  // Evidence for the Activity lane — depends only on the (immutable) track.
+  const activity = useMemo(
+    () => (cursorTrack ? activityMarks(cursorTrack, source.durationSeconds) : []),
+    [cursorTrack, source.durationSeconds],
+  );
   const videoTools = useVideoTools();
   const videoExport = useVideoExport();
   const mediaUrl = `kaipu-media://recording/${source.id}`;
@@ -563,8 +587,49 @@
       if (phase === "end") controller.endInteract();
     },
     [controller],
+  );
+
+  // Selecting a zoom also moves the playhead to the middle of its first visible piece
+  // (UI spec § 6.3), so the preview shows what the zoom does.
+  const handleSelectZoom = useCallback(
+    (id: string) => {
+      selectKind("zoom", id);
+      const segment = controller.scene.zoomSegments.find((z) => z.id === id);
+      if (!segment) return;
+      const [first] = sourceRangeToTimelineBlocks(layout, segment.start, segment.end);
+      if (first) playback.seek((first.timelineStart + first.timelineEnd) / 2);
+    },
+    [selectKind, controller, layout, playback],
+  );
+
+  // Zoom tool (an action, not a mode): select the zoom under the playhead if there is
+  // one, otherwise add a manual zoom there.
+  const handleAddZoom = useCallback(() => {
+    const at = sourceTimeAtTimeline(layout, playback.timelineTime);
+    const existing =
+      at === null ? undefined : zooms.visibleZooms.find((z) => at >= z.start && at < z.end);
+    if (existing) {
+      selectKind("zoom", existing.id);
+      return;
+    }
+    const result = zooms.addAtPlayhead(playback.timelineTime);
+    if (result.ok) selectKind("zoom", result.id);
+    else if (result.reason === "on-slide") showToast({ message: t("zoomNotOnSlide") });
+    else if (result.reason === "no-room") showToast({ message: t("zoomNoRoom") });
+  }, [layout, playback.timelineTime, zooms, selectKind, t]);
+
+  const handleRemoveZoom = useCallback(
+    (id: string) => {
+      zooms.remove(id);
+      selectKind("zoom", null);
+    },
+    [zooms, selectKind],
   );

+  const selectedZoom = selectedZoomId
+    ? (zooms.visibleZooms.find((z) => z.id === selectedZoomId) ?? null)
+    : null;
+
   useEffect(() => {
     const onKey = (e: KeyboardEvent): void => {
       if (isEditingTarget(e.target)) return;
@@ -596,7 +661,8 @@
       // Cmd/Ctrl+Backspace is a common "delete line/word" chord in text contexts —
       // require !isMod so it doesn't also delete an overlay or a segment.
       if (!isMod && (e.key === "Delete" || e.key === "Backspace")) {
-        if (selectedOverlayId) handleDeleteOverlay();
+        if (selectedZoomId) handleRemoveZoom(selectedZoomId);
+        else if (selectedOverlayId) handleDeleteOverlay();
         else if (!deleteDisabled) handleDeleteSelected();
       }
     };
@@ -613,6 +679,8 @@
     handleDeleteSelected,
     selectedOverlayId,
     handleDeleteOverlay,
+    selectedZoomId,
+    handleRemoveZoom,
   ]);

   return (
@@ -632,99 +700,137 @@
         onAddImage={handleAddImage}
         tool={videoTools.tool}
         onToolChange={videoTools.setTool}
+        onAddZoom={handleAddZoom}
         onExport={handleExport}
         exportDisabled={videoExport.status === "exporting" || scene.items.length === 0}
       />
-      <main className={styles.stage} ref={stageRef}>
-        {/* Floating per-tool options (Excalidraw-style), pinned to the stage so it
+      <div className={styles.workspace}>
+        <main className={styles.stage} ref={stageRef}>
+          {/* Floating per-tool options (Excalidraw-style), pinned to the stage so it
             doesn't shift with the video's own size. */}
-        <div className={styles.optionsFloat}>
-          <OverlayOptions
-            tools={videoTools}
-            overlays={scene.overlays}
-            selectedId={selectedOverlayId}
-            onCommitOverlay={handleCommitOverlay}
-            onDeleteSelected={handleDeleteOverlay}
-          />
-        </div>
-        {/* Video region: 1fr grid row — centers PreviewStage and constrains its height
+          <div className={styles.optionsFloat}>
+            <OverlayOptions
+              tools={videoTools}
+              overlays={scene.overlays}
+              selectedId={selectedOverlayId}
+              onCommitOverlay={handleCommitOverlay}
+              onDeleteSelected={handleDeleteOverlay}
+            />
+          </div>
+          {/* Video region: 1fr grid row — centers PreviewStage and constrains its height
             so the transport bar below is never clipped regardless of video aspect ratio.
             In fullscreen mode the 50 vh cap is lifted via an inline style override. */}
-        <div
-          className={styles.videoRegion}
-          style={isFullscreen ? { maxHeight: "none" } : undefined}
-        >
-          <PreviewStage
-            playback={playback}
-            mediaUrl={mediaUrl}
-            slideUrl={slideUrl}
-            expanded={isFullscreen}
-            overlay={
-              <VideoAnnotationLayer
-                overlays={scene.overlays}
-                visibleIds={visibleIds}
-                selectedId={selectedOverlayId}
-                onSelect={setSelectedOverlayId}
-                tool={videoTools.tool}
-                toolState={{
-                  color: videoTools.color,
-                  stroke: videoTools.stroke,
-                  textSize: videoTools.textSize,
-                }}
-                playheadTime={playback.timelineTime}
-                timelineDuration={playback.duration}
-                onDraft={(draft) =>
-                  controller.updateLive({
-                    ...scene,
-                    overlays: upsertOverlay(scene.overlays, draft),
-                  })
-                }
-                onCommit={(overlays) => {
-                  controller.commit({ ...scene, overlays });
-                  // Every onCommit call is a just-finished draw or text label (moves/
-                  // resizes finalize through onInteractEnd only) — auto-switch back to
-                  // select so the new overlay can be adjusted right away.
-                  videoTools.setTool("select");
-                }}
-                onInteractStart={controller.beginInteract}
-                onInteractEnd={controller.endInteract}
-                onBackgroundClick={playback.toggle}
-              />
-            }
-          />
-        </div>
-        {/* Transport bar lives outside the overflow:hidden video region so it is always
+          <div
+            className={styles.videoRegion}
+            style={isFullscreen ? { maxHeight: "none" } : undefined}
+          >
+            <PreviewStage
+              playback={playback}
+              mediaUrl={mediaUrl}
+              slideUrl={slideUrl}
+              expanded={isFullscreen}
+              overlay={
+                <VideoAnnotationLayer
+                  overlays={scene.overlays}
+                  visibleIds={visibleIds}
+                  selectedId={selectedOverlayId}
+                  // A click on the canvas background deselects EVERYTHING (spec § 10.5),
+                  // not just the annotation — otherwise a selected zoom would survive it
+                  // and the inspector would keep showing the Zoom panel. The same click
+                  // still toggles play/pause through onBackgroundClick below.
+                  onSelect={(id) => (id === null ? clearSelection() : selectKind("overlay", id))}
+                  tool={videoTools.tool}
+                  toolState={{
+                    color: videoTools.color,
+                    stroke: videoTools.stroke,
+                    textSize: videoTools.textSize,
+                  }}
+                  playheadTime={playback.timelineTime}
+                  timelineDuration={playback.duration}
+                  onDraft={(draft) =>
+                    controller.updateLive({
+                      ...scene,
+                      overlays: upsertOverlay(scene.overlays, draft),
+                    })
+                  }
+                  onCommit={(overlays) => {
+                    controller.commit({ ...scene, overlays });
+                    // Every onCommit call is a just-finished draw or text label (moves/
+                    // resizes finalize through onInteractEnd only) — auto-switch back to
+                    // select so the new overlay can be adjusted right away.
+                    videoTools.setTool("select");
+                  }}
+                  onInteractStart={controller.beginInteract}
+                  onInteractEnd={controller.endInteract}
+                  onBackgroundClick={playback.toggle}
+                />
+              }
+            />
+          </div>
+          {/* Transport bar lives outside the overflow:hidden video region so it is always
             visible even when the video fills the full available height. */}
-        <div className={styles.transport}>
-          <button
-            type="button"
-            className={styles.muteButton}
-            aria-label={playback.muted ? t("unmute") : t("mute")}
-            onClick={playback.toggleMute}
-          >
-            {playback.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
-          </button>
-          <button
-            type="button"
-            className={styles.playButton}
-            aria-label={playback.playing ? t("pause") : t("play")}
-            onClick={playback.toggle}
-          >
-            {playback.playing ? <Pause size={20} /> : <Play size={20} />}
-          </button>
-          <span className={styles.timeDisplay}>
-            {formatTime(playback.timelineTime)} / {formatTime(playback.duration)}
-          </span>
-          <button
-            type="button"
-            className={styles.fullscreenButton}
-            aria-label={isFullscreen ? t("exitFullscreen") : t("fullscreen")}
-            onClick={handleFullscreen}
-          >
-            {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
-          </button>
-        </div>
-      </main>
+          {/* Three columns (see .transport): the play button stays optically centred
+              however wide the side clusters get — v2 puts the zoom count on the right
+              and PR 8 adds the private-region count next to it. */}
+          <div className={styles.transport}>
+            <div className={styles.transportSide}>
+              <button
+                type="button"
+                className={styles.muteButton}
+                aria-label={playback.muted ? t("unmute") : t("mute")}
+                onClick={playback.toggleMute}
+              >
+                {playback.muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
+              </button>
+            </div>
+            <button
+              type="button"
+              className={styles.playButton}
+              aria-label={playback.playing ? t("pause") : t("play")}
+              onClick={playback.toggle}
+            >
+              {playback.playing ? <Pause size={20} /> : <Play size={20} />}
+            </button>
+            <div className={`${styles.transportSide} ${styles.transportRight}`}>
+              <span className={styles.timeDisplay}>
+                {formatTime(playback.timelineTime)} / {formatTime(playback.duration)}
+              </span>
+              {/* Shown whenever there is something to count: a pre-v2 recording has no
+                  cursor track but can still carry hand-made zooms. */}
+              {(cursorTrack || zooms.visibleZooms.length > 0) && (
+                <span className={styles.counts}>
+                  {t("zoomCount", { count: zooms.visibleZooms.length })}
+                </span>
+              )}
+              <button
+                type="button"
+                className={styles.fullscreenButton}
+                aria-label={isFullscreen ? t("exitFullscreen") : t("fullscreen")}
+                onClick={handleFullscreen}
+              >
+                {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
+              </button>
+            </div>
+          </div>
+        </main>
+        <EditorInspector>
+          {selectedZoom ? (
+            <ZoomInspector
+              segment={selectedZoom}
+              index={zooms.visibleZooms.indexOf(selectedZoom) + 1}
+              layout={layout}
+              zooms={zooms}
+              onRemoved={() => selectKind("zoom", null)}
+            />
+          ) : (
+            <DetectionPanel
+              zooms={zooms}
+              sensitivity={scene.zoomSensitivity}
+              clicksAvailable={cursorTrack?.clicksAvailable ?? false}
+            />
+          )}
+        </EditorInspector>
+      </div>
       <footer className={styles.timeline}>
         <TimelineStrip
           layout={layout}
@@ -739,6 +845,30 @@
           selectedOverlayId={selectedOverlayId}
           onSelectOverlay={setSelectedOverlayId}
           onWindowChange={handleWindowChange}
+          extraLanes={[
+            ...(cursorTrack
+              ? [
+                  {
+                    key: "activity",
+                    label: t("laneActivity"),
+                    node: <ActivityLane marks={activity} layout={layout} />,
+                  },
+                ]
+              : []),
+            {
+              key: "zooms",
+              label: t("laneZooms"),
+              node: (
+                <ZoomLane
+                  segments={zooms.visibleZooms}
+                  layout={layout}
+                  selectedId={selectedZoomId}
+                  onSelect={handleSelectZoom}
+                  onEdgeDrag={zooms.edgeDrag}
+                />
+              ),
+            },
+          ]}
         />
       </footer>
       {blocker.state === "blocked" && (
```

**Diff — `apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.module.css`**

```diff
--- a/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.module.css
+++ b/apps/kaipu-record/src/renderer/src/pages/video-editor/video-editor-page.module.css
@@ -61,15 +61,30 @@
 /* Transport bar: always-visible auto row below the video region. */
 .transport {
-  display: flex;
+  /* v2: three columns instead of one centred flex row. `justify-content: center` over a
+     flat row meant the play button drifted left as soon as the zoom count was inserted
+     on its right; with 1fr auto 1fr the centre column stays centred whatever the sides
+     weigh, and the count stays right-aligned next to the fullscreen toggle. */
+  display: grid;
+  grid-template-columns: 1fr auto 1fr;
   align-items: center;
-  justify-content: center;
   gap: var(--space-md);
   padding: var(--space-sm) var(--space-lg);
   border-top: 1px solid var(--border);
   background: var(--bg-card);
   flex-shrink: 0;
 }

+.transportSide {
+  display: flex;
+  align-items: center;
+  gap: var(--space-md);
+  min-width: 0;
+}
+
+.transportRight {
+  justify-content: flex-end;
+}
+
 /* Prominent accent circular play/pause button — the primary transport action. */
 .playButton {
   display: inline-flex;
@@ -150,9 +165,29 @@
 }

 .timeline {
-  height: 160px;
+  /* v2: grows with the lanes (ruler, annotations, clips, activity, zooms, privacy):
+     ≈196 px with PR 6's five rows, ≈238 px once PR 8 adds the 38 px Privacy lane. */
+  min-height: 160px;
   flex-shrink: 0;
   background: var(--bg-card);
   border: 1px solid var(--border);
   border-radius: var(--radius-lg);
 }
+
+/* v2: the stage and the 288 px properties column share the middle row. */
+.workspace {
+  display: flex;
+  min-height: 0;
+}
+
+.workspace > .stage {
+  flex: 1;
+  min-width: 0;
+}
+
+/* "4 zooms detected" · "2 private regions" (UI spec § 5). */
+.counts {
+  font-family: var(--font-mono);
+  font-size: var(--font-size-xs);
+  color: var(--text-muted);
+}
```

### Task 9 — verify

- [ ] Checks (audit rule 4). Verified before publishing: with Tasks 1–8 applied to
      `main`, `typecheck:web` is clean and the whole renderer suite passes (including the
      unchanged `video-editor-page.test.tsx` and `timeline-strip.test.tsx`).
- [ ] Manual with a PR 2 recording: Activity shows ticks/bars; Zooms shows the detected
      blocks; clicking one moves the playhead and opens the inspector; dragging Level is one
      undo step; Sensitivity 0 → 100 changes the count; the edited zoom survives it;
      Delete removes the selected zoom; `Esc` clears; a cut hides blocks of deleted footage
      and undo brings them back.
- [ ] Manual with a pre-v2 recording: no Activity lane, empty Zooms lane, Detection panel
      shows the "no cursor data" text, Zoom button still adds a manual zoom, and the count
      appears as soon as that manual zoom exists.
- [ ] Manual, deselect: with a zoom selected, click the preview background — the inspector
      goes back to Detection and the block loses its selected border (the same click still
      toggles play/pause).
- [ ] Manual, drag abort: start dragging a zoom edge and force the gesture to be lost
      (switch app / trigger a system gesture mid-drag). The drag must end, and undo,
      redo and every button must keep working — a stuck `interacting` shows up as
      "nothing responds any more".
- [ ] Manual, layout: the play button is optically centred both with and without the
      count; press Re-analyse on an untouched recording — undo stays disabled and leaving
      the page raises no discard dialog; at ~800 px window height the video is not
      clipped by the taller footer (below that, see the PR 10 polish row).

## PR 10 polish (not in PR 6)

| Item                      | Implementation                                                                                                                                                                                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shortcuts `V R A T`       | In the page's keydown (after the `isEditingTarget` guard, `!isMod`): `v`→select, `r`→box, `a`→arrow, `t`→text via `videoTools.setTool`. `s` stays "split".                                                                                                                                                              |
| `Z`                       | `handleAddZoom()`.                                                                                                                                                                                                                                                                                                      |
| `B` / `C`                 | `videoTools.setTool("blur" / "cover")` (tools exist after PR 8).                                                                                                                                                                                                                                                        |
| Empty state               | Zooms lane with zero visible zooms and a track: centered muted text `videoEditor.zoomEmptyState` inside the lane.                                                                                                                                                                                                       |
| "ORIGINAL UNTOUCHED" pill | Header, right side: shield icon + `videoEditor.originalUntouched` ("ORIGINAL INTACTO" / "ORIGINAL UNTOUCHED"), not interactive.                                                                                                                                                                                         |
| Tooltips                  | Every toolbar button's `title` includes its shortcut, e.g. `Zoom (Z)`.                                                                                                                                                                                                                                                  |
| Short-window caps         | The footer is ≈ 196 px (≈ 238 px after PR 8), so below a ≈ 850 px window the `1fr` stage row is shorter than the video's `46vh` cap and `.videoRegion { overflow: hidden }` clips the picture. Replace the `vh` caps on `.videoRegion` / `.content` with row-relative ones (`min(46vh, 100%)`) and re-check fullscreen. |
| Accessibility onboarding  | [03 § UI](/plans/video-editor-v2/03-click-hook-permissions-and-gating/#ui-ships-in-pr-10-not-pr-3).                                                                                                                                                                                                                     |

## Non-goals

A light theme pass (the spec notes literal hex must move to tokens — only the two
token-less spec colors remain literal), resizable inspector, collapsible lanes, keyboard
navigation between blocks.

## Reopen if

The shell's layout changes (e.g. the editor becomes a separate window) — then revisit the
"evolve, don't rebuild" mapping above.
