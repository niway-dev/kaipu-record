import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import {
  BLUR_STD,
  HAND_FONT,
  STEP_FONT,
  stepDiameterPx,
  STROKE_WIDTHS,
  TEXT_LINE_HEIGHT,
  resolveFontPx,
  stepFontPx,
  stepInk,
  STEP_HAIRLINE_ALPHA,
  STEP_HAIRLINE_PX,
  STEP_RING_COLOR,
  STEP_SELECTED_RING_PX,
  STEP_SHADOW_ALPHA,
  STEP_SHADOW_DY,
  STEP_SHADOW_STD,
  stepRingPx,
  textBoxPx,
  textLines,
} from "./tools";
import { roughArrow, roughRect } from "./rough";
import { smoothPath } from "./smooth";
import {
  MEASURE_FONT,
  measureEndpoints,
  measureLabel,
  measureShape,
  measureTextColor,
  moveMeasure,
} from "./measure";
import {
  nextAnnotationId,
  stepNumbers,
  type Annotation,
  type BlurAnnotation,
  type ImageAnnotation,
} from "./scene";
import { useRedactionTile } from "./redaction-preview";
import { handleCursor, handlesFor, hitHandle, resizeAnnotation, type HandleId } from "./handles";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import type { RecognizedWord } from "@kaipu/domain/schemas";
import {
  blockRedactionRect,
  lineBoxesNorm,
  nearestBlock,
  nearestWord,
  pixelRectToNorm,
  textBlocks,
  wordBoxNorm,
  type TextBlock,
  type TextLayerModel,
} from "../text-selection";
import { gapMeasures, type WorldRect } from "../canvas/image-gap";
import { ImageSelection } from "../canvas/image-selection";
import { RedactionLockTag } from "../canvas/redaction-lock-tag";
import styles from "./annotation-layer.module.css";

interface Size {
  w: number;
  h: number;
}
interface Pt {
  x: number;
  y: number;
}
type Drag =
  | { mode: "draw-box" | "draw-arrow" | "draw-pen"; start: Pt }
  /**
   * A redaction drag. `block` = the press landed on a recognized text block (NIW2-706): a
   * release without a real drag hides that block instead of drawing nothing.
   */
  | { mode: "draw-blur"; start: Pt; block?: TextBlock }
  | { mode: "move"; id: string; start: Pt; orig: Annotation }
  | { mode: "resize"; id: string; handle: HandleId; orig: Annotation }
  /** A text selection drag (the "Select text" tool); the range runs from `anchor`. */
  | { mode: "select-text"; anchor: RecognizedWord };

/** How far from a word, in display px, a press still starts a selection on it. */
const TEXT_HIT_PX = 6;

/** Radius of a selected measure's end dot: 10 px across (mock C9). */
const MEASURE_DOT_R = 5;

/** Side of a resize handle in px, and the click tolerance around it. */
const HANDLE_PX = 10;
const HANDLE_HIT_PX = 12;

interface LayerProps {
  scene: EditorScene;
  tools: AnnotationToolsController;
  /** The shot's display URL — a blur box re-draws a blurred copy of it under the rect. */
  src: string;
  /**
   * Canvas mode (NIW2-698): annotations may be drawn, moved and resized outside the image.
   * The layer still measures the SHOT (coordinates stay normalized to it), but takes
   * pointer-downs anywhere on the canvas through an invisible hit surface around it.
   */
  canvas?: boolean;
  /**
   * Redaction mode (NIW2-700, behind `image-canvas`): an unlocked blur previews the real
   * destructive redaction as a raster tile, and a locked one (already baked into the
   * stored image) draws nothing and cannot be hit. false (default) = today's gaussian.
   */
  canvasMode?: boolean;
  /**
   * Canvas mode (NIW2-703): display URL of each added image's asset, by asset id. An image
   * annotation whose asset has no URL here draws nothing. Kept referentially stable by the
   * editor (a new object only when an asset is added), since the layer is memoized on it.
   */
  imageUrls?: Readonly<Record<string, string>>;
  /**
   * The recognized words and the selection over them (`image-text`). Present while the flag
   * is on; the words take pointer input only with the "Select text" tool active. The words
   * live in the base image's pixels and are normalized like annotations, so they follow the
   * same pan and zoom. In canvas mode the redact tool also uses them: each line is a target
   * that one click hides (NIW2-706).
   */
  text?: TextLayerModel;
  /**
   * Canvas mode (NIW2-711): told, on every change, which annotations are on screen while a
   * shape is being drawn or moved (the stored ones with the drag applied, plus the draft), and
   * null once nothing is in flight. The editor measures them so the export box grows with the
   * drag instead of jumping on release. Must be referentially stable: the layer is memoized.
   */
  onLive?: (shown: readonly Annotation[] | null) => void;
  /**
   * Canvas mode (NIW2-711): the base image's pixel size. With it, a selected added image
   * shows the gap to its nearest neighbour in source px. Absent = no gap measure.
   */
  natural?: { w: number; h: number };
  /** The image that was just added and has not been touched: its tag says so (NIW2-715). */
  justAddedId?: string | null;
}

/**
 * Interactive annotation overlay. Annotations are stored in normalized (0–1)
 * coordinates so they survive resize; this layer measures its displayed pixel
 * size and renders in px (so stroke/text sizes match the design regardless of
 * the image's natural resolution).
 */
function AnnotationLayerImpl({
  scene,
  tools,
  src,
  canvas = false,
  canvasMode = false,
  imageUrls,
  text,
  onLive,
  natural,
  justAddedId = null,
}: LayerProps): React.JSX.Element {
  const t = useTranslations("screenshots");
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<Size>({ w: 0, h: 0 });
  const [draft, setDraft] = useState<Annotation | null>(null);
  // The line of the recognized word under the pointer (the "Select text" tool): shows the text
  // cursor, the line's soft fill and the "drag to select" tag. Null off the words.
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const overWord = hoverLine !== null;
  // The saved (locked) redaction under the pointer, for its "Permanent" tag (mock H4a). A locked
  // redaction is not a hit target, so this is a separate, read-only hover: it selects nothing.
  const [hoverLockedId, setHoverLockedId] = useState<string | null>(null);
  const activeText = tools.tool === "selectText" ? text : undefined;
  // The redact tool's text targets (NIW2-706): canvas mode only, where a redaction really
  // replaces the pixels; the classic editor's gaussian is partly reversible, so it offers none.
  const redactText = canvasMode && tools.tool === "blur" ? text : undefined;
  const textWords = text?.words;
  const blocks = useMemo(() => (textWords ? textBlocks(textWords) : []), [textWords]);
  // The line the redact tool would hide, by line number (separate from the "Select text"
  // hover above): a hide removes its block, and an index would
  // then name the next one.
  const [hoverHideLine, setHoverHideLine] = useState<number | null>(null);
  // Leaving the tool forgets the hover, so coming back does not outline a stale line.
  if (!redactText && hoverHideLine !== null) setHoverHideLine(null);
  const hoverBlock = redactText ? (blocks.find((b) => b.line === hoverHideLine) ?? null) : null;
  const blockAt = (p: Pt): TextBlock | null => {
    if (!redactText) return null;
    const hit = nearestBlock(blocks, p, redactText.natural, size);
    return hit && hit.distPx <= TEXT_HIT_PX ? blocks[hit.index] : null;
  };
  // One underline per line, under the words' union box. Cheap, and only for the active tool.
  const recognizedLines = useMemo(
    () => (activeText ? lineBoxesNorm(activeText.words, activeText.natural) : []),
    [activeText],
  );
  const hoverTag = recognizedLines.find((l) => l.line === hoverLine)?.box ?? null;
  // A move/resize in flight lives here, not in the scene: the dragged shape renders as
  // `{ ...a, ...patch }` and the scene is touched once, on release, so a drag re-renders
  // this layer only (not the whole editor page) and ends up as one undo entry. The ref
  // mirrors the state for the pointerup/abort handlers, which must read the latest patch.
  const [live, setLive] = useState<{ id: string; patch: Partial<Annotation> } | null>(null);
  const liveRef = useRef<{ id: string; patch: Partial<Annotation> } | null>(null);
  const setLiveBoth = useCallback(
    (next: { id: string; patch: Partial<Annotation> } | null): void => {
      liveRef.current = next;
      setLive(next);
    },
    [],
  );
  // A text edit in progress. `id` present = re-editing an existing label (double
  // click), so commit updates it in place and an emptied label is deleted; absent =
  // a fresh label at (x, y). The prefill fields mirror the edited label so the
  // inline editor is WYSIWYG (same font, colour and wrap width).
  const [editing, setEditing] = useState<{
    x: number;
    y: number;
    id?: string;
    initialText?: string;
    color?: string;
    size?: number;
    width?: number;
    /** A corner-dragged size, so the editor matches the label it covers. */
    fontPx?: number;
  } | null>(null);
  const drag = useRef<Drag | null>(null);
  const textInputRef = useRef<HTMLTextAreaElement>(null);
  // Blur-to-commit is "armed" only after the input has settled, so the click
  // that opened it can't immediately blur-cancel it before the user can type.
  const textArmed = useRef(false);
  // Set once a text edit is resolved (commit or cancel), so the trailing blur
  // fired when the input unmounts can't re-commit — which would duplicate the
  // label (after Enter) or save a cancelled one (after Escape).
  const editDone = useRef(false);
  // Latest scene for the window keydown handler, so it reads fresh state without
  // re-subscribing on every render (scene is a new object each render).
  const sceneRef = useRef(scene);
  sceneRef.current = scene;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = (): void => setSize({ w: el.clientWidth, h: el.clientHeight });
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    measure();
    return () => obs.disconnect();
  }, []);

  const canvasModeRef = useRef(canvasMode);
  canvasModeRef.current = canvasMode;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // Don't hijack keys while the user is typing in a field or a
      // modal is open — only when the canvas owns the key.
      if (isEditingText(e.target) || document.querySelector('[aria-modal="true"]')) return;
      const scn = sceneRef.current;
      if ((e.key === "Delete" || e.key === "Backspace") && scn.selectedId) {
        // A locked redaction is part of the stored image: it cannot be deleted.
        const sel = scn.annotations.find((a) => a.id === scn.selectedId);
        if (canvasModeRef.current && sel?.kind === "blur" && sel.locked) return;
        e.preventDefault();
        scn.removeSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Focus the text input when it opens and arm blur-to-commit on the next frame.
  useEffect(() => {
    if (!editing) {
      textArmed.current = false;
      return;
    }
    const el = textInputRef.current;
    el?.focus();
    if (el) {
      // Show all prefilled lines and drop the caret at the end (re-edit).
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
      el.setSelectionRange(el.value.length, el.value.length);
    }
    const raf = requestAnimationFrame(() => {
      textArmed.current = true;
    });
    return () => cancelAnimationFrame(raf);
  }, [editing]);

  // The hover is stale once the tool changes or the layer is resized (a zoom moves the content
  // under a still pointer); the next pointer move sets it again.
  useEffect(() => {
    setHoverLockedId(null);
  }, [tools.tool, size.w, size.h]);

  const toNorm = (e: { clientX: number; clientY: number }): Pt => {
    const r = ref.current!.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
  };

  // Double-clicking a text label reopens it for editing in place (Excalidraw-style).
  // Select tool only, so it never clashes with the drawing tools' single-click.
  const onDoubleClick = (e: React.MouseEvent): void => {
    if (tools.tool !== "select") return;
    const hit = hitTest(scene.annotations, toNorm(e), size, canvasMode);
    // A double-click on an annotation is the annotation's (a label reopens); only one on the
    // bare image reaches the frame's "double-click to edit the crop" (NIW2-759).
    if (hit) e.stopPropagation();
    if (hit?.kind !== "text") return;
    scene.select(hit.id);
    editDone.current = false;
    setEditing({
      x: hit.x,
      y: hit.y,
      id: hit.id,
      initialText: hit.text,
      color: hit.color,
      size: hit.size,
      width: hit.width,
      fontPx: hit.fontPx,
    });
  };

  const onPointerDown = (e: React.PointerEvent): void => {
    setHoverLockedId(null);
    // The crop tool's overlay owns presses on the frame; one that reaches the hit surface
    // outside it must not start a drawing.
    if (canvas && tools.tool === "crop") return;
    const p = toNorm(e);
    if (tools.tool === "selectText") {
      // A press on or near a word starts a selection there; one on empty space clears it.
      if (!activeText) return;
      const hit = nearestWord(activeText.words, p, activeText.natural, size);
      if (hit && hit.distPx <= TEXT_HIT_PX) {
        const anchor = activeText.words[hit.index];
        drag.current = { mode: "select-text", anchor };
        activeText.select(anchor, anchor);
        // The layer, not the target: a highlight under the pointer unmounts as the range changes.
        ref.current?.setPointerCapture(e.pointerId);
      } else {
        activeText.clear();
      }
      return;
    }
    if (tools.tool === "select") {
      // A selected shape's resize handles take priority over the shape hit-test, so
      // grabbing a corner resizes instead of moving. Skipped while the inline text
      // editor is open: the handles are hidden then, so hit-testing them would start
      // a resize from a corner the user cannot see.
      const sel = editing
        ? null
        : (scene.annotations.find((a) => a.id === scene.selectedId) ?? null);
      if (sel) {
        const tol = { x: HANDLE_HIT_PX / (size.w || 1), y: HANDLE_HIT_PX / (size.h || 1) };
        const handle = hitHandle(handlesFor(sel, size), p, tol);
        if (handle) {
          drag.current = { mode: "resize", id: sel.id, handle, orig: sel };
          ref.current?.setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = hitTest(scene.annotations, p, size, canvasMode);
      scene.select(hit?.id ?? null);
      // The label whose inline editor is open belongs to that editor. The hit-test
      // keeps an 8px margin around it, and the textarea only covers the box itself,
      // so a press in that ring would drag the label out from under its own caret.
      // Today the textarea's min-width hides the ring on short labels; this does not
      // depend on that. Other shapes stay grabbable, so "click another shape while
      // editing to select it" is unchanged.
      const editingThis = editing?.id !== undefined && hit?.id === editing.id;
      if (hit && !editingThis) {
        drag.current = { mode: "move", id: hit.id, start: p, orig: hit };
        (e.target as Element).setPointerCapture?.(e.pointerId);
      }
      return;
    }
    if (tools.tool === "text") {
      // window.prompt() is disabled in Electron — show an inline input instead.
      scene.select(null); // editing a fresh label, not the previously selected one
      editDone.current = false;
      setEditing({ x: p.x, y: p.y });
      return;
    }
    if (tools.tool === "step") {
      // Only the primary button places a badge: a right-click, or the middle-button drag
      // that pans the canvas, must not commit a number.
      if (e.button !== 0) return;
      // Each click drops the next number. The tool stays active (unlike the drawing
      // tools) so consecutive clicks number 1, 2, 3. The new badge is NOT selected: the
      // options panel edits the selection, so picking a colour for the next badge would
      // repaint the one just placed.
      const { id } = nextAnnotationId();
      scene.addAnnotation({
        id,
        kind: "step",
        x: p.x,
        y: p.y,
        color: tools.color,
        size: tools.stepSize,
      });
      scene.select(null);
      return;
    }
    if (tools.tool === "pen") {
      drag.current = { mode: "draw-pen", start: p };
      setDraft({
        id: "draft",
        kind: "path",
        points: [p],
        color: tools.color,
        stroke: tools.stroke,
      });
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    if (tools.tool === "blur") {
      // Only the primary button hides a block: a middle-button pan must not redact.
      const block = e.button === 0 ? blockAt(p) : null;
      drag.current = block
        ? { mode: "draw-blur", start: p, block }
        : { mode: "draw-blur", start: p };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      return;
    }
    const mode = tools.tool === "box" ? "draw-box" : "draw-arrow";
    drag.current = { mode, start: p };
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent): void => {
    const d = drag.current;
    if (!d) {
      if (canvasMode) {
        const locked = hitLockedBlur(scene.annotations, toNorm(e));
        setHoverLockedId(locked?.id ?? null);
      }
      if (activeText) {
        const hit = nearestWord(activeText.words, toNorm(e), activeText.natural, size);
        setHoverLine(
          hit !== null && hit.distPx <= TEXT_HIT_PX ? activeText.words[hit.index].line : null,
        );
      }
      if (redactText) setHoverHideLine(blockAt(toNorm(e))?.line ?? null);
      return;
    }
    const p = toNorm(e);
    if (d.mode === "select-text") {
      // The word under the pointer, or the nearest one when it is between words.
      const hit = activeText ? nearestWord(activeText.words, p, activeText.natural, size) : null;
      if (activeText && hit) activeText.select(d.anchor, activeText.words[hit.index]);
      return;
    }
    if (d.mode === "move") {
      setLiveBoth({ id: d.id, patch: moveBy(d.orig, p.x - d.start.x, p.y - d.start.y) });
      return;
    }
    if (d.mode === "resize") {
      // Resize from the ORIGINAL geometry each frame (fixed edges stay put, no drift).
      setLiveBoth({ id: d.id, patch: resizeAnnotation(d.orig, d.handle, p, size, canvas) });
      return;
    }
    if (d.mode === "draw-pen") {
      setDraft((prev) => {
        if (!prev || prev.kind !== "path") return prev;
        const last = prev.points[prev.points.length - 1];
        // Throttle: drop points too close to the last so the path stays light + smooth.
        if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.004) return prev;
        return { ...prev, points: [...prev.points, p] };
      });
      return;
    }
    if (d.mode === "draw-blur") {
      // Once the pointer leaves the click tolerance the gesture is a drag, even if it comes
      // back: only a press that stays put hides the line under it.
      const away = Math.hypot((p.x - d.start.x) * size.w, (p.y - d.start.y) * size.h);
      if (d.block && away > TEXT_HIT_PX) drag.current = { mode: "draw-blur", start: d.start };
      setDraft({
        id: "draft",
        kind: "blur",
        x: Math.min(d.start.x, p.x),
        y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x),
        h: Math.abs(p.y - d.start.y),
        // Absent = the strong blur; only "solid" is stored.
        ...(canvasMode && tools.redactionStyle === "solid" ? { style: "solid" as const } : {}),
      });
      return;
    }
    if (d.mode === "draw-box") {
      setDraft({
        id: "draft",
        kind: "box",
        x: Math.min(d.start.x, p.x),
        y: Math.min(d.start.y, p.y),
        w: Math.abs(p.x - d.start.x),
        h: Math.abs(p.y - d.start.y),
        color: tools.color,
        stroke: tools.stroke,
        seed: 7,
      });
    } else {
      setDraft({
        id: "draft",
        kind: "arrow",
        x1: d.start.x,
        y1: d.start.y,
        x2: p.x,
        y2: p.y,
        color: tools.color,
        stroke: tools.stroke,
        seed: 7,
      });
    }
  };

  // Ends a move/resize: one commit (one history entry, one page render) with whatever
  // was last shown. A press without movement never set a patch, so it commits nothing.
  const commitLive = (): void => {
    const l = liveRef.current;
    setLiveBoth(null);
    if (l) scene.commitAnnotation(l.id, l.patch);
  };

  const onPointerUp = (): void => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.mode === "select-text") return;
    if (d.mode === "move" || d.mode === "resize") {
      commitLive();
      return;
    }
    // Still a click (the block is dropped once the pointer leaves the tolerance): hide the
    // line, whatever size the jitter drew; on a small layer 1% is less than the tolerance.
    if (d.mode === "draw-blur" && d.block && redactText) {
      hideBlock(d.block, redactText);
      setDraft(null);
      return;
    }
    if (draft && isBigEnough(draft)) {
      const { id, seed } = nextAnnotationId();
      // Paths/blurs carry no rough jitter, so they need no seed.
      const seedless = draft.kind === "path" || draft.kind === "blur";
      const committed = seedless ? { ...draft, id } : { ...draft, id, seed };
      scene.addAnnotation(committed as Annotation);
      // Auto-select the finished shape (Excalidraw-style) so it can be moved/resized
      // right away — the pen included, so every tool behaves the same on release.
      tools.setTool("select");
      scene.select(id);
    }
    setDraft(null);
  };

  // One click on a text block: a redaction over its box, grown by a small margin, in the
  // style the tool has. The tool stays on and nothing is selected (like the step tool), so
  // the next line is one more click; the hidden words leave `text.words` at once, so the
  // block stops being a target.
  const hideBlock = (block: TextBlock, model: TextLayerModel): void => {
    const { natural } = model;
    const r = blockRedactionRect(block, model.words, natural);
    if (r.w <= 0 || r.h <= 0) return;
    const { id } = nextAnnotationId();
    scene.addAnnotation({
      id,
      kind: "blur",
      ...pixelRectToNorm(r, natural),
      ...(tools.redactionStyle === "solid" ? { style: "solid" as const } : {}),
    });
    scene.select(null);
    setHoverHideLine(null);
  };

  // A pointer gesture can end without a pointerup (system gesture, capture stolen).
  // Abort cleanly so a half-drawn draft or an open move-interaction isn't stranded.
  const onPointerAbort = (): void => {
    const d = drag.current;
    drag.current = null;
    if (d?.mode === "move" || d?.mode === "resize") commitLive();
    setDraft(null);
  };

  const commitText = (value: string): void => {
    if (editDone.current) return; // a trailing unmount-blur after Enter/Escape
    editDone.current = true;
    const text = value.trim();

    // Re-editing an existing label (double-click): update it in place as one undoable
    // change, or delete it if the user cleared the text (Excalidraw-style).
    if (editing?.id) {
      // The id was captured when the edit started; selection is NOT consulted, because
      // the blur that commits this can land after the user already selected another shape.
      if (text) scene.commitAnnotation(editing.id, { text });
      else scene.removeAnnotation(editing.id);
      setEditing(null);
      return;
    }

    if (editing && text) {
      const { id } = nextAnnotationId();
      scene.addAnnotation({
        id,
        kind: "text",
        x: editing.x,
        y: editing.y,
        text,
        color: tools.color,
        size: tools.textSize,
      });
      scene.select(id);
      tools.setTool("select"); // auto-select the new label so it can be moved right away
    }
    setEditing(null);
  };

  // Resize handles show for the selected shape while the select tool is active —
  // never while the inline text editor is open. Their geometry comes from the
  // STORED annotation, which stops matching the moment the user types, so the box
  // visibly deforms around the editor; and there is nothing to resize mid-edit,
  // since the label's size follows its text until the edit is committed.
  // Both read `shown` so the handles follow the drag; hit-testing keeps using the scene.
  const shown = useMemo(
    () =>
      live
        ? scene.annotations.map((a) =>
            a.id === live.id ? ({ ...a, ...live.patch } as Annotation) : a,
          )
        : scene.annotations,
    [scene.annotations, live],
  );
  // Tell the editor what is on screen while a drag is in flight (see `onLive`).
  const inFlight = draft != null || live != null;
  useEffect(() => {
    onLive?.(inFlight ? (draft ? [...shown, draft] : shown) : null);
  }, [onLive, inFlight, draft, shown]);
  // Added images (NIW2-703) wear the base's corner radius and shadow, in the same display
  // px (the layer's size IS the displayed shot). `state` is absent only in test doubles.
  const radius = scene.beautify.state?.radius ?? 0;
  const shadow = scene.beautify.state?.shadow ?? 0;
  // Every blur still to be baked, drafts included: each one previews on the images it
  // touches, as the save bakes it into them (see `bakeCanvasRedactions`).
  // Keyed on the blur draft only: any other draft changes on every pointer move, and a new
  // array would re-render every memoized added image (filter included) while drawing.
  const blurDraft = draft?.kind === "blur" ? draft : null;
  const redactions = useMemo(
    () =>
      canvasMode
        ? [
            ...shown.filter((a): a is BlurAnnotation => a.kind === "blur" && !a.locked),
            ...(blurDraft ? [blurDraft] : []),
          ]
        : NO_BLURS,
    [canvasMode, shown, blurDraft],
  );
  const numbers = useMemo(() => stepNumbers(shown), [shown]);
  const selectedAnnotation =
    tools.tool === "select" && !editing
      ? (shown.find((a) => a.id === scene.selectedId) ?? null)
      : null;
  // A selected added image shows the gap to its nearest neighbour (mock A4). The base image
  // is a neighbour too. World units: 1 = one source px of the base, so the number is the one
  // the export has. Follows the drag, because it reads `shown`.
  const selectedImage =
    canvasMode && selectedAnnotation?.kind === "image" ? selectedAnnotation : null;
  // A selected saved redaction says it is permanent (mock H4a). It is part of the stored image:
  // the card offers no style or delete for it either.
  const hoveredLocked = canvasMode
    ? ((shown.find((a) => a.id === hoverLockedId && a.kind === "blur" && a.locked) as
        | BlurAnnotation
        | undefined) ?? null)
    : null;
  const selectedLocked =
    hoveredLocked ??
    (canvasMode && selectedAnnotation?.kind === "blur" && selectedAnnotation.locked
      ? selectedAnnotation
      : null);
  const gaps = useMemo(() => {
    if (!selectedImage || !natural || natural.w <= 0 || natural.h <= 0) return [];
    const world = (a: { x: number; y: number; w: number; h: number }): WorldRect => ({
      x: a.x * natural.w,
      y: a.y * natural.h,
      w: a.w * natural.w,
      h: a.h * natural.h,
    });
    const others: WorldRect[] = [{ x: 0, y: 0, w: natural.w, h: natural.h }];
    for (const a of shown)
      if (a.kind === "image" && a.id !== selectedImage.id) others.push(world(a));
    return gapMeasures(world(selectedImage), others);
  }, [selectedImage, natural, shown]);

  return (
    <div
      ref={ref}
      className={styles.layer}
      {...(activeText
        ? uiArea("editorImage.textSelection")
        : redactText
          ? uiArea("editorImage.textHide")
          : {})}
      style={{
        cursor:
          tools.tool === "select"
            ? "default"
            : tools.tool === "selectText"
              ? overWord
                ? "text"
                : "default"
              : hoverBlock
                ? "pointer"
                : "crosshair",
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerLeave={() => {
        setHoverLockedId(null);
        setHoverLine(null);
        setHoverHideLine(null);
      }}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerAbort}
      onLostPointerCapture={onPointerAbort}
      onDoubleClick={onDoubleClick}
    >
      {canvas && <div className={styles.hitSurface} data-testid="canvas-hit-surface" aria-hidden />}
      <svg className={styles.svg} width={size.w} height={size.h}>
        {shown.map((a, i) =>
          // Hide the label being re-edited — the inline editor sits on top of it.
          a.id === editing?.id ? null : a.kind === "image" ? (
            <ImageShape
              key={a.id}
              a={a}
              size={size}
              selected={scene.selectedId === a.id}
              url={imageUrls?.[a.assetId]}
              radius={radius}
              shadow={shadow}
              redactions={redactions}
            />
          ) : (
            <React.Fragment key={a.id}>
              <Shape
                a={a}
                size={size}
                selected={scene.selectedId === a.id}
                src={src}
                canvasMode={canvasMode}
                n={numbers.get(a.id)}
              />
              {canvasMode && a.kind === "blur" && (
                <BlurOverImagesBelow
                  blur={a}
                  below={shown.slice(0, i)}
                  imageUrls={imageUrls}
                  size={size}
                />
              )}
            </React.Fragment>
          ),
        )}
        {draft && (
          <>
            <Shape a={draft} size={size} selected={false} src={src} canvasMode={canvasMode} />
            {canvasMode && draft.kind === "blur" && (
              <BlurOverImagesBelow blur={draft} below={shown} imageUrls={imageUrls} size={size} />
            )}
          </>
        )}
        {/* An added image's handles are drawn by `ImageSelection` (mock A4), not here. */}
        {selectedAnnotation && selectedAnnotation.kind !== "image" && (
          <Handles a={selectedAnnotation} size={size} />
        )}
        {activeText && recognizedLines.length > 0 && (
          <g data-testid="text-lines" className={styles.textLines}>
            {recognizedLines.map(({ line, box }) => (
              <React.Fragment key={line}>
                {/* Transparent until hovered: it is also the line's box for the catalog's hover. */}
                <rect
                  data-testid="text-line-box"
                  data-hover={line === hoverLine || undefined}
                  className={styles.textLineBox}
                  x={box.x * size.w}
                  y={box.y * size.h}
                  width={box.w * size.w}
                  height={box.h * size.h}
                />
                <line
                  data-testid="text-line-underline"
                  x1={box.x * size.w}
                  x2={(box.x + box.w) * size.w}
                  y1={(box.y + box.h) * size.h}
                  y2={(box.y + box.h) * size.h}
                />
              </React.Fragment>
            ))}
          </g>
        )}
        {hoverBlock && redactText && !draft && (
          <TextTarget block={hoverBlock} model={redactText} size={size} />
        )}
        {activeText && activeText.selected.size > 0 && (
          <g data-testid="text-highlights" className={styles.textHighlights}>
            {activeText.words
              .filter((w) => activeText.selected.has(w))
              .map((w, i) => {
                const b = wordBoxNorm(w, activeText.natural);
                return (
                  <rect
                    key={i}
                    data-testid="text-highlight"
                    x={b.x * size.w}
                    y={b.y * size.h}
                    width={b.w * size.w}
                    height={b.h * size.h}
                  />
                );
              })}
          </g>
        )}
      </svg>
      {hoverTag && (
        <span
          data-testid="text-line-tag"
          className={styles.textLineTag}
          style={{ left: hoverTag.x * size.w, top: (hoverTag.y + hoverTag.h) * size.h + 4 }}
        >
          {t("textLineTag")}
        </span>
      )}
      {selectedImage && (
        <ImageSelection
          rect={{
            x: selectedImage.x * size.w,
            y: selectedImage.y * size.h,
            w: selectedImage.w * size.w,
            h: selectedImage.h * size.h,
          }}
          pixelWidth={selectedImage.pixelWidth}
          pixelHeight={selectedImage.pixelHeight}
          justAdded={justAddedId != null && justAddedId === selectedImage.id}
          gaps={gaps}
          unit={natural && natural.w > 0 ? size.w / natural.w : 1}
        />
      )}
      {selectedLocked && (
        <RedactionLockTag
          left={(selectedLocked.x + selectedLocked.w) * size.w}
          top={selectedLocked.y * size.h}
          lockedAt={selectedLocked.lockedAt}
        />
      )}
      {editing && (
        <textarea
          ref={textInputRef}
          className={styles.textInput}
          placeholder={t("typePlaceholder")}
          rows={1}
          // Prefilled when re-editing an existing label; empty for a fresh one.
          defaultValue={editing.initialText}
          // With a wrap width, soft-wrap at that width to mirror the label (WYSIWYG);
          // otherwise lines break only on the user's Alt/Shift+Enter.
          wrap={editing.width != null ? "soft" : "off"}
          style={{
            left: editing.x * size.w,
            top: editing.y * size.h,
            width: editing.width != null ? editing.width * size.w : undefined,
            color: editing.color ?? tools.color,
            fontFamily: HAND_FONT,
            // The editor has to match the label it covers, custom size included.
            fontSize: resolveFontPx(editing.size ?? tools.textSize, editing.fontPx),
            lineHeight: TEXT_LINE_HEIGHT,
            whiteSpace: editing.width != null ? "pre-wrap" : "pre",
            // Match the committed label, which breaks a word too long for the box
            // (see textLines). Stated rather than left to the UA default, so the
            // editor and the label cannot drift apart.
            overflowWrap: "break-word",
            resize: "none",
            overflow: "hidden",
          }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            // Plain Enter commits. Alt+Enter / Shift+Enter fall through to the
            // textarea's default and insert a newline (Excalidraw / spreadsheet
            // behaviour), then auto-grow runs on the resulting change.
            if (e.key === "Enter" && !e.altKey && !e.shiftKey) {
              e.preventDefault();
              commitText(e.currentTarget.value);
            } else if (e.key === "Escape") {
              e.preventDefault();
              editDone.current = true; // cancel — the unmount blur must not commit
              setEditing(null);
            }
          }}
          onInput={(e) => {
            // Grow with the content so every line stays visible while typing.
            const el = e.currentTarget;
            el.style.height = "auto";
            el.style.height = `${el.scrollHeight}px`;
          }}
          onBlur={(e) => {
            // Ignore the opening click's spurious blur — refocus and keep typing.
            if (!textArmed.current) {
              e.currentTarget.focus();
              return;
            }
            commitText(e.target.value);
          }}
        />
      )}
    </div>
  );
}

// The editor page re-renders on every beautify-slider tick; the layer only needs to
// follow the props it reads. Add every new prop here too, or the layer stops seeing it
// change.
function sameLayerProps(p: LayerProps, n: LayerProps): boolean {
  return (
    p.src === n.src &&
    p.canvas === n.canvas &&
    p.scene.annotations === n.scene.annotations &&
    p.scene.selectedId === n.scene.selectedId &&
    p.scene.removeSelected === n.scene.removeSelected &&
    p.tools.tool === n.tools.tool &&
    p.tools.color === n.tools.color &&
    p.tools.stroke === n.tools.stroke &&
    p.tools.textSize === n.tools.textSize &&
    p.tools.redactionStyle === n.tools.redactionStyle &&
    p.tools.stepSize === n.tools.stepSize &&
    p.canvasMode === n.canvasMode &&
    p.imageUrls === n.imageUrls &&
    // Added images follow the beautify radius and shadow; nothing else of it is read.
    p.scene.beautify.state?.radius === n.scene.beautify.state?.radius &&
    p.scene.beautify.state?.shadow === n.scene.beautify.state?.shadow &&
    p.text === n.text &&
    p.onLive === n.onLive &&
    p.natural?.w === n.natural?.w &&
    p.natural?.h === n.natural?.h
  );
}

export const AnnotationLayer = React.memo(AnnotationLayerImpl, sameLayerProps);

/**
 * The outline of the text block a click would hide (the redact tool, NIW2-706). It traces
 * the rect the redaction will take, margin included, so what is outlined is what is hidden.
 */
function TextTarget({
  block,
  model,
  size,
}: {
  block: TextBlock;
  model: TextLayerModel;
  size: Size;
}): React.JSX.Element {
  const r = blockRedactionRect(block, model.words, model.natural);
  const sx = size.w / model.natural.w;
  const sy = size.h / model.natural.h;
  return (
    <g data-testid="text-target" className={styles.textTarget}>
      <rect x={r.x * sx} y={r.y * sy} width={r.w * sx} height={r.h * sy} rx={3} />
    </g>
  );
}

/** Resize handles drawn over the selected shape. Hit-testing is geometric (in the
 *  layer's onPointerDown), so these are purely visual + carry the resize cursor. */
function Handles({ a, size }: { a: Annotation; size: Size }): React.JSX.Element {
  const { w: W, h: H } = size;
  if (a.kind === "measure") {
    // Mock C9: round end dots in the measure's own color (same grab targets, same hit-testing).
    return (
      <g>
        {handlesFor(a, size).map((h) => (
          <g key={h.id} style={{ cursor: handleCursor(h.id) }}>
            <circle
              className={styles.measureDotRing}
              cx={h.x * W}
              cy={h.y * H}
              r={MEASURE_DOT_R + 1}
            />
            <circle
              data-testid="resize-handle"
              className={styles.measureDot}
              cx={h.x * W}
              cy={h.y * H}
              r={MEASURE_DOT_R}
              stroke={a.color}
            />
          </g>
        ))}
      </g>
    );
  }
  return (
    <g>
      {handlesFor(a, size).map((h) => (
        <rect
          key={h.id}
          data-testid="resize-handle"
          className={styles.handle}
          x={h.x * W - HANDLE_PX / 2}
          y={h.y * H - HANDLE_PX / 2}
          width={HANDLE_PX}
          height={HANDLE_PX}
          rx={2}
          style={{ cursor: handleCursor(h.id) }}
        />
      ))}
    </g>
  );
}

const Shape = React.memo(function Shape({
  a,
  size,
  selected,
  src,
  canvasMode,
  n,
}: {
  a: Annotation;
  size: Size;
  selected: boolean;
  src: string;
  canvasMode: boolean;
  /** The badge's number, for a `step` annotation (see `stepNumbers`). */
  n?: number;
}): React.JSX.Element {
  const { w: W, h: H } = size;

  // An added image (NIW2-703) is drawn by `ImageShape`, which needs its URL and the
  // redactions over it; the layer never routes one here.
  if (a.kind === "image") return <g />;

  if (a.kind === "step") {
    const d = stepDiameterPx(a.size);
    const num = n ?? 1;
    const ink = stepInk(a.color);
    const cx = a.x * W;
    const cy = a.y * H;
    const ring = stepRingPx(d);
    const filterId = `stepf-${a.id}`;
    return (
      <g data-annotation={a.id}>
        <defs>
          <filter id={filterId} x="-100%" y="-100%" width="300%" height="300%">
            <feMorphology
              in="SourceAlpha"
              operator="dilate"
              radius={STEP_HAIRLINE_PX}
              result="halo"
            />
            <feFlood floodColor="#000" floodOpacity={STEP_HAIRLINE_ALPHA} />
            <feComposite in2="halo" operator="in" result="hair" />
            <feGaussianBlur in="halo" stdDeviation={STEP_SHADOW_STD} result="blur" />
            <feOffset in="blur" dx={0} dy={STEP_SHADOW_DY} result="off" />
            <feFlood floodColor="#000" floodOpacity={STEP_SHADOW_ALPHA} />
            <feComposite in2="off" operator="in" result="shadow" />
            <feMerge>
              <feMergeNode in="shadow" />
              <feMergeNode in="hair" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <circle
          cx={cx}
          cy={cy}
          r={d / 2}
          fill={a.color}
          stroke={STEP_RING_COLOR}
          strokeWidth={ring}
          filter={`url(#${filterId})`}
        />
        <text
          x={cx}
          y={cy}
          fill={ink}
          fontFamily={STEP_FONT}
          fontSize={stepFontPx(d, num)}
          fontWeight={700}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ userSelect: "none" }}
        >
          {num}
        </text>
        {selected && (
          <circle
            data-step-selected=""
            className={styles.stepSelected}
            cx={cx}
            cy={cy}
            r={d / 2 + ring / 2 + STEP_SELECTED_RING_PX / 2}
            strokeWidth={STEP_SELECTED_RING_PX}
          />
        )}
      </g>
    );
  }

  if (a.kind === "blur" && canvasMode) {
    return <RedactionTile a={a} size={size} selected={selected} src={src} />;
  }

  if (a.kind === "blur") {
    const bx = a.x * W;
    const by = a.y * H;
    const bw = a.w * W;
    const bh = a.h * H;
    // Re-draw a blurred copy of the shot, clipped to the rect — sits over the sharp
    // image so the region reads as blurred. Baked into the export (see compositor).
    // The filter region is bounded to the rect + margin, so the blur only processes
    // those pixels (not the whole shot) and doesn't fade at the rect's edge.
    const m = BLUR_STD * 3;
    return (
      <g data-annotation={a.id}>
        <defs>
          <clipPath id={`bclip-${a.id}`}>
            <rect x={bx} y={by} width={bw} height={bh} />
          </clipPath>
          <filter
            id={`bfilter-${a.id}`}
            filterUnits="userSpaceOnUse"
            x={bx - m}
            y={by - m}
            width={bw + 2 * m}
            height={bh + 2 * m}
          >
            <feGaussianBlur stdDeviation={BLUR_STD} />
          </filter>
        </defs>
        <image
          href={src}
          x={0}
          y={0}
          width={W}
          height={H}
          preserveAspectRatio="none"
          clipPath={`url(#bclip-${a.id})`}
          filter={`url(#bfilter-${a.id})`}
        />
        {selected && <rect className={styles.selOutline} x={bx} y={by} width={bw} height={bh} />}
      </g>
    );
  }

  if (a.kind === "box") {
    const bw = a.w * W;
    const bh = a.h * H;
    const sw = STROKE_WIDTHS[a.stroke];
    const path = roughRect(bw, bh, 14, a.seed);
    return (
      <g data-annotation={a.id} transform={`translate(${a.x * W},${a.y * H})`}>
        <path d={path} fill={`${a.color}2e`} stroke="none" />
        <path
          d={path}
          fill="none"
          stroke={a.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roughRect(bw, bh, 14, a.seed + 19)}
          fill="none"
          stroke={a.color}
          strokeWidth={sw * 0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
        {selected && (
          <rect className={styles.selOutline} x={-4} y={-4} width={bw + 8} height={bh + 8} />
        )}
      </g>
    );
  }

  if (a.kind === "arrow") {
    const x1 = a.x1 * W;
    const y1 = a.y1 * H;
    const x2 = a.x2 * W;
    const y2 = a.y2 * H;
    const sw = STROKE_WIDTHS[a.stroke];
    return (
      <g data-annotation={a.id}>
        <path
          d={roughArrow(x1, y1, x2, y2, a.seed)}
          fill="none"
          stroke={a.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d={roughArrow(x1, y1, x2, y2, a.seed + 19)}
          fill="none"
          stroke={a.color}
          strokeWidth={sw * 0.7}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.5}
        />
        {selected && <line className={styles.selOutline} x1={x1} y1={y1} x2={x2} y2={y2} />}
      </g>
    );
  }

  if (a.kind === "measure") {
    const s = measureShape(a, W, H);
    const sw = STROKE_WIDTHS[1];
    return (
      <g
        {...uiArea("editorImage.measure")}
        data-annotation={a.id}
        data-kind="measure"
        data-measure-length={a.to - a.from}
        data-selected={selected ? "true" : undefined}
      >
        {/* On-screen only: a white halo under the line keeps it readable on any image. The export
            draws its own measures (compositor), so it never sees this. */}
        <g
          data-measure-halo=""
          className={styles.measureHalo}
          strokeWidth={sw + 2}
          strokeLinecap="round"
        >
          <line x1={s.p1.x} y1={s.p1.y} x2={s.p2.x} y2={s.p2.y} />
          {s.ticks.map((t, i) => (
            <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />
          ))}
        </g>
        <g stroke={a.color} strokeWidth={sw} strokeLinecap="round">
          <line x1={s.p1.x} y1={s.p1.y} x2={s.p2.x} y2={s.p2.y} />
          {s.ticks.map((t, i) => (
            <line key={i} x1={t[0]} y1={t[1]} x2={t[2]} y2={t[3]} />
          ))}
        </g>
        <rect
          x={s.pill.x}
          y={s.pill.y}
          width={s.pill.w}
          height={s.pill.h}
          rx={s.pill.rx}
          fill={a.color}
          stroke={selected ? "var(--ie-ink-light)" : undefined}
          strokeWidth={selected ? 1 : undefined}
        />
        <text
          x={s.text.x}
          y={s.text.y}
          fill={measureTextColor(a.color)}
          fontFamily={MEASURE_FONT}
          fontSize={s.text.fontSize}
          fontWeight={600}
          textAnchor="middle"
          dominantBaseline="central"
          style={{ userSelect: "none" }}
        >
          {measureLabel(a)}
        </text>
      </g>
    );
  }

  if (a.kind === "path") {
    const sw = STROKE_WIDTHS[a.stroke];
    const d = smoothPath(a.points.map((pt) => ({ x: pt.x * W, y: pt.y * H })));
    return (
      <g data-annotation={a.id}>
        <path
          d={d}
          fill="none"
          stroke={a.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {selected && <path className={styles.selOutline} d={d} fill="none" />}
      </g>
    );
  }

  const tx = a.x * W;
  const ty = a.y * H;
  const fs = resolveFontPx(a.size, a.fontPx);
  // With a wrap width the label reflows by words to that width; otherwise it breaks
  // only on the user's own newlines (see textLines). Same source drives the box below.
  const widthPx = a.width ? a.width * W : undefined;
  const lines = textLines(a.text, fs, widthPx);
  const box = textBoxPx(a.text, fs, widthPx);
  return (
    <g data-annotation={a.id}>
      <text
        x={tx}
        y={ty}
        fill={a.color}
        fontFamily={HAND_FONT}
        fontSize={fs}
        fontWeight={600}
        dominantBaseline="hanging"
        style={{ userSelect: "none" }}
      >
        {lines.map((line, i) => (
          <tspan key={i} x={tx} dy={i === 0 ? 0 : fs * TEXT_LINE_HEIGHT}>
            {line}
          </tspan>
        ))}
      </text>
      {selected && (
        <rect
          className={styles.selOutline}
          x={tx - 4}
          y={ty - 4}
          width={box.w + 8}
          height={box.h + 8}
        />
      )}
    </g>
  );
});

const NO_BLURS: readonly BlurAnnotation[] = [];

/** The drop shadow of the base's `shadowCss`, as an SVG filter (CSS box-shadow cannot style
 *  an SVG element). Same constants as the export's `#sh` filter, so live and export agree:
 *  blur radius = 2 × stdDeviation, and the spread is dropped there too. */
function shadowFilter(value: number): { dy: number; std: number; alpha: string } {
  return {
    dy: Math.round(value * 0.45),
    std: Math.round(value * 0.9 + 8) / 2,
    alpha: (0.12 + (value / 100) * 0.5).toFixed(2),
  };
}

/**
 * An image added to the canvas (NIW2-703): its asset at its rect, with the beautify radius
 * as a rounded clip and the beautify shadow behind it, like the base shot. Nothing while
 * the editor has no URL for the asset. Unlocked blurs that touch it draw their own tile
 * from THIS image's pixels inside the clip, previewing what the save bakes into it.
 */
const ImageShape = React.memo(function ImageShape({
  a,
  size,
  selected,
  url,
  radius,
  shadow,
  redactions,
}: {
  a: ImageAnnotation;
  size: Size;
  selected: boolean;
  url: string | undefined;
  radius: number;
  shadow: number;
  redactions: readonly BlurAnnotation[];
}): React.JSX.Element | null {
  if (!url) return null;
  const x = a.x * size.w;
  const y = a.y * size.h;
  const w = a.w * size.w;
  const h = a.h * size.h;
  const clip = `iclip-${a.id}`;
  const sh = shadow > 0 ? shadowFilter(shadow) : null;
  return (
    <g data-annotation={a.id}>
      <defs>
        <clipPath id={clip}>
          <rect x={x} y={y} width={w} height={h} rx={radius} />
        </clipPath>
        {sh && (
          <filter id={`ishadow-${a.id}`} x="-50%" y="-50%" width="200%" height="200%">
            <feDropShadow
              dx={0}
              dy={sh.dy}
              stdDeviation={sh.std}
              floodColor="#000"
              floodOpacity={sh.alpha}
            />
          </filter>
        )}
      </defs>
      {sh && (
        <rect
          x={x}
          y={y}
          width={w}
          height={h}
          rx={radius}
          fill="#000"
          filter={`url(#ishadow-${a.id})`}
        />
      )}
      {/* The clip sits on a wrapper that carries no transform, so it resolves in the
          layer's own space. */}
      <g clipPath={`url(#${clip})`}>
        <image
          data-testid="canvas-image"
          href={url}
          x={x}
          y={y}
          width={w}
          height={h}
          preserveAspectRatio="none"
        />
        {redactions
          .filter((b) => b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y)
          .map((b) => (
            <ImageRedactionTile key={b.id} a={a} blur={b} url={url} size={size} />
          ))}
      </g>
      {/* The accent frame sits on the image's own edge (mock A4), a fixed 1.5 px on screen at
          any zoom; the layer's HTML chrome adds the white halo, handles and tag. */}
      {selected && (
        <rect
          className={`${styles.selOutline} ${styles.imageFrame}`}
          x={x}
          y={y}
          width={w}
          height={h}
        />
      )}
    </g>
  );
});

/** A blur's real redaction of one added image, in that image's local coordinates (the
 *  same mapping `bakeCanvasRedactions` uses), drawn over the image. */
function ImageRedactionTile({
  a,
  blur,
  url,
  size,
}: {
  a: ImageAnnotation;
  blur: BlurAnnotation;
  url: string;
  size: Size;
}): React.JSX.Element | null {
  const tile = useRedactionTile(
    url,
    {
      x: (blur.x - a.x) / a.w,
      y: (blur.y - a.y) / a.h,
      w: blur.w / a.w,
      h: blur.h / a.h,
    },
    blur.style ?? "blur",
    true,
  );
  if (!tile) return null;
  const w = a.w * size.w;
  const h = a.h * size.h;
  return (
    <image
      data-testid="image-redaction-tile"
      data-blur={blur.id}
      href={tile.url}
      x={a.x * size.w + (tile.rect.x / tile.naturalW) * w}
      y={a.y * size.h + (tile.rect.y / tile.naturalH) * h}
      width={(tile.rect.w / tile.naturalW) * w}
      height={(tile.rect.h / tile.naturalH) * h}
      preserveAspectRatio="none"
    />
  );
}

/**
 * Canvas mode: what a blur shows, at its z-position, of the added images BELOW it. The
 * export redraws those images' baked pixels over the blur's rect (see `bakedBlurSvg`), so
 * an annotation stacked between them and the blur is covered, while an image above the
 * blur still draws over it. Unlocked: each image's own redaction tile. Locked: the image's
 * pixels (its asset already holds the redaction), clipped to the rect.
 */
function BlurOverImagesBelow({
  blur,
  below,
  imageUrls,
  size,
}: {
  blur: BlurAnnotation;
  below: readonly Annotation[];
  imageUrls: Readonly<Record<string, string>> | undefined;
  size: Size;
}): React.JSX.Element | null {
  const hits = below.filter(
    (b): b is ImageAnnotation =>
      b.kind === "image" &&
      imageUrls?.[b.assetId] !== undefined &&
      blur.x < b.x + b.w &&
      blur.x + blur.w > b.x &&
      blur.y < b.y + b.h &&
      blur.y + blur.h > b.y,
  );
  if (hits.length === 0) return null;
  const clip = `under-clip-${blur.id}`;
  return (
    <g data-testid="redaction-over-images" data-blur={blur.id}>
      <clipPath id={clip}>
        <rect
          x={blur.x * size.w}
          y={blur.y * size.h}
          width={blur.w * size.w}
          height={blur.h * size.h}
        />
      </clipPath>
      <g clipPath={`url(#${clip})`}>
        {hits.map((b) => {
          const url = imageUrls![b.assetId]!;
          // Inside the image's own rounded clip (drawn by its ImageShape), as the export does.
          return (
            <g key={b.id} clipPath={`url(#iclip-${b.id})`}>
              {blur.locked ? (
                <image
                  href={url}
                  x={b.x * size.w}
                  y={b.y * size.h}
                  width={b.w * size.w}
                  height={b.h * size.h}
                  preserveAspectRatio="none"
                />
              ) : (
                <ImageRedactionTile a={b} blur={blur} url={url} size={size} />
              )}
            </g>
          );
        })}
      </g>
    </g>
  );
}

/**
 * Canvas-mode blur: the real redaction as a raster tile over the rect. A locked one is
 * already in the image, so it redraws the image's own pixels over the rect: in z-order it
 * still covers whatever annotation was drawn before it, as the export does.
 */
function RedactionTile({
  a,
  size,
  selected,
  src,
}: {
  a: Extract<Annotation, { kind: "blur" }>;
  size: Size;
  selected: boolean;
  src: string;
}): React.JSX.Element | null {
  const tile = useRedactionTile(src, a, a.style ?? "blur", !a.locked);
  const bx = a.x * size.w;
  const by = a.y * size.h;
  if (a.locked) {
    const clipId = `lock-clip-${a.id}`;
    return (
      <g data-testid="locked-redaction">
        <clipPath id={clipId}>
          <rect x={bx} y={by} width={a.w * size.w} height={a.h * size.h} />
        </clipPath>
        <image
          href={src}
          x={0}
          y={0}
          width={size.w}
          height={size.h}
          preserveAspectRatio="none"
          clipPath={`url(#${clipId})`}
        />
      </g>
    );
  }
  return (
    <g data-annotation={a.id}>
      {tile && (
        <image
          data-testid="redaction-tile"
          href={tile.url}
          x={(tile.rect.x / tile.naturalW) * size.w}
          y={(tile.rect.y / tile.naturalH) * size.h}
          width={(tile.rect.w / tile.naturalW) * size.w}
          height={(tile.rect.h / tile.naturalH) * size.h}
          preserveAspectRatio="none"
        />
      )}
      {selected && (
        <rect
          className={styles.selOutline}
          x={bx}
          y={by}
          width={a.w * size.w}
          height={a.h * size.h}
        />
      )}
    </g>
  );
}

/** True when the keyboard event originated in a text field (so the canvas shouldn't grab it). */
function isEditingText(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

function isBigEnough(a: Annotation): boolean {
  if (a.kind === "box" || a.kind === "blur") return a.w > 0.01 && a.h > 0.01;
  if (a.kind === "arrow") return Math.hypot(a.x2 - a.x1, a.y2 - a.y1) > 0.02;
  if (a.kind === "path") return a.points.length >= 1;
  if (a.kind === "measure") return a.to - a.from >= 1;
  return true; // text and step are placed by a click, never dragged out
}

function moveBy(a: Annotation, dx: number, dy: number): Partial<Annotation> {
  if (a.kind === "arrow") {
    return { x1: a.x1 + dx, y1: a.y1 + dy, x2: a.x2 + dx, y2: a.y2 + dy } as Partial<Annotation>;
  }
  if (a.kind === "path") {
    return {
      points: a.points.map((pt) => ({ x: pt.x + dx, y: pt.y + dy })),
    } as Partial<Annotation>;
  }
  if (a.kind === "measure") return moveMeasure(a, dx, dy);
  return { x: a.x + dx, y: a.y + dy } as Partial<Annotation>;
}

function hitTest(
  annotations: Annotation[],
  p: Pt,
  size: Size,
  canvasMode = false,
): Annotation | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const a = annotations[i];
    // A locked redaction is already part of the stored image: nothing to grab.
    if (canvasMode && a.kind === "blur" && a.locked) continue;
    if (a.kind === "box" || a.kind === "blur" || a.kind === "image") {
      if (
        p.x >= a.x - 0.01 &&
        p.x <= a.x + a.w + 0.01 &&
        p.y >= a.y - 0.01 &&
        p.y <= a.y + a.h + 0.01
      ) {
        return a;
      }
    } else if (a.kind === "text") {
      // The text renders in px (TEXT_PX[size]) but lives in normalized space, so the
      // hit box must derive from the font size AND the layer's pixel size — a fixed
      // normalized height broke on short/wide shots (the box was shorter than the
      // glyphs). Match the rendered bounds (see Shape) plus an 8px click margin.
      const fs = resolveFontPx(a.size, a.fontPx);
      const padX = 8 / (size.w || 1);
      const padY = 8 / (size.h || 1);
      const widthPx = a.width ? a.width * (size.w || 1) : undefined;
      const box = textBoxPx(a.text, fs, widthPx);
      const w = box.w / (size.w || 1);
      const h = box.h / (size.h || 1);
      if (
        p.x >= a.x - padX &&
        p.x <= a.x + w + padX &&
        p.y >= a.y - padY &&
        p.y <= a.y + h + padY
      ) {
        return a;
      }
    } else if (a.kind === "step") {
      const r = stepDiameterPx(a.size) / 2 + 4;
      if (Math.hypot((p.x - a.x) * (size.w || 1), (p.y - a.y) * (size.h || 1)) <= r) return a;
    } else if (a.kind === "path") {
      for (let j = 0; j < a.points.length - 1; j += 1) {
        if (distToSegment(p, a.points[j], a.points[j + 1]) < 0.02) return a;
      }
    } else if (a.kind === "measure") {
      const { p1, p2 } = measureEndpoints(a);
      if (distToSegment(p, p1, p2) < 0.02) return a;
      // The label pill sits off the line and is what the eye goes to: it grabs the measure too.
      const { pill } = measureShape(a, size.w, size.h);
      const px = p.x * size.w;
      const py = p.y * size.h;
      if (px >= pill.x && px <= pill.x + pill.w && py >= pill.y && py <= pill.y + pill.h) {
        return a;
      }
    } else if (distToSegment(p, { x: a.x1, y: a.y1 }, { x: a.x2, y: a.y2 }) < 0.02) {
      return a;
    }
  }
  return null;
}

/** The topmost saved redaction under `p`, for the hover tag: no margin, and never a selection. */
function hitLockedBlur(annotations: Annotation[], p: Pt): BlurAnnotation | null {
  for (let i = annotations.length - 1; i >= 0; i -= 1) {
    const a = annotations[i];
    if (a.kind !== "blur" || !a.locked) continue;
    if (p.x >= a.x && p.x <= a.x + a.w && p.y >= a.y && p.y <= a.y + a.h) return a;
  }
  return null;
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
