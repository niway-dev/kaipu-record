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
  /** The current choice, in the right zone: truncates, with the full text as its title. */
  detail: string;
  /** The ON / OFF / BLOCKED readout under the name, in the left zone. */
  status: string;
  on: boolean;
  onToggle: () => void;
  /** The card reads blocked (red): the caller decides what that means for toggling. */
  blocked?: boolean;
  /** The left zone does nothing when pressed (blocked off). It stays focusable. */
  switchDisabled?: boolean;
  /** The left zone natively disabled, dimmed and not focusable (system audio unavailable); the panel still opens. */
  switchUnavailable?: boolean;
  /** Accessible name of the left zone when the name alone is not enough (e.g. blocked). */
  switchLabel?: string;
  /** Native tooltip for the left zone, e.g. why it is disabled. */
  switchTitle?: string;
  chevronLabel: string;
  /** Whether the card's panel is open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the open panel belongs to, for aria-controls. */
  controlsId?: string;
  /** The right zone (device name + chevron), so the panel can send focus back when it closes. */
  chevronRef?: Ref<HTMLButtonElement>;
  /** The catalog area this card is (`uiArea("…")`), put on its root. */
  ui?: UiAreaProps;
}

/**
 * One card of the Capture page's "Recording setup" row, in two zones. The left zone (icon, name
 * and ON/OFF readout) is the one `role="switch"`: pressing it turns the source on or off, the
 * same recording setting the capture widget reads. The right zone (the current device and a
 * chevron) is a button that only opens the card's panel, so choosing a device never flips the
 * source and turning it on or off never moves the layout. Neither zone contains the other or
 * any other control.
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

  const deviceText = detail.trim();

  return (
    <div
      {...ui}
      data-settings-anchor=""
      className={styles.card}
      data-active={on || undefined}
      data-open={open || undefined}
      data-blocked={blocked || undefined}
    >
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={switchLabel ?? name}
        disabled={switchUnavailable}
        aria-disabled={switchDisabled || undefined}
        title={switchTitle}
        className={styles.toggle}
        onClick={switchDisabled ? undefined : onToggle}
      >
        <span className={styles.icon}>
          <ShownIcon size={18} />
        </span>
        <span className={styles.text}>
          <span className={styles.name}>{name}</span>
          <span className={styles.status}>{status}</span>
        </span>
      </button>
      <button
        ref={chevronRef}
        type="button"
        className={styles.device}
        aria-label={deviceText ? `${chevronLabel}: ${deviceText}` : chevronLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? controlsId : undefined}
        title={deviceText || undefined}
        data-open={open || undefined}
        onClick={() => onOpenChange(!open)}
      >
        {/* The line truncates in a narrow window; the full text is the button's title. */}
        <span className={styles.detail}>{detail}</span>
        <ChevronDown size={14} aria-hidden className={styles.chevron} />
      </button>
    </div>
  );
}
