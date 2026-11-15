import React, { type ComponentType, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./setup-card.module.css";
import type { UiAreaProps } from "@renderer/lib/ui-area";

export interface SetupCardProps {
  icon: ComponentType<{ size?: number }>;
  /** Shown in place of `icon` while blocked. */
  blockedIcon?: ComponentType<{ size?: number }>;
  /** Bold line: Microphone, System audio, Camera. */
  name: string;
  /** Secondary line: the current choice. */
  detail: string;
  /** The ON / OFF / BLOCKED readout next to the switch. */
  status: string;
  on: boolean;
  onToggle: () => void;
  /** The card reads blocked (red): the caller decides what that means for toggling. */
  blocked?: boolean;
  /** The switch does nothing when pressed (blocked off). It stays focusable. */
  switchDisabled?: boolean;
  /** Natively disabled switch, dimmed and not focusable (system audio unavailable). */
  switchUnavailable?: boolean;
  /** Accessible name of the switch when the name alone is not enough (e.g. blocked). */
  switchLabel?: string;
  /** Native tooltip for the switch, e.g. why it is disabled. */
  switchTitle?: string;
  chevronLabel: string;
  /** Whether the card's panel is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the open panel belongs to, for aria-controls. */
  controlsId?: string;
  /** The chevron, so the panel can send focus back to it when it closes. */
  chevronRef?: Ref<HTMLButtonElement>;
  /** The catalog area this card is (`uiArea("…")`), put on its root. */
  ui?: UiAreaProps;
}

/**
 * One card of the Capture page's "Recording setup" row: icon, name and current choice, an
 * ON/OFF readout with a switch, and a separate chevron segment that opens the card's panel.
 * The switch writes the same recording setting the capture widget reads; the chevron only
 * opens the panel, so turning a source on or off never moves the layout.
 */
export function SetupCard({
  icon: Icon,
  blockedIcon: BlockedIcon,
  name,
  detail,
  status,
  on,
  onToggle,
  blocked = false,
  switchDisabled = false,
  switchUnavailable = false,
  switchLabel,
  switchTitle,
  chevronLabel,
  open,
  onOpenChange,
  controlsId,
  chevronRef,
  ui,
}: SetupCardProps): React.JSX.Element {
  const ShownIcon = blocked && BlockedIcon ? BlockedIcon : Icon;

  return (
    <div
      {...ui}
      className={styles.card}
      data-active={on || undefined}
      data-open={open || undefined}
      data-blocked={blocked || undefined}
    >
      <div className={styles.body}>
        <span className={styles.icon}>
          <ShownIcon size={18} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{name}</span>
          {/* The line truncates in a narrow window; the full text shows on hover. */}
          <span className={styles.detail} title={detail.trim() || undefined}>
            {detail}
          </span>
        </span>
        <span className={styles.status}>{status}</span>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={switchLabel ?? name}
          disabled={switchUnavailable}
          aria-disabled={switchDisabled || undefined}
          title={switchTitle}
          className={styles.switch}
          onClick={switchDisabled ? undefined : onToggle}
        >
          <span className={styles.knob} />
        </button>
      </div>
      <button
        ref={chevronRef}
        type="button"
        className={styles.chevron}
        aria-label={chevronLabel}
        aria-expanded={open}
        aria-controls={open ? controlsId : undefined}
        data-open={open || undefined}
        onClick={() => onOpenChange(!open)}
      >
        <ChevronDown size={14} aria-hidden />
      </button>
    </div>
  );
}
