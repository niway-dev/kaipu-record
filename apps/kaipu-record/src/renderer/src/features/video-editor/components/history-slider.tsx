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
