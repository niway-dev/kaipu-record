/**
 * Inspector for a selected floating image (ADR 0057, NIW2-771): its duration, the Full and Box
 * presets, Bring forward / Send backward, the fades and Delete. Every control is one action the
 * page turns into one commit (media-page-edits.ts); a number is committed when the field is left
 * or Enter is pressed, never on each keystroke, so typing "1.5" is one undo step, not two.
 */
import { ArrowDownToLine, ArrowUpToLine, Trash2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { MEDIA_MAX_FADE_MS, MEDIA_MIN_DURATION } from "../../media";
import type { ImageMediaItem } from "../../scene";
import styles from "./inspector.module.css";
import mediaStyles from "./media-inspector.module.css";

/**
 * A number committed on blur or Enter. Uncontrolled and keyed by the stored value, so the field
 * shows what the scene holds after an undo or a drag without an effect to sync it.
 */
function NumberField({
  label,
  value,
  min,
  max,
  step,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onCommit(value: number): void;
}): React.JSX.Element {
  const commit = (input: HTMLInputElement): void => {
    const typed = Number(input.value);
    if (input.value.trim() === "" || !Number.isFinite(typed)) {
      input.value = String(value);
      return;
    }
    const next = Math.min(max, Math.max(min, typed));
    if (next !== value) onCommit(next);
    // Back to what the scene holds now. When the commit changed it, `key={value}` remounts the
    // field with the new value; when it did not (a duration clamped to the end of the video, a
    // fade rounded back to the stored one, a commit refused mid-drag) this puts the old one back.
    input.value = String(value);
  };
  return (
    <label className={styles.field}>
      {label}
      <input
        key={value}
        className={styles.fieldInput}
        type="number"
        min={min}
        max={max}
        step={step}
        defaultValue={value}
        onBlur={(event) => commit(event.currentTarget)}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit(event.currentTarget);
        }}
      />
    </label>
  );
}

function MediaInspectorPanel({
  item,
  seconds,
  canBringForward,
  canSendBackward,
  onDuration,
  onFull,
  onBox,
  onBringForward,
  onSendBackward,
  onFades,
  onDelete,
}: {
  item: ImageMediaItem;
  /** How long the item is on the timeline now (its duration clamped to the end of the video). */
  seconds: number;
  /** False when `reorderMedia` has nothing to pass in that direction. */
  canBringForward: boolean;
  canSendBackward: boolean;
  onDuration(seconds: number): void;
  onFull(): void;
  onBox(): void;
  onBringForward(): void;
  onSendBackward(): void;
  onFades(fades: { fadeInMs?: number; fadeOutMs?: number }): void;
  onDelete(): void;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const rounded = Math.round(seconds * 100) / 100;
  return (
    <section
      {...uiArea("editorVideo.mediaPanel")}
      className={styles.panel}
      aria-label={t("mediaPanelTitle")}
    >
      <header className={styles.header}>
        <h2 className={styles.title}>{t("mediaPanelTitle")}</h2>
      </header>
      <NumberField
        label={t("mediaDuration")}
        value={rounded}
        min={MEDIA_MIN_DURATION}
        max={36000}
        step={0.1}
        onCommit={onDuration}
      />
      <div className={mediaStyles.pair}>
        <button type="button" className={mediaStyles.button} onClick={onFull}>
          {t("mediaFull")}
        </button>
        <button type="button" className={mediaStyles.button} onClick={onBox}>
          {t("mediaBox")}
        </button>
      </div>
      <div className={mediaStyles.pair}>
        <button
          type="button"
          className={mediaStyles.button}
          disabled={!canBringForward}
          onClick={onBringForward}
        >
          <ArrowUpToLine size={14} />
          {t("mediaBringForward")}
        </button>
        <button
          type="button"
          className={mediaStyles.button}
          disabled={!canSendBackward}
          onClick={onSendBackward}
        >
          <ArrowDownToLine size={14} />
          {t("mediaSendBackward")}
        </button>
      </div>
      <div className={mediaStyles.fades}>
        <NumberField
          label={t("mediaFadeIn")}
          value={item.fadeInMs}
          min={0}
          max={MEDIA_MAX_FADE_MS}
          step={50}
          onCommit={(fadeInMs) => onFades({ fadeInMs })}
        />
        <NumberField
          label={t("mediaFadeOut")}
          value={item.fadeOutMs}
          min={0}
          max={MEDIA_MAX_FADE_MS}
          step={50}
          onCommit={(fadeOutMs) => onFades({ fadeOutMs })}
        />
      </div>
      <button type="button" className={styles.dangerButton} onClick={onDelete}>
        <Trash2 size={14} />
        {t("mediaDelete")}
      </button>
    </section>
  );
}

/**
 * Keyed by the selected item: the number fields are uncontrolled, so another image with the same
 * duration or fades would otherwise keep text typed for the previous one, and leaving that field
 * would commit it to the new image.
 */
export function MediaInspector(
  props: React.ComponentProps<typeof MediaInspectorPanel>,
): React.JSX.Element {
  return <MediaInspectorPanel key={props.item.id} {...props} />;
}
