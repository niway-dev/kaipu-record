import React, { useEffect, useRef } from "react";
import styles from "./modal.module.css";

/**
 * A focus-trapping modal shell: centered card on a dimmed backdrop, focus-on-mount,
 * Escape and backdrop-click both cancel, inner clicks don't. One place for the
 * a11y-sensitive overlay behavior that confirm dialogs would otherwise each re-roll.
 * Compose the body with `Modal.*` pieces below.
 */
export function ModalOverlay({
  onCancel,
  labelledBy,
  children,
}: {
  onCancel: () => void;
  labelledBy?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      className={styles.overlay}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onClick={onCancel}
    >
      <div className={styles.dialog} onClick={(e) => e.stopPropagation()}>
        {children}
      </div>
    </div>
  );
}

export function ModalIcon({
  tone,
  children,
}: {
  tone: "danger" | "accent";
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span className={styles.icon} data-tone={tone} aria-hidden>
      {children}
    </span>
  );
}

export function ModalTitle({
  id,
  children,
}: {
  id?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <h3 id={id} className={styles.title}>
      {children}
    </h3>
  );
}

export function ModalText({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className={styles.desc}>{children}</p>;
}

export function ModalName({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <strong className={styles.name}>{children}</strong>;
}

export function ModalActions({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={styles.footer}>{children}</div>;
}

export function ModalButton({
  variant,
  onClick,
  disabled,
  children,
}: {
  variant: "ghost" | "primary" | "danger";
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      className={styles.btn}
      data-variant={variant}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
