import React from "react";
import { Mic, ChevronDown, ChevronUp, Check } from "lucide-react";
import { getMicrophoneType } from "@renderer/features/recording/microphone";
import type { Microphone } from "@renderer/features/recording/types";
import { cx } from "@renderer/ui/cx";
import styles from "./mic-picker.module.css";

interface MicPickerProps {
  microphones: Microphone[];
  selected: Microphone | null;
  isOpen: boolean;
  variant?: "full" | "compact";
  onToggle: () => void;
  onSelect: (microphone: Microphone) => void;
}

/** Dumb microphone device picker. State lives in `useRecordingSetup`. */
export function MicPicker({
  microphones,
  selected,
  isOpen,
  variant = "full",
  onToggle,
  onSelect,
}: MicPickerProps): React.JSX.Element {
  const compact = variant === "compact";
  const iconSize = compact ? 12 : 13;
  const affordanceSize = compact ? 11 : 13;

  return (
    <div className={cx(styles.selector, compact && styles.compact)}>
      <button type="button" className={styles.trigger} onClick={onToggle}>
        <span className={styles.triggerIcon}>
          <Mic size={iconSize} />
        </span>
        <div className={styles.triggerText}>
          <span className={styles.triggerLabel}>MICROPHONE</span>
          <span className={styles.triggerName}>{selected?.label ?? "Select microphone"}</span>
        </div>
        {isOpen ? (
          <ChevronUp size={affordanceSize} className={styles.chevron} />
        ) : (
          <ChevronDown size={affordanceSize} className={styles.chevron} />
        )}
      </button>
      {isOpen && (
        <div className={styles.menu}>
          {microphones.map((microphone) => {
            const isActive = microphone.deviceId === selected?.deviceId;
            return (
              <button
                key={microphone.deviceId}
                type="button"
                className={styles.option}
                data-active={isActive || undefined}
                onClick={() => onSelect(microphone)}
              >
                <div className={styles.optionInfo}>
                  <span className={styles.optionName}>{microphone.label}</span>
                  <span className={styles.optionType}>{getMicrophoneType(microphone.label)}</span>
                </div>
                {isActive && <Check size={affordanceSize} className={styles.check} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
