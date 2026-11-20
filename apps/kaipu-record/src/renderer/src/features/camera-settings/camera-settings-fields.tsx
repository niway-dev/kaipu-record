import React, { useRef, type KeyboardEvent, type PointerEvent } from "react";
import { Lock, ZoomIn } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  CAMERA_FRAMING_MAX_ZOOM,
  CAMERA_FRAMING_MIN_ZOOM,
  DEFAULT_CAMERA_FRAMING,
  clampCameraPan,
  clampCameraZoom,
  type CameraFraming,
  type CameraBubbleSettings,
} from "@shared/camera-bubble";
import { LevelSlider, SwitchRow } from "@renderer/features/audio-settings/audio-settings-fields";
import type { CameraDevice } from "./use-camera-settings";
import styles from "./camera-settings-fields.module.css";

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

/** More cameras than this scroll inside their own list, never the popover as a whole. */
const MAX_VISIBLE_SOURCES = 5;

export interface CameraSettingsFieldsProps {
  bubble: CameraBubbleSettings;
  onChange: (patch: Partial<CameraBubbleSettings>) => void;
  cameras: CameraDevice[];
  cameraOn: boolean;
  isRecording: boolean;
}

/**
 * The camera popover's content, shared by the Capture page and the capture widget: the
 * camera list, Mirror my video, Framing, and a line that says the camera records as its own
 * video (so its shape and size are an editor decision, not a setup one). DOM order is the Tab
 * order: cameras, Mirror, Framing. The stored shape, size and corner radius are not edited here;
 * the bubble keeps using the saved values.
 */
export function CameraSettingsFields({
  bubble,
  onChange,
  cameras,
  cameraOn,
  isRecording,
}: CameraSettingsFieldsProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const note = !cameraOn ? t("offNote") : isRecording ? t("liveNote") : "";

  return (
    <div className={styles.fields}>
      <CameraSourceList
        cameras={cameras}
        deviceId={bubble.deviceId}
        onChange={(deviceId) => onChange({ deviceId })}
      />

      <div className={styles.mirror}>
        <SwitchRow
          title={t("mirrorTitle")}
          hint={t("mirrorHint")}
          hintHidden
          checked={bubble.mirrored}
          onChange={(mirrored) => onChange({ mirrored })}
        />
      </div>

      <div className={styles.mirror}>
        <SwitchRow
          title={t("framingTitle")}
          hint={t("framingHint")}
          hintHidden
          checked={bubble.framing.enabled}
          onChange={(enabled) => onChange({ framing: { ...bubble.framing, enabled } })}
        />
      </div>
      {bubble.framing.enabled && (
        <FramingControls framing={bubble.framing} onChange={(framing) => onChange({ framing })} />
      )}

      <p className={styles.help}>{t("cameraHelp")}</p>

      {/* Present from the start and filled later, so it is announced once when it changes. */}
      <p
        className={styles.note}
        data-live={(cameraOn && isRecording) || undefined}
        role="status"
        aria-live="polite"
      >
        {note}
      </p>
    </div>
  );
}

interface CameraSourceListProps {
  cameras: CameraDevice[];
  /** The chosen camera, or `null` for the default one. */
  deviceId: string | null;
  onChange: (deviceId: string | null) => void;
}

/**
 * The cameras as a radio list, the default camera first: what the dropdown offered, all
 * visible at once. ↑/↓ (and ←/→) move the selection with one tab stop, like the microphone list.
 */
function CameraSourceList({
  cameras,
  deviceId,
  onChange,
}: CameraSourceListProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  const entries: { value: string | null; text: string; missing?: boolean }[] = [
    { value: null, text: t("deviceDefault") },
    ...cameras.map((camera, index) => ({
      value: camera.deviceId,
      text: camera.label || t("deviceUnnamed", { index: index + 1 }),
    })),
  ];
  // A remembered camera that is unplugged right now still shows as chosen.
  if (deviceId && !cameras.some((camera) => camera.deviceId === deviceId)) {
    entries.push({
      value: deviceId,
      text: t("deviceUnnamed", { index: cameras.length + 1 }),
      missing: true,
    });
  }

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const current = entries.findIndex((entry) => entry.value === deviceId);
    const nextIndex = (current + delta + entries.length) % entries.length;
    onChange(entries[nextIndex]!.value);
    rows.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={t("device")}
      className={styles.sources}
      data-scrolls={entries.length > MAX_VISIBLE_SOURCES || undefined}
      onKeyDown={onKeyDown}
    >
      {entries.map((entry, index) => {
        const checked = entry.value === deviceId;
        return (
          <button
            key={entry.value === null ? "default-camera" : `device:${entry.value}`}
            ref={(element) => {
              rows.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.source}
            data-missing={entry.missing || undefined}
            onClick={() => onChange(entry.value)}
          >
            <span className={styles.dot} aria-hidden />
            <span className={styles.sourceName}>{entry.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export interface CameraBlockedCardProps {
  onOpenSystemSettings: () => void;
}

/** In place of the settings while camera access is denied: why, and the way out. */
export function CameraBlockedCard({
  onOpenSystemSettings,
}: CameraBlockedCardProps): React.JSX.Element {
  const t = useTranslations("cameraSettings");
  return (
    <div className={styles.blocked}>
      <span className={styles.blockedIcon} aria-hidden>
        <Lock size={20} />
      </span>
      <p className={styles.blockedTitle}>{t("blockedTitle")}</p>
      <p className={styles.blockedBody}>{t("blockedBody")}</p>
      <button type="button" className={styles.blockedButton} onClick={onOpenSystemSettings}>
        {t("openSystemSettings")}
      </button>
    </div>
  );
}
