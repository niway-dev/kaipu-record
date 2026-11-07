import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AudioLines,
  Check,
  Film,
  MousePointer2,
  PenLine,
  Shield,
  Webcam,
  ZoomIn,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import { ALWAYS_SHOWN, type TrackKey } from "../tracks";
import styles from "./tracks-popover.module.css";

/** Icon and message key of each lane's row. */
const ROW_META: Record<TrackKey, { Icon: LucideIcon; label: string }> = {
  clips: { Icon: Film, label: "laneClips" },
  annotations: { Icon: PenLine, label: "laneAnnotations" },
  zooms: { Icon: ZoomIn, label: "laneZooms" },
  activity: { Icon: MousePointer2, label: "trackCursorActivity" },
  webcam: { Icon: Webcam, label: "laneWebcam" },
  privacy: { Icon: Shield, label: "lanePrivacy" },
  audio: { Icon: AudioLines, label: "laneAudio" },
};

export interface TracksPopoverProps {
  /** The Tracks trigger: the panel opens above it and Escape hands focus back to it. */
  anchor: HTMLElement;
  /** The lanes this recording can show, in lane order. */
  available: readonly TrackKey[];
  /** What the user hid. */
  hidden: readonly TrackKey[];
  onToggle(key: TrackKey): void;
  onClose(): void;
}

/**
 * "Show tracks": one checkbox row per lane the recording can show (NIW2-665, ADR 0050).
 * Hiding a lane only changes what the timeline draws, so the panel says as much. Clips is
 * checked and cannot be toggled; Cursor activity sits under Zooms and cannot be toggled
 * while Zooms is hidden (its stored choice is kept, not changed). A menu of checkboxes:
 * arrows move, Space/Enter toggle, Escape closes and returns focus to the trigger, a
 * pointer-down anywhere else closes. It stays open across toggles.
 */
export function TracksPopover({
  anchor,
  available,
  hidden,
  onToggle,
  onClose,
}: TracksPopoverProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  // Above the trigger (the transport bar sits at the bottom of the window), left edges
  // aligned, clamped so the whole panel stays on screen. The panel stays open across
  // toggles and a toggle changes the footer's height, which moves the transport and the
  // trigger with it: measured again whenever the hidden set changes (the layout has
  // settled by the time this runs, in the same commit as the toggle).
  useLayoutEffect(() => {
    const rect = anchor.getBoundingClientRect();
    const height = menuRef.current?.offsetHeight ?? 0;
    const width = menuRef.current?.offsetWidth ?? 0;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    const top = Math.max(8, Math.min(rect.top - 8 - height, window.innerHeight - height - 8));
    setPos({ left, top });
  }, [anchor, hidden]);

  // A resize moves the page under the panel in ways a toggle does not, so it closes the
  // panel instead of leaving it adrift.
  useEffect(() => {
    window.addEventListener("resize", onClose);
    return () => window.removeEventListener("resize", onClose);
  }, [onClose]);

  // Focus the first row that can be toggled, once, on open.
  useEffect(() => {
    menuRef.current
      ?.querySelector<HTMLElement>('[role="menuitemcheckbox"]:not([aria-disabled="true"])')
      ?.focus();
  }, []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      // The trigger's own click toggles; closing here too would reopen it.
      if (menuRef.current?.contains(target) || anchor.contains(target)) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [anchor, onClose]);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const rows = [
      ...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemcheckbox"]'),
    ];
    const at = rows.indexOf(document.activeElement as HTMLElement);
    // Every key handled here stops here: the page's window handler would otherwise also
    // clear the selection on Escape, toggle playback on Space and delete on Delete.
    const handled = (): void => {
      event.preventDefault();
      event.stopPropagation();
    };
    const move = (to: number): void => {
      handled();
      rows[(to + rows.length) % rows.length]?.focus();
    };
    if (event.key === "Escape") {
      handled();
      onClose();
      anchor.focus();
    } else if (event.key === "Tab") {
      // Close and let focus move on naturally: no preventDefault, no refocus.
      event.stopPropagation();
      onClose();
    } else if (event.key === "ArrowDown") move(at + 1);
    else if (event.key === "ArrowUp") move(at - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(rows.length - 1);
    else if (event.key === "Enter" || event.key === " ") {
      handled();
      rows[at]?.click();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      // The page deletes the selected clip, zoom or redaction on these: not from here.
      handled();
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) handled();
  };

  const zoomsHidden = hidden.includes("zooms");

  return createPortal(
    <div
      {...uiArea("editorVideo.tracksPopover")}
      ref={menuRef}
      role="menu"
      aria-label={t("showTracks")}
      aria-orientation="vertical"
      className={styles.popover}
      style={{ left: pos.left, top: pos.top }}
      onKeyDown={onKeyDown}
    >
      <p className={styles.title} aria-hidden="true">
        {t("showTracks")}
      </p>
      {available.map((key) => {
        const { Icon, label } = ROW_META[key];
        const always = ALWAYS_SHOWN.includes(key);
        // Cursor activity cannot be changed while its parent lane is off; its checkbox
        // keeps showing the stored choice.
        const disabled = always || (key === "activity" && zoomsHidden);
        const checked = always || !hidden.includes(key);
        return (
          <button
            key={key}
            type="button"
            role="menuitemcheckbox"
            aria-checked={checked}
            aria-disabled={disabled || undefined}
            tabIndex={-1}
            className={[
              styles.row,
              key === "activity" ? styles.nested : "",
              always ? styles.always : "",
            ].join(" ")}
            onClick={() => {
              if (!disabled) onToggle(key);
            }}
          >
            <span className={styles.box} data-checked={checked} aria-hidden="true">
              <Check size={12} strokeWidth={3} />
            </span>
            <Icon size={16} aria-hidden className={styles.icon} />
            <span className={styles.label}>{t(label as "laneClips")}</span>
            {always && <span className={styles.alwaysTag}>{t("trackAlways")}</span>}
          </button>
        );
      })}
      <p className={styles.hint}>{t("tracksHint")}</p>
    </div>,
    document.body,
  );
}
