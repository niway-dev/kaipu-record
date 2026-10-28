import React, {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Circle, Lock, Square, ZoomIn } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  CAMERA_BUBBLE_MAX_SIZE,
  CAMERA_BUBBLE_MIN_SIZE,
  CAMERA_BUBBLE_PRESETS,
  CAMERA_BUBBLE_PRESET_IDS,
  CAMERA_FRAMING_MAX_ZOOM,
  CAMERA_FRAMING_MIN_ZOOM,
  DEFAULT_CAMERA_FRAMING,
  cameraBubblePresetFor,
  clampCameraPan,
  clampCameraZoom,
  stepCameraBubbleSize,
  type CameraFraming,
  type CameraBubblePreset,
  type CameraBubbleSettings,
  type CameraBubbleShape,
} from "@shared/camera-bubble";
import { LevelSlider, SwitchRow } from "@renderer/features/audio-settings/audio-settings-fields";
import type { CameraDevice } from "./use-camera-settings";
import styles from "./camera-settings-fields.module.css";

interface RadioOption<T extends string> {
  value: T;
  text: ReactNode;
  ariaLabel?: string;
  icon?: ReactNode;
  disabled?: boolean;
  /** Native tooltip, e.g. why the option is disabled. */
  title?: string;
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
            title={option.title}
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

/** Keyboard step of the position pad: 0.1 of the way to an edge, 0.25 with Shift. */
const PAD_STEP = 0.1;
const PAD_BIG_STEP = 0.25;

interface FramingControlsProps {
  framing: CameraFraming;
  onChange: (framing: CameraFraming) => void;
}

/** Zoom slider, position pad and Reset, shown while framing is on. */
function FramingControls({ framing, onChange }: FramingControlsProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const dragging = useRef(false);
  // Nothing to pan at 100 %: the image is exactly the bubble.
  const canPan = framing.zoom > CAMERA_FRAMING_MIN_ZOOM;

  const parts: string[] = [];
  const xPercent = Math.round(Math.abs(framing.x) * 100);
  const yPercent = Math.round(Math.abs(framing.y) * 100);
  if (xPercent > 0) {
    parts.push(
      framing.x < 0
        ? t("positionLeft", { percent: xPercent })
        : t("positionRight", { percent: xPercent }),
    );
  }
  if (yPercent > 0) {
    parts.push(
      framing.y < 0
        ? t("positionUp", { percent: yPercent })
        : t("positionDown", { percent: yPercent }),
    );
  }
  const valueText = parts.length
    ? parts
        .map((part, index) => (index === 0 ? part : part.charAt(0).toLowerCase() + part.slice(1)))
        .join(", ")
    : t("positionCentered");

  const move = (x: number, y: number): void =>
    onChange({ ...framing, x: clampCameraPan(x), y: clampCameraPan(y) });

  const onPadKey = (event: KeyboardEvent<HTMLDivElement>): void => {
    const step = event.shiftKey ? PAD_BIG_STEP : PAD_STEP;
    // Same directions as what you see: Right moves the view right, Up moves it up.
    if (event.key === "ArrowRight") move(framing.x + step, framing.y);
    else if (event.key === "ArrowLeft") move(framing.x - step, framing.y);
    else if (event.key === "ArrowDown") move(framing.x, framing.y + step);
    else if (event.key === "ArrowUp") move(framing.x, framing.y - step);
    else return;
    event.preventDefault();
  };

  const fromPointer = (event: PointerEvent<HTMLDivElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    move(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      ((event.clientY - rect.top) / rect.height) * 2 - 1,
    );
  };

  return (
    <div className={styles.framing}>
      <LevelSlider
        label={t("zoom")}
        icon={<ZoomIn size={14} aria-hidden />}
        value={Math.round(framing.zoom * 100)}
        min={CAMERA_FRAMING_MIN_ZOOM * 100}
        max={CAMERA_FRAMING_MAX_ZOOM * 100}
        valueText={t("zoomValue", { percent: Math.round(framing.zoom * 100) })}
        onChange={(percent) => onChange({ ...framing, zoom: clampCameraZoom(percent / 100) })}
      />
      <div className={styles.padRow}>
        <div
          className={styles.pad}
          role="slider"
          aria-label={t("position")}
          aria-valuemin={-100}
          aria-valuemax={100}
          aria-valuenow={Math.round(framing.x * 100)}
          aria-valuetext={valueText}
          aria-disabled={!canPan || undefined}
          data-disabled={!canPan || undefined}
          tabIndex={canPan ? 0 : -1}
          onKeyDown={canPan ? onPadKey : undefined}
          onPointerDown={(event) => {
            if (!canPan) return;
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
          <span
            className={styles.padDot}
            style={{
              left: `${(framing.x + 1) * 50}%`,
              top: `${(framing.y + 1) * 50}%`,
            }}
          />
        </div>
        <button
          type="button"
          className={styles.reset}
          onClick={() => onChange({ ...DEFAULT_CAMERA_FRAMING, enabled: framing.enabled })}
        >
          {t("reset")}
        </button>
      </div>
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
 * The camera settings themselves, shared by the Record page's drawer and the capture
 * panel's compact one. DOM order is the Tab order the design asks for: Shape → Size chips →
 * slider → device selector (the device chip is drawn in the header, but comes last). The
 * compact variant drops Size and keeps the switch hints for screen readers only, so the
 * panel stays short.
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
      text: preset ? t("sizeCustom") : t("sizeCustomValue", { size: bubble.size }),
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

      {/* The panel has no room for Size: there the bubble's own resize grip sizes it. The
          Record page keeps it, and it is the keyboard's way to size the bubble. */}
      {!compact && (
        <>
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
            <div className={styles.range} aria-hidden>
              <span>{t("sizePx", { size: CAMERA_BUBBLE_MIN_SIZE })}</span>
              <span>{t("sizePx", { size: CAMERA_BUBBLE_MAX_SIZE })}</span>
            </div>
          </div>
        </>
      )}

      <div className={styles.mirror}>
        <SwitchRow
          title={t("mirrorTitle")}
          hint={t("mirrorHint")}
          hintHidden={compact}
          checked={bubble.mirrored}
          onChange={(mirrored) => onChange({ mirrored })}
        />
      </div>

      <div className={styles.mirror}>
        <SwitchRow
          title={t("framingTitle")}
          hint={t("framingHint")}
          hintHidden={compact}
          checked={bubble.framing.enabled}
          onChange={(enabled) => onChange({ framing: { ...bubble.framing, enabled } })}
        />
      </div>
      {bubble.framing.enabled && (
        <FramingControls framing={bubble.framing} onChange={(framing) => onChange({ framing })} />
      )}

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
