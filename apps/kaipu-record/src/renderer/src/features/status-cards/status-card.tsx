import { X } from "lucide-react";
import styles from "./status-card.module.css";

export interface StatusCardProps {
  /** Accessible name of the card (its title, usually). */
  label: string;
  /** A small tile on the left of the title. */
  icon?: React.ReactNode;
  /**
   * The icon brings its own tile (a destination logo, the fox): drawn as is, without the
   * accent frame around it.
   */
  bareIcon?: boolean;
  title: React.ReactNode;
  /** One mono line under the title (sizes, dimensions). */
  subtitle?: React.ReactNode;
  /** ✕ in the corner; omitted for a card that must stay (an export in progress). */
  onDismiss?(): void;
  dismissLabel?: string;
  /** Muted line under a hairline at the bottom. */
  footer?: React.ReactNode;
  onMouseEnter?(): void;
  onMouseLeave?(): void;
  children?: React.ReactNode;
}

/**
 * The in-app status card (NIW2-218 export redesign): the top-right stack's one shape, used
 * by "Recording saved", the export progress and "Ready to share" — and meant for the next
 * ones too (a finished cloud upload). Header with icon, title and ✕; whatever body the card
 * needs; an optional footer note.
 */
export function StatusCard({
  label,
  icon,
  bareIcon = false,
  title,
  subtitle,
  onDismiss,
  dismissLabel,
  footer,
  onMouseEnter,
  onMouseLeave,
  children,
}: StatusCardProps): React.JSX.Element {
  return (
    <section
      className={styles.card}
      aria-label={label}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      <header className={styles.header}>
        {icon && (
          <span className={styles.icon} data-bare={bareIcon} aria-hidden>
            {icon}
          </span>
        )}
        <div className={styles.heading}>
          <div className={styles.title}>{title}</div>
          {subtitle && <div className={styles.subtitle}>{subtitle}</div>}
        </div>
        {onDismiss && (
          <button
            type="button"
            className={styles.dismiss}
            aria-label={dismissLabel}
            onClick={onDismiss}
          >
            <X size={14} strokeWidth={1.8} />
          </button>
        )}
      </header>
      {children && <div className={styles.body}>{children}</div>}
      {footer && <footer className={styles.footer}>{footer}</footer>}
    </section>
  );
}

/** A sentence in the card's body; `warn` turns it amber. */
export function StatusCardText({
  warn = false,
  children,
}: {
  warn?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <p className={styles.text} data-warn={warn}>
      {children}
    </p>
  );
}

/** The card's action row: a primary button that takes the room, then the others. */
export function StatusCardActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={styles.actions}>{children}</div>;
}

/**
 * A card button. `text` is a quiet word-only action (the progress card's Cancel); `grow`
 * shares the row with the primary instead of hugging its label. A button with
 * `onDragStart` is something to pick up (the ready card's "Drag to upload").
 */
export function StatusCardButton({
  variant = "secondary",
  grow = false,
  onClick,
  onDragStart,
  label,
  children,
}: {
  variant?: "primary" | "secondary" | "text";
  grow?: boolean;
  onClick?(): void;
  onDragStart?(event: React.DragEvent<HTMLButtonElement>): void;
  /** Accessible name, when the visible words are not enough. */
  label?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.button}
      data-variant={variant}
      data-grow={grow}
      aria-label={label}
      onClick={onClick}
      draggable={onDragStart ? true : undefined}
      onDragStart={onDragStart}
    >
      {children}
    </button>
  );
}
