import React, { useId, useRef, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";

import styles from "./audio-settings-fields.module.css";

export interface LevelSliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  /** What the slider announces and shows on its right, e.g. "70%". */
  valueText: string;
  /** Left of the track. */
  icon: ReactNode;
  onChange: (value: number) => void;
}

const STEP = 5;
const BIG_STEP = 25;

/**
 * A level slider: speaker icon, track, value. `role="slider"` on the track, so a screen
 * reader reads the label and "70%"; ←/→ move by 5 (Shift by 25), Home/End jump to the ends,
 * and the track follows a pointer drag.
 */
export function LevelSlider({
  label,
  value,
  min,
  max,
  valueText,
  icon,
  onChange,
}: LevelSliderProps): React.JSX.Element {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const labelId = useId();
  const clamp = (next: number): number => Math.min(max, Math.max(min, Math.round(next)));
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? BIG_STEP : STEP;
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowUp") next = value + step;
    else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = value - step;
    else if (event.key === "Home") next = min;
    else if (event.key === "End") next = max;
    else return;
    event.preventDefault();
    onChange(clamp(next));
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return;
    onChange(clamp(min + ((event.clientX - rect.left) / rect.width) * (max - min)));
  };

  return (
    <div className={styles.sliderRow}>
      <span className={styles.sliderIcon} aria-hidden>
        {icon}
      </span>
      <span id={labelId} hidden>
        {label}
      </span>
      <div
        ref={trackRef}
        className={styles.track}
        role="slider"
        tabIndex={0}
        aria-labelledby={labelId}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={valueText}
        onKeyDown={onKeyDown}
        onPointerDown={(event) => {
          dragging.current = true;
          event.currentTarget.setPointerCapture?.(event.pointerId);
          fromPointer(event);
        }}
        onPointerMove={(event) => {
          if (dragging.current) fromPointer(event);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
        onPointerCancel={() => {
          dragging.current = false;
        }}
      >
        <span className={styles.fill} style={{ width: `${percent}%` }} />
        <span className={styles.thumb} style={{ left: `${percent}%` }} />
      </div>
      <span className={styles.sliderValue} aria-hidden>
        {valueText}
      </span>
    </div>
  );
}

export interface SwitchRowProps {
  title: string;
  /** The line under the title; replaced by `disabledReason` while disabled. */
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  disabledReason?: string;
}

/** A labelled on/off switch row. A disabled one says why, in place of its hint. */
export function SwitchRow({
  title,
  hint,
  checked,
  onChange,
  disabled = false,
  disabledReason,
}: SwitchRowProps): React.JSX.Element {
  const titleId = useId();
  const hintId = useId();
  return (
    <div className={styles.switchRow} data-disabled={disabled || undefined}>
      <div className={styles.switchText}>
        <span id={titleId} className={styles.switchTitle}>
          {title}
        </span>
        <span id={hintId} className={styles.switchHint}>
          {disabled && disabledReason ? disabledReason : hint}
        </span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={titleId}
        aria-describedby={hintId}
        aria-disabled={disabled || undefined}
        className={styles.switch}
        onClick={disabled ? undefined : () => onChange(!checked)}
      >
        <span className={styles.switchKnob} />
      </button>
    </div>
  );
}
