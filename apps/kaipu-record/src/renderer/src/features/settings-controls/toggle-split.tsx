import React, { type ComponentType, type Ref } from "react";
import { ChevronDown } from "lucide-react";
import styles from "./toggle-split.module.css";

export interface ToggleSplitProps {
  icon: ComponentType<{ size?: number }>;
  /** Shown in place of `icon` while blocked. */
  blockedIcon?: ComponentType<{ size?: number }>;
  /** Text label; the compact (capture panel) variant drops it. */
  label: string;
  /** The ON / OFF / BLOCKED readout. */
  status: string;
  on: boolean;
  onToggle: () => void;
  /** The tile reads blocked (red): the caller decides what that means for toggling. */
  blocked?: boolean;
  /** The body does nothing when pressed (blocked off, or unavailable). */
  bodyDisabled?: boolean;
  /** Accessible name of the body when its text alone is not enough (e.g. blocked). */
  bodyLabel?: string;
  /** Native tooltip for the body, e.g. why it is disabled. */
  bodyTitle?: string;
  chevronLabel: string;
  /** The capture panel's tile: no text label, a narrower chevron. */
  compact?: boolean;
  /** Whether the settings (popover or drawer) are open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The element the open settings belong to, for aria-controls. */
  controlsId?: string;
  /** The chevron, so the settings can send focus back to it when they close. */
  chevronRef?: Ref<HTMLButtonElement>;
}

/**
 * A tile of the Mic · Audio · Camera row split in two: the body toggles exactly as the
 * plain tile did, and a chevron segment on its right opens the tile's settings. Someone
 * who never touches the chevron sees the same row as before.
 */
export function ToggleSplit({
  icon: Icon,
  blockedIcon: BlockedIcon,
  label,
  status,
  on,
  onToggle,
  blocked = false,
  bodyDisabled = false,
  bodyLabel,
  bodyTitle,
  chevronLabel,
  compact = false,
  open,
  onOpenChange,
  controlsId,
  chevronRef,
}: ToggleSplitProps): React.JSX.Element {
  const iconSize = compact ? 15 : 20;
  const ShownIcon = blocked && BlockedIcon ? BlockedIcon : Icon;

  return (
    <div
      className={styles.split}
      data-compact={compact || undefined}
      data-active={on || undefined}
      data-blocked={blocked || undefined}
    >
      <button
        type="button"
        className={styles.body}
        aria-pressed={on}
        aria-disabled={bodyDisabled || undefined}
        aria-label={bodyLabel}
        title={bodyTitle}
        onClick={bodyDisabled ? undefined : onToggle}
      >
        <span className={styles.icon}>
          <ShownIcon size={iconSize} />
        </span>
        {!compact && <span className={styles.label}>{label}</span>}
        <span className={styles.status}>{status}</span>
      </button>
      <button
        ref={chevronRef}
        type="button"
        className={styles.chevron}
        aria-label={chevronLabel}
        // The popover is a dialog; the panel's drawer is an inline region.
        aria-haspopup={compact ? undefined : "dialog"}
        aria-expanded={open}
        aria-controls={open ? controlsId : undefined}
        data-open={open || undefined}
        onClick={() => onOpenChange(!open)}
      >
        <ChevronDown size={compact ? 12 : 14} aria-hidden />
      </button>
    </div>
  );
}
