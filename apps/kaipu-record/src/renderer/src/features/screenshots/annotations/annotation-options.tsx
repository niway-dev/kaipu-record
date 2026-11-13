import React from "react";
import { Droplet, Info, Lock, Square, Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { isWindowsHost } from "@renderer/features/shortcuts/host-platform";
import { ANNOTATION_COLORS, STROKE_WIDTHS, TEXT_SIZES } from "./tools";
import type { Annotation, RedactionStyle } from "./scene";
import type { EditorScene } from "./use-editor-scene";
import type { AnnotationToolsController } from "./use-annotation-tools";
import type { TextToolStatus } from "../text-selection";
import styles from "./annotation-options.module.css";

/**
 * Normalized contextual controls, so one panel drives two cases: editing the
 * *selected* annotation, or setting the *next-draw* defaults on the active tool.
 */
interface ContextualControls {
  /** "size" for text, "stroke" for box/arrow. */
  mode: "stroke" | "size" | "color";
  color: string;
  setColor(color: string): void;
  /** Index into STROKE_WIDTHS or TEXT_SIZES. */
  level: number;
  setLevel(level: number): void;
  /** True while a corner drag is in force, so no preset matches. */
  custom?: boolean;
}

function resolveControls(
  tools: AnnotationToolsController,
  scene: EditorScene,
  selected: Annotation | null,
): ContextualControls | null {
  // A selected annotation → edit it (single undoable change per click). A blur box
  // has no colour/stroke, so there's nothing to edit. Picking a value also updates
  // the *current* tool default, so the choice "sticks" for the next annotation too
  // (change colour on a selection → keep drawing in that colour, across tools).
  if (selected) {
    // An added image has no colour or stroke either.
    if (selected.kind === "blur" || selected.kind === "image") return null;
    if (selected.kind === "measure") {
      // Colour only: a measure has one fixed stroke and its label is not text you size.
      return {
        mode: "color",
        color: selected.color,
        setColor: (color) => {
          scene.commitAnnotation(selected.id, { color });
          tools.setColor(color);
        },
        level: -1,
        setLevel: () => {},
      };
    }
    if (selected.kind === "step") {
      return {
        mode: "size",
        color: selected.color,
        setColor: (color) => {
          scene.commitAnnotation(selected.id, { color });
          tools.setColor(color);
        },
        level: selected.size,
        setLevel: (size) => {
          scene.commitAnnotation(selected.id, { size });
          tools.setStepSize(size);
        },
      };
    }
    return selected.kind === "text"
      ? {
          mode: "size",
          color: selected.color,
          setColor: (color) => {
            scene.commitAnnotation(selected.id, { color });
            tools.setColor(color);
          },
          // -1 highlights no preset: a label sized by dragging a corner is not any of
          // them, and lighting one up would claim a size the text does not have.
          level: selected.fontPx === undefined ? selected.size : -1,
          custom: selected.fontPx !== undefined,
          setLevel: (size) => {
            // Clearing `fontPx` is the point, not tidy-up: it wins over the preset, so
            // writing only `size` lit the control while the label stayed put.
            scene.commitAnnotation(selected.id, { size, fontPx: undefined });
            tools.setTextSize(size);
          },
        }
      : {
          mode: "stroke",
          color: selected.color,
          setColor: (color) => {
            scene.commitAnnotation(selected.id, { color });
            tools.setColor(color);
          },
          level: selected.stroke,
          setLevel: (stroke) => {
            scene.commitAnnotation(selected.id, { stroke });
            tools.setStroke(stroke);
          },
        };
  }
  // Nothing selected + select/blur/crop tool → nothing to set for colour/stroke.
  if (
    tools.tool === "select" ||
    tools.tool === "blur" ||
    tools.tool === "crop" ||
    tools.tool === "selectText"
  ) {
    return null;
  }
  // A drawing tool is active → set the defaults for the next shape.
  if (tools.tool === "step") {
    return {
      mode: "size",
      color: tools.color,
      setColor: tools.setColor,
      level: tools.stepSize,
      setLevel: tools.setStepSize,
    };
  }
  return tools.tool === "text"
    ? {
        mode: "size",
        color: tools.color,
        setColor: tools.setColor,
        level: tools.textSize,
        setLevel: tools.setTextSize,
      }
    : {
        mode: "stroke",
        color: tools.color,
        setColor: tools.setColor,
        level: tools.stroke,
        setLevel: tools.setStroke,
      };
}

/**
 * What the options panel shows for the current tool and selection. One model feeds both the
 * panel and `annotationOptionsState`, so "is there anything to show" has a single answer.
 */
function optionsModel(
  tools: AnnotationToolsController,
  scene: EditorScene,
  canvasMode: boolean,
  textTool: TextToolStatus | undefined,
) {
  const selected = scene.annotations.find((a) => a.id === scene.selectedId) ?? null;
  const controls = resolveControls(tools, scene, selected);
  // Canvas mode: the crop tool edits the export frame and has its own card (mock A5), so the
  // classic "Crop / Reset" row is not shown there.
  const isCrop = tools.tool === "crop" && !canvasMode;
  // Canvas mode: the style control shows for the blur tool or a selected blur, and edits
  // that blur (one undoable change) or the style the next redaction takes.
  const styleTarget = selected?.kind === "blur" ? selected : null;
  // A saved redaction's pixels are baked into the stored image: its style cannot change and it
  // cannot be deleted, so its card says so instead (mock H4).
  const lockedTarget = canvasMode && styleTarget?.locked === true;
  const showRedactionStyle =
    canvasMode && !lockedTarget && (styleTarget !== null || tools.tool === "blur");
  const showText = textTool !== undefined && tools.tool === "selectText";
  // A selected blur has no colour/stroke controls, but should still be deletable —
  // so the panel shows whenever there are controls OR something is selected OR crop is active.
  const shown = Boolean(controls || selected || isCrop || showRedactionStyle || showText);
  return {
    selected,
    controls,
    isCrop,
    styleTarget,
    lockedTarget,
    showRedactionStyle,
    showText,
    shown,
  };
}

/** What kind of options the panel shows, for the side panel's `data-state`; null when none. */
export type AnnotationOptionsState =
  | "stroke"
  | "size"
  | "stepSelected"
  | "redact"
  | "crop"
  | "selectText"
  | "selection";

export function annotationOptionsState(
  tools: AnnotationToolsController,
  scene: EditorScene,
  canvasMode: boolean,
  textTool?: TextToolStatus,
): AnnotationOptionsState | null {
  const m = optionsModel(tools, scene, canvasMode, textTool);
  if (!m.shown) return null;
  if (m.showRedactionStyle || m.lockedTarget) return "redact";
  if (m.selected?.kind === "step") return "stepSelected";
  if (m.showText) return "selectText";
  if (m.isCrop) return "crop";
  if (m.controls) return m.controls.mode === "size" ? "size" : "stroke";
  return "selection";
}

/**
 * The active tool's options, or the selected annotation's, in the editor's side panel (Tool
 * tab). Renders `null` when there's nothing to edit (select tool, no selection): the panel
 * then shows its own empty state.
 */
export function AnnotationOptions({
  tools,
  scene,
  canvasMode = false,
  textTool,
}: {
  tools: AnnotationToolsController;
  scene: EditorScene;
  /** Redaction mode (`image-canvas`): shows the Blur / Solid style control. */
  canvasMode?: boolean;
  /** The "Select text" tool's recognition status and actions (`image-text`); absent = flag off. */
  textTool?: TextToolStatus;
}): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const m = optionsModel(tools, scene, canvasMode, textTool);
  const { selected, controls, isCrop, lockedTarget, showRedactionStyle, showText, styleTarget } = m;
  if (!m.shown) return null;
  const redactionStyle = styleTarget ? (styleTarget.style ?? "blur") : tools.redactionStyle;
  const pickRedactionStyle = (style: RedactionStyle): void => {
    if (styleTarget) scene.commitAnnotation(styleTarget.id, { style });
    tools.setRedactionStyle(style);
  };

  return (
    <div className={styles.panel}>
      {isCrop && (
        <>
          <span className={styles.label}>{t("cropLabel")}</span>
          <div className={styles.cropActions}>
            <button
              type="button"
              title={t("cropResetTitle")}
              className={styles.reset}
              disabled={!scene.crop}
              onClick={() => scene.setCrop(undefined)}
            >
              {t("reset")}
            </button>
            <button
              type="button"
              title={t("cropDoneTitle")}
              className={styles.done}
              onClick={() => tools.setTool("select")}
            >
              {t("cropDone")}
            </button>
          </div>
        </>
      )}

      {showText && textTool && <TextToolPanel text={textTool} />}

      {controls && (
        <>
          <span className={styles.label}>{t("colorLabel")}</span>
          <div className={styles.palette}>
            {ANNOTATION_COLORS.map((c) => (
              <button
                key={c.value}
                type="button"
                title={t(c.nameKey)}
                aria-label={t(c.nameKey)}
                className={`${styles.swatch} ${controls.color === c.value ? styles.swatchOn : ""}`}
                style={{ background: c.value }}
                onClick={() => controls.setColor(c.value)}
              />
            ))}
          </div>

          {controls.mode === "color" ? null : controls.mode === "size" ? (
            <>
              <span className={styles.label}>{t("sizeLabel")}</span>
              <div className={styles.picker}>
                {TEXT_SIZES.map((label, i) => (
                  <button
                    key={label}
                    type="button"
                    aria-label={t("sizeAria", { label })}
                    className={`${styles.pickerItem} ${styles.sizeItem} ${controls.level === i ? styles.pickerOn : ""}`}
                    onClick={() => controls.setLevel(i)}
                  >
                    {label}
                  </button>
                ))}
                {/* Only while a corner drag is in force; a permanent chip nobody can
                    press would be a dead control. */}
                {controls.custom ? (
                  <button
                    type="button"
                    aria-label={t("sizeCustomAria")}
                    className={`${styles.pickerItem} ${styles.sizeItem} ${styles.pickerOn}`}
                    disabled
                  >
                    {t("sizeCustom")}
                  </button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <span className={styles.label}>{t("strokeLabel")}</span>
              <div className={styles.picker}>
                {STROKE_WIDTHS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={t("strokeAria", { n: i + 1 })}
                    className={`${styles.pickerItem} ${controls.level === i ? styles.pickerOn : ""}`}
                    onClick={() => controls.setLevel(i)}
                  >
                    <span
                      className={styles.strokeBar}
                      style={{ height: `${(i + 1) * 1.6 + 1}px` }}
                    />
                  </button>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {showRedactionStyle && (
        <div className={styles.redaction} {...uiArea("editorImage.redactionStyle")}>
          <span className={styles.label}>{t("redactionStyleLabel")}</span>
          <div className={styles.styleRow}>
            {(["blur", "solid"] as const).map((style) => {
              const Icon = style === "blur" ? Droplet : Square;
              return (
                <button
                  key={style}
                  type="button"
                  aria-pressed={redactionStyle === style}
                  className={`${styles.styleButton} ${redactionStyle === style ? styles.styleButtonOn : ""}`}
                  onClick={() => pickRedactionStyle(style)}
                >
                  <Icon
                    size={13}
                    aria-hidden
                    {...(style === "solid" ? { fill: "currentColor" } : {})}
                  />
                  {t(style === "blur" ? "redactionBlur" : "redactionSolid")}
                </button>
              );
            })}
          </div>
          <div className={styles.noteRow}>
            <Info size={13} className={styles.noteIcon} aria-hidden />
            <p className={styles.note}>{t("redactionNote")}</p>
          </div>
          {textTool && tools.tool === "blur" && <TextHideHint text={textTool} />}
        </div>
      )}

      {lockedTarget && (
        <div className={styles.redaction}>
          <div className={styles.noteRow} data-testid="redaction-locked-note">
            <Lock size={13} className={styles.noteIcon} aria-hidden />
            <p className={styles.note}>{t("redactionLockedNote")}</p>
          </div>
        </div>
      )}

      {selected?.kind === "step" && (
        <button
          type="button"
          title={t(isWindowsHost() ? "deleteTitleWindows" : "deleteTitle")}
          className={styles.deleteLine}
          onClick={() => scene.removeSelected()}
        >
          <Trash2 size={13} />
          {t("stepDeleteRenumbers")}
        </button>
      )}

      {selected && selected.kind !== "step" && !lockedTarget && (
        <button
          type="button"
          aria-label={t("deleteAria")}
          title={t(isWindowsHost() ? "deleteTitleWindows" : "deleteTitle")}
          className={styles.delete}
          onClick={() => scene.removeSelected()}
        >
          <Trash2 size={16} />
        </button>
      )}
    </div>
  );
}

/**
 * The redact tool's line about recognized text (NIW2-706): while recognition runs, and once
 * there are lines to click. With no text (none found, or recognition unavailable) it says
 * nothing: dragging a region works as it always did.
 */
function TextHideHint({ text }: { text: TextToolStatus }): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const state =
    text.status === "pending"
      ? "pending"
      : text.status === "ready" && text.wordCount > 0
        ? "ready"
        : null;
  if (!state) return null;
  return (
    <p
      className={styles.note}
      {...uiArea("editorImage.textHideHint")}
      data-state={state}
      role="status"
    >
      {t(state === "pending" ? "textHidePending" : "textHideReady")}
    </p>
  );
}

/** Recognition status, and Select all / Copy text once there is text to act on. */
function TextToolPanel({ text }: { text: TextToolStatus }): React.JSX.Element {
  const t = useTranslations("screenshots");
  const state = text.status === "ready" ? (text.wordCount > 0 ? "ready" : "noText") : text.status;
  const message =
    state === "pending"
      ? t("textRecognizing")
      : state === "unavailable"
        ? t("textUnavailable")
        : state === "noText"
          ? t("textNone")
          : t("textWordCount", { count: text.wordCount });
  return (
    <div
      className={styles.textTool}
      {...uiArea("editorImage.textStatus")}
      data-state={state}
      role="status"
    >
      <span className={styles.label}>{message}</span>
      {state === "ready" && (
        <div className={styles.textActions}>
          <button type="button" className={styles.reset} onClick={text.onSelectAll}>
            {t("textSelectAll")}
          </button>
          <button
            type="button"
            className={styles.reset}
            disabled={text.selectedCount === 0}
            onClick={text.onCopy}
          >
            {t("textCopy")}
          </button>
        </div>
      )}
    </div>
  );
}
