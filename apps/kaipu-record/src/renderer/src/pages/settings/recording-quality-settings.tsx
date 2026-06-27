import React from "react";
import { Info } from "lucide-react";
import { Popover } from "@renderer/ui/popover";
import {
  activePreset,
  BITRATE_STEP_LABELS,
  BITRATE_STEPS,
  FPS_STEP_LABELS,
  FPS_STEPS,
  FPS_VALUE_LABELS,
  mbPerMinute,
  PRESET_META,
  PRESET_ORDER,
  QUALITY_INFO,
  QUALITY_PRESETS,
  RESOLUTION_DIMENSIONS,
  RESOLUTION_STEP_LABELS,
  RESOLUTION_STEPS,
  type RecordingQuality,
} from "@shared/recording-quality";
import styles from "./recording-quality-settings.module.css";

export interface RecordingQualitySettingsProps {
  quality: RecordingQuality;
  onChange(quality: RecordingQuality): void;
}

/**
 * The "Recording quality" control: friendly preset chips + three discrete
 * sliders (Resolución / Fluidez / Bitrate). The active chip is *derived* from
 * the values — moving any slider lands on "Personalizado" automatically. Copy is
 * neutral Spanish, benefit-first; each slider has an ⓘ deep-dive for the curious.
 */
export function RecordingQualitySettings({
  quality,
  onChange,
}: RecordingQualitySettingsProps): React.JSX.Element {
  const active = activePreset(quality);
  const { width, height } = RESOLUTION_DIMENSIONS[quality.resolution];

  return (
    <div className={styles.quality}>
      <div className={styles.chips} role="group" aria-label="Calidad de grabación">
        {PRESET_ORDER.map((id) => {
          const meta = PRESET_META[id];
          const isCustom = id === "custom";
          return (
            <button
              key={id}
              type="button"
              className={styles.chip}
              data-active={active === id}
              // "Personalizado" is a status indicator: it only lights up when the
              // values match no preset. Clicking a preset applies its full combo.
              disabled={isCustom}
              onClick={isCustom ? undefined : () => onChange(QUALITY_PRESETS[id])}
            >
              <span aria-hidden="true">{meta.emoji}</span> {meta.label}
            </button>
          );
        })}
      </div>

      <p className={styles.caption}>{PRESET_META[active].caption}</p>

      <QualitySlider
        label="Resolución"
        info={QUALITY_INFO.resolution}
        steps={RESOLUTION_STEPS}
        stepLabel={(step) => RESOLUTION_STEP_LABELS[step]}
        value={quality.resolution}
        valueLabel={`${width}×${height}`}
        onChange={(resolution) => onChange({ ...quality, resolution })}
      />
      <QualitySlider
        label="Fluidez"
        info={QUALITY_INFO.fps}
        steps={FPS_STEPS}
        stepLabel={(step) => FPS_STEP_LABELS[step]}
        value={quality.fps}
        valueLabel={FPS_VALUE_LABELS[quality.fps]}
        onChange={(fps) => onChange({ ...quality, fps })}
      />
      <QualitySlider
        label="Bitrate"
        info={QUALITY_INFO.bitrate}
        steps={BITRATE_STEPS}
        stepLabel={(step) => BITRATE_STEP_LABELS[step]}
        value={quality.bitrate}
        valueLabel={`≈${mbPerMinute(quality.bitrate)} MB/min`}
        onChange={(bitrate) => onChange({ ...quality, bitrate })}
      />
    </div>
  );
}

interface QualitySliderProps<T extends string | number> {
  label: string;
  info: string;
  steps: readonly T[];
  stepLabel(step: T): string;
  value: T;
  valueLabel: string;
  onChange(step: T): void;
}

/** A discrete N-step slider: clickable dots, a filled track, and tick labels. */
function QualitySlider<T extends string | number>({
  label,
  info,
  steps,
  stepLabel,
  value,
  valueLabel,
  onChange,
}: QualitySliderProps<T>): React.JSX.Element {
  const index = steps.indexOf(value);
  const pctFor = (i: number): number => (steps.length > 1 ? (i / (steps.length - 1)) * 100 : 0);

  return (
    <div className={styles.slider}>
      <div className={styles.sliderHeader}>
        <span className={styles.sliderLabel}>{label}</span>
        <Popover
          trigger={
            <span className={styles.infoIcon} role="img" aria-label={`Qué es ${label}`}>
              <Info size={14} />
            </span>
          }
        >
          <p className={styles.info}>{info}</p>
        </Popover>
        <span className={styles.sliderValue}>{valueLabel}</span>
      </div>

      <div className={styles.track}>
        <div className={styles.trackFill} style={{ width: `${pctFor(index)}%` }} />
        {steps.map((step, i) => (
          <button
            key={String(step)}
            type="button"
            className={styles.dot}
            data-active={i <= index}
            data-current={i === index}
            style={{ left: `${pctFor(i)}%` }}
            aria-label={`${label} ${stepLabel(step)}`}
            aria-pressed={i === index}
            onClick={() => onChange(step)}
          />
        ))}
      </div>

      <div className={styles.ticks}>
        {steps.map((step, i) => (
          <span
            key={String(step)}
            className={styles.tick}
            data-active={i === index}
            style={{ left: `${pctFor(i)}%` }}
          >
            {stepLabel(step)}
          </span>
        ))}
      </div>
    </div>
  );
}
