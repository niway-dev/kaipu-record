import React, { useRef, type KeyboardEvent, type ReactNode, type Ref } from "react";
import { Circle, Lock, Square } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  CAMERA_BUBBLE_MAX_SIZE,
  CAMERA_BUBBLE_MIN_SIZE,
  CAMERA_BUBBLE_PRESETS,
  CAMERA_BUBBLE_PRESET_IDS,
  cameraBubblePresetFor,
  stepCameraBubbleSize,
  type CameraBubblePreset,
  type CameraBubbleSettings,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import type { CameraDevice } from "./use-camera-settings";
import styles from "./camera-settings-fields.module.css";

interface RadioOption<T extends string> {
  value: T;
  text: ReactNode;
  ariaLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface RadioChipsProps<T extends string> {
  label: string;
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  compact: boolean;
  groupRef?: Ref<HTMLDivElement>;
}

/**
 * A radiogroup of chips with a roving tab stop: Tab reaches the checked chip only,
 * ←/→ (and ↑/↓) move the selection, skipping disabled chips, wrapping at the ends.
 */
export function RadioChips<T extends string>({
  label,
  options,
  value,
  onChange,
  compact,
  groupRef,
}: RadioChipsProps<T>): React.JSX.Element {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = options.filter((option) => !option.disabled);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0 || enabled.length === 0) return;
    event.preventDefault();
    const current = enabled.findIndex((option) => option.value === value);
    const next = enabled[(current + delta + enabled.length) % enabled.length]!;
    onChange(next.value);
    buttons.current[options.indexOf(next)]?.focus();
  };

  return (
    <div
      ref={groupRef}
      role="radiogroup"
      aria-label={label}
      className={styles.chips}
      data-compact={compact || undefined}
      onKeyDown={onKeyDown}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            ref={(element) => {
              buttons.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={option.ariaLabel}
            aria-disabled={option.disabled || undefined}
            tabIndex={checked ? 0 : -1}
            className={styles.chip}
            onClick={option.disabled ? undefined : () => onChange(option.value)}
          >
            {option.icon}
            <span>{option.text}</span>
          </button>
        );
      })}
    </div>
  );
}

type SizeChoice = CameraBubblePreset | "custom";

export interface CameraSettingsFieldsProps {
  bubble: CameraBubbleSettings;
  onChange: (patch: Partial<CameraBubbleSettings>) => void;
  cameras: CameraDevice[];
  cameraOn: boolean;
  isRecording: boolean;
  /** The capture panel's drawer: 26 px chips, short labels. */
  compact?: boolean;
  /** The Shape group, which takes focus when the settings open. */
  shapeRef?: Ref<HTMLDivElement>;
}

/**
 * The camera settings themselves, shared by the Record page's popover and the capture
 * panel's drawer. DOM order is the Tab order the design asks for: Shape → Size chips →
 * slider → device selector (the device chip is drawn in the header, but comes last).
 */
export function CameraSettingsFields({
  bubble,
  onChange,
  cameras,
  cameraOn,
  isRecording,
  compact = false,
  shapeRef,
}: CameraSettingsFieldsProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const preset = cameraBubblePresetFor(bubble.size);
  const presetName = (id: CameraBubblePreset): string => t(`size${id}`);

  const shapes: RadioOption<CameraBubbleShape>[] = [
    { value: "circle", text: t("circle"), icon: <Circle size={12} aria-hidden /> },
    { value: "rounded", text: t("rounded"), icon: <Square size={12} aria-hidden /> },
  ];
  const sizes: RadioOption<SizeChoice>[] = [
    ...CAMERA_BUBBLE_PRESET_IDS.map((id) => ({
      value: id,
      text: id,
      ariaLabel: t("sizeChip", { name: presetName(id), size: CAMERA_BUBBLE_PRESETS[id] }),
    })),
    {
      value: "custom",
      // Not a preset: the chip shows the value. A preset: it reads "Custom" and is
      // not clickable (the slider is how a custom size is made).
      text: preset
        ? t("sizeCustom")
        : compact
          ? t("sizePx", { size: bubble.size })
          : t("sizeCustomValue", { size: bubble.size }),
      ariaLabel: preset
        ? t("sizeCustom")
        : t("sizeChip", { name: t("sizeCustom"), size: bubble.size }),
      disabled: preset !== null,
    },
  ];

  const valueText = preset
    ? t("sliderValue", { size: bubble.size, name: presetName(preset) })
    : t("sliderValue", { size: bubble.size, name: t("sizeCustom") });

  const onSliderKey = (event: KeyboardEvent<HTMLInputElement>): void => {
    const direction =
      event.key === "ArrowRight" || event.key === "ArrowUp"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowDown"
          ? -1
          : 0;
    if (direction === 0) return;
    event.preventDefault();
    onChange({ size: stepCameraBubbleSize(bubble.size, direction, event.shiftKey) });
  };

  const span = CAMERA_BUBBLE_MAX_SIZE - CAMERA_BUBBLE_MIN_SIZE;
  const note = !cameraOn ? t("offNote") : isRecording ? t("liveNote") : "";

  return (
    <div className={styles.fields} data-compact={compact || undefined}>
      <span className={styles.label} aria-hidden>
        {t("shape")}
      </span>
      <RadioChips
        label={t("shape")}
        options={shapes}
        value={bubble.shape}
        onChange={(shape) => onChange({ shape })}
        compact={compact}
        groupRef={shapeRef}
      />

      <span className={styles.label} aria-hidden>
        {t("size")}
      </span>
      <RadioChips
        label={t("size")}
        options={sizes}
        value={preset ?? "custom"}
        onChange={(choice) => {
          if (choice !== "custom") onChange({ size: CAMERA_BUBBLE_PRESETS[choice] });
        }}
        compact={compact}
      />

      <div className={styles.slider}>
        <input
          type="range"
          min={CAMERA_BUBBLE_MIN_SIZE}
          max={CAMERA_BUBBLE_MAX_SIZE}
          step={10}
          value={bubble.size}
          aria-label={t("slider")}
          aria-valuetext={valueText}
          onKeyDown={onSliderKey}
          onChange={(event) => onChange({ size: Number(event.currentTarget.value) })}
        />
        <div className={styles.ticks} aria-hidden>
          {CAMERA_BUBBLE_PRESET_IDS.map((id) => (
            <span
              key={id}
              className={styles.tick}
              data-current={preset === id || undefined}
              style={{
                left: `${((CAMERA_BUBBLE_PRESETS[id] - CAMERA_BUBBLE_MIN_SIZE) / span) * 100}%`,
              }}
            />
          ))}
        </div>
        {!compact && (
          <div className={styles.range} aria-hidden>
            <span>{t("sizePx", { size: CAMERA_BUBBLE_MIN_SIZE })}</span>
            <span>{t("sizePx", { size: CAMERA_BUBBLE_MAX_SIZE })}</span>
          </div>
        )}
      </div>

      {/* Present from the start and filled later, so it is announced once when it changes. */}
      <p
        className={styles.note}
        data-live={(cameraOn && isRecording) || undefined}
        role="status"
        aria-live="polite"
      >
        {note}
      </p>

      <select
        className={styles.device}
        aria-label={t("device")}
        value={bubble.deviceId ?? ""}
        onChange={(event) => onChange({ deviceId: event.currentTarget.value || null })}
      >
        <option value="">{t("deviceDefault")}</option>
        {cameras.map((camera, index) => (
          <option key={camera.deviceId} value={camera.deviceId}>
            {camera.label || t("deviceUnnamed", { index: index + 1 })}
          </option>
        ))}
        {/* A remembered camera that is unplugged right now still shows as chosen. */}
        {bubble.deviceId && !cameras.some((camera) => camera.deviceId === bubble.deviceId) && (
          <option value={bubble.deviceId}>
            {t("deviceUnnamed", { index: cameras.length + 1 })}
          </option>
        )}
      </select>
    </div>
  );
}

export interface CameraBlockedCardProps {
  onOpenSystemSettings: () => void;
  compact?: boolean;
  buttonRef?: Ref<HTMLButtonElement>;
}

/** In place of the settings while camera access is denied: why, and the way out. */
export function CameraBlockedCard({
  onOpenSystemSettings,
  compact = false,
  buttonRef,
}: CameraBlockedCardProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  return (
    <div className={styles.blocked} data-compact={compact || undefined}>
      <span className={styles.blockedIcon} aria-hidden>
        <Lock size={compact ? 16 : 20} />
      </span>
      <p className={styles.blockedTitle}>{t("blockedTitle")}</p>
      <p className={styles.blockedBody}>{t("blockedBody")}</p>
      <button
        ref={buttonRef}
        type="button"
        className={styles.blockedButton}
        onClick={onOpenSystemSettings}
      >
        {t("openSystemSettings")}
      </button>
    </div>
  );
}
