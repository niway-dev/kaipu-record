import React, { useRef, type KeyboardEvent, type RefObject } from "react";
import { Info, Mic, Volume1 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { MIC_LEVEL_MAX, MIC_LEVEL_MIN, type AudioSettings } from "@shared/audio-settings";
import { getMicrophoneType } from "@renderer/features/recording/microphone";
import type { Microphone } from "@renderer/features/recording/types";
import { LevelSlider, SwitchRow } from "./audio-settings-fields";
import styles from "./audio-settings-content.module.css";
import micStyles from "./mic-settings-content.module.css";

export interface MicSettingsContentProps {
  microphones: Microphone[];
  selected: Microphone | null;
  onSelect: (microphone: Microphone) => void;
  audio: AudioSettings;
  onChange: (patch: Partial<AudioSettings>) => void;
  isRecording: boolean;
  /** Bars (0..1) for the selected device's meter. */
  levels: readonly number[];
  compact?: boolean;
  /** The Record page's wide layout: devices on the left, level and noise on the right. */
  columns?: boolean;
  /** The device group, which takes focus when the settings open. */
  firstRef: RefObject<HTMLElement | null>;
}

/**
 * The microphone settings, shared by the Record page's drawer and the capture panel's
 * drawer: the input device (locked during a take), the input level, noise reduction.
 */
export function MicSettingsContent({
  microphones,
  selected,
  onSelect,
  audio,
  onChange,
  isRecording,
  levels,
  compact = false,
  columns = false,
  firstRef,
}: MicSettingsContentProps): React.JSX.Element {
  const t = useTranslations("micSettings");
  const tRecord = useTranslations("record");
  const rows = useRef<(HTMLButtonElement | null)[]>([]);

  // The saved device may be unplugged right now: it stays in the list, greyed and unselectable.
  const missing = selected !== null && !microphones.some((m) => m.deviceId === selected.deviceId);
  const devices = missing ? [...microphones, selected] : microphones;
  const selectable = (mic: Microphone): boolean =>
    !isRecording && microphones.some((m) => m.deviceId === mic.deviceId);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const delta =
      event.key === "ArrowDown" || event.key === "ArrowRight"
        ? 1
        : event.key === "ArrowUp" || event.key === "ArrowLeft"
          ? -1
          : 0;
    if (delta === 0 || isRecording || microphones.length === 0) return;
    event.preventDefault();
    const current = microphones.findIndex((m) => m.deviceId === selected?.deviceId);
    // No listed device is selected (it was unplugged): Down starts at the first, Up at the last.
    const from = current === -1 ? (delta > 0 ? -1 : microphones.length) : current;
    const next = microphones[(from + delta + microphones.length) % microphones.length]!;
    onSelect(next);
    rows.current[devices.indexOf(next)]?.focus();
  };

  return (
    <div
      className={styles.content}
      data-compact={compact || undefined}
      data-columns={columns || undefined}
    >
      <div className={styles.header}>
        <Mic size={compact ? 13 : 15} aria-hidden className={styles.headerIcon} />
        <span className={styles.headerTitle}>{t("microphone")}</span>
        {isRecording && <span className={styles.live}>{t("live")}</span>}
      </div>

      <div className={styles.column}>
        <span className={styles.label} aria-hidden>
          {t("input")}
        </span>
        <div
          ref={firstRef as RefObject<HTMLDivElement | null>}
          role="radiogroup"
          aria-label={t("input")}
          className={micStyles.devices}
          data-dense={columns || undefined}
          // With no device there is no radio to take focus: the group itself does, so focus
          // still enters the settings and Esc reaches their key handler.
          tabIndex={devices.length === 0 ? -1 : undefined}
          onKeyDown={onKeyDown}
        >
          {devices.length === 0 && <p className={styles.hint}>{t("noDevices")}</p>}
          {devices.map((mic, index) => {
            const checked = mic.deviceId === selected?.deviceId;
            const isMissing = missing && mic.deviceId === selected?.deviceId;
            const canPick = selectable(mic);
            return (
              <button
                key={mic.deviceId}
                ref={(element) => {
                  rows.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={checked}
                aria-disabled={!canPick || undefined}
                tabIndex={checked ? 0 : -1}
                className={micStyles.device}
                data-missing={isMissing || undefined}
                onClick={canPick ? () => onSelect(mic) : undefined}
              >
                <span className={micStyles.dot} aria-hidden />
                <span className={micStyles.deviceText}>
                  <span className={micStyles.deviceName}>{mic.label}</span>
                  <span className={micStyles.deviceType} data-missing={isMissing || undefined}>
                    {isMissing ? t("disconnected") : tRecord(getMicrophoneType(mic.label))}
                  </span>
                </span>
                {checked && !isMissing && (
                  <span className={micStyles.meter} role="img" aria-label={t("meter")}>
                    {levels.map((level, bar) => (
                      <span
                        key={bar}
                        className={micStyles.bar}
                        style={{ height: `${Math.round(Math.min(1, Math.max(0, level)) * 100)}%` }}
                      />
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.column}>
        <span className={styles.label} aria-hidden>
          {t("inputLevel")}
        </span>
        <LevelSlider
          label={t("inputLevel")}
          value={audio.micLevel}
          min={MIC_LEVEL_MIN}
          max={MIC_LEVEL_MAX}
          valueText={t("levelValue", { percent: audio.micLevel })}
          icon={<Volume1 size={14} />}
          onChange={(micLevel) => onChange({ micLevel })}
        />

        <SwitchRow
          title={t("noiseTitle")}
          hint={t("noiseHint")}
          checked={audio.noiseSuppression}
          onChange={(noiseSuppression) => onChange({ noiseSuppression })}
        />

        {/* Present from the start and filled later, so it is announced once when it changes. */}
        <p className={styles.note} role="status" aria-live="polite">
          {isRecording && (
            <>
              <Info size={12} aria-hidden className={styles.noteIcon} />
              <span>{t("liveNote")}</span>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
