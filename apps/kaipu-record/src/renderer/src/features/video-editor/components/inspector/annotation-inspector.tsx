/**
 * Inspector panels for the annotation tools (box/arrow/text overlays), moving the
 * controls that used to live in the floating `OverlayOptions` (UI spec § 7.4) into the
 * properties column, alongside ZoomInspector / BlurInspector / CoverInspector.
 *
 * Two panels, same contextual-controls source (`resolveControls` from
 * overlay-options.tsx, exported for exactly this reuse):
 * - `AnnotationInspector` edits a *selected* overlay.
 * - `AnnotationDefaultsPanel` sets the *next-draw* defaults for the active tool when
 *   nothing is selected.
 *
 * The color palette and stroke/size pickers reuse overlay-options.module.css rather
 * than duplicating those styles here — the two panels render the exact same controls,
 * just wrapped in the inspector column's `.panel` chrome instead of a floating popover.
 */
import { Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { Translator } from "@kaipu/i18n";
import {
  ANNOTATION_COLORS,
  STROKE_WIDTHS,
  TEXT_SIZES,
} from "@renderer/features/screenshots/annotations";
import type { VideoOverlay } from "../../scene";
import type { VideoToolsController } from "../../annotations/video-tools";
import { type ContextualControls, resolveControls } from "../overlay-options";
import { formatPrecise } from "./format";
import overlayStyles from "../overlay-options.module.css";
import styles from "./inspector.module.css";

/** Maps an annotation kind to its existing toolbar label key. */
const KIND_TITLE_KEY = {
  box: "toolBox",
  arrow: "toolArrow",
  text: "toolText",
} as const satisfies Record<VideoOverlay["kind"], string>;

/** The color palette + stroke-or-size picker shared by both panels below. */
function ContextualControlsBody({
  controls,
  t,
  tc,
}: {
  controls: ContextualControls;
  t: Translator<"videoEditor">;
  tc: Translator<"screenshots">;
}): React.JSX.Element {
  return (
    <>
      <span className={overlayStyles.label}>{t("colorLabel")}</span>
      <div className={overlayStyles.palette}>
        {ANNOTATION_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            title={tc(c.nameKey)}
            aria-label={tc(c.nameKey)}
            className={`${overlayStyles.swatch} ${controls.color === c.value ? overlayStyles.swatchOn : ""}`}
            style={{ background: c.value }}
            onClick={() => controls.setColor(c.value)}
          />
        ))}
      </div>

      {controls.mode === "size" ? (
        <>
          <span className={overlayStyles.label}>{t("sizeLabel")}</span>
          <div className={overlayStyles.picker}>
            {TEXT_SIZES.map((label, i) => (
              <button
                key={label}
                type="button"
                aria-label={t("sizeAria", { label })}
                className={`${overlayStyles.pickerItem} ${overlayStyles.sizeItem} ${controls.level === i ? overlayStyles.pickerOn : ""}`}
                onClick={() => controls.setLevel(i)}
              >
                {label}
              </button>
            ))}
            {/* Only while a corner drag is in force. A permanent chip you cannot press
                would be a dead control; this one appears exactly when it is true. */}
            {controls.custom ? (
              <button
                type="button"
                aria-label={t("sizeCustomAria")}
                className={`${overlayStyles.pickerItem} ${overlayStyles.sizeItem} ${overlayStyles.pickerOn}`}
                disabled
              >
                {t("sizeCustom")}
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <span className={overlayStyles.label}>{t("strokeLabel")}</span>
          <div className={overlayStyles.picker}>
            {STROKE_WIDTHS.map((_, i) => (
              <button
                key={i}
                type="button"
                aria-label={t("strokeAria", { n: i + 1 })}
                className={`${overlayStyles.pickerItem} ${controls.level === i ? overlayStyles.pickerOn : ""}`}
                onClick={() => controls.setLevel(i)}
              >
                <span
                  className={overlayStyles.strokeBar}
                  style={{ height: `${(i + 1) * 1.6 + 1}px` }}
                />
              </button>
            ))}
          </div>
        </>
      )}
    </>
  );
}

export function AnnotationInspector({
  overlay,
  tools,
  range,
  onCommitOverlay,
  onRemove,
  onRemoved,
}: {
  overlay: VideoOverlay;
  tools: VideoToolsController;
  /** Timeline range of the overlay's visible window, or null if it maps to none right
   *  now (e.g. its whole window falls inside a deleted cut). */
  range: { start: number; end: number } | null;
  /** One undoable commit for the selected overlay — also updates the tool default
   *  (see resolveControls), so the choice sticks for the next overlay too. */
  onCommitOverlay(id: string, patch: Partial<VideoOverlay>): void;
  onRemove(id: string): void;
  onRemoved(): void;
}): React.JSX.Element | null {
  const t = useTranslations("videoEditor");
  const tc = useTranslations("screenshots");
  const controls = resolveControls(tools, [overlay], overlay.id, onCommitOverlay);
  if (!controls) return null;
  const titleKey = KIND_TITLE_KEY[overlay.kind];

  return (
    <section className={styles.panel} aria-label={t(titleKey)}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t(titleKey)}</h2>
      </header>
      {range && (
        <p className={styles.range}>
          {formatPrecise(range.start)} → {formatPrecise(range.end)}
        </p>
      )}
      <ContextualControlsBody controls={controls} t={t} tc={tc} />
      <button
        type="button"
        className={styles.dangerButton}
        onClick={() => {
          onRemove(overlay.id);
          onRemoved();
        }}
      >
        <Trash2 size={14} />
        {t("removeAnnotation")}
      </button>
    </section>
  );
}

export function AnnotationDefaultsPanel({
  tools,
}: {
  tools: VideoToolsController;
}): React.JSX.Element | null {
  const t = useTranslations("videoEditor");
  const tc = useTranslations("screenshots");
  // Only box/arrow/text drive next-draw defaults — "select" (and the privacy tools)
  // have nothing here; the page shows the Detection panel or Selection hint instead.
  if (tools.tool !== "box" && tools.tool !== "arrow" && tools.tool !== "text") return null;
  const controls = resolveControls(tools, [], null, () => {});
  if (!controls) return null;

  return (
    <section className={styles.panel} aria-label={t("annotationDefaultsTitle")}>
      <header className={styles.header}>
        <h2 className={styles.title}>{t("annotationDefaultsTitle")}</h2>
      </header>
      <p className={styles.hint}>{t("annotationDefaultsHint")}</p>
      <ContextualControlsBody controls={controls} t={t} tc={tc} />
    </section>
  );
}
