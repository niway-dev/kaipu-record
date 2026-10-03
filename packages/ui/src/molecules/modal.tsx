import * as stylex from "@stylexjs/stylex";
import { useEffect, useRef } from "react";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";

/**
 * A focus-trapping modal shell: a centered card on a dimmed backdrop, focused on
 * mount, dismissed by Escape or a backdrop click while inner clicks are kept.
 * One place for the overlay behavior every confirm dialog would otherwise
 * re-roll, each slightly differently.
 *
 * It lives in `molecules/` rather than `atoms/`: the pieces compose into one
 * another and the shell carries behavior, which is exactly the line this
 * package draws between the two.
 *
 * Deliberately not a portal and deliberately not Radix. It renders in place, so
 * a theme class on an ancestor still reaches it — which is the open question
 * that keeps the genuinely portal-based pieces out of here for now.
 */

const fade = stylex.keyframes({
  from: { opacity: 0 },
  to: { opacity: 1 },
});

const pop = stylex.keyframes({
  from: { opacity: 0, transform: "scale(0.94)" },
  to: { opacity: 1, transform: "scale(1)" },
});

const styles = stylex.create({
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 50,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    padding: tokens.spaceXl,
    backgroundColor: tokens.bgOverlay,
    backdropFilter: "blur(4px)",
    animationName: fade,
    animationDuration: "150ms",
    animationTimingFunction: "ease",
  },
  dialog: {
    width: "100%",
    maxWidth: "380px",
    backgroundColor: tokens.bgModal,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.borderLight,
    borderRadius: tokens.radiusLg,
    padding: "22px",
    textAlign: "center",
    boxShadow: "0 24px 60px -16px rgba(0, 0, 0, 0.6)",
    animationName: pop,
    animationDuration: "250ms",
    animationTimingFunction: "ease",
  },
  icon: {
    width: "44px",
    height: "44px",
    borderRadius: "12px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: "14px",
    borderWidth: "1px",
    borderStyle: "solid",
  },
  // Tinted tones with no token behind them, as in the Badge.
  toneDanger: {
    backgroundColor: "rgba(239, 68, 68, 0.12)",
    borderColor: "rgba(239, 68, 68, 0.4)",
    color: tokens.accentRed,
  },
  toneAccent: {
    backgroundColor: "rgba(246, 5, 92, 0.12)",
    borderColor: "rgba(246, 5, 92, 0.4)",
    color: tokens.accentPrimary,
  },
  title: {
    fontSize: tokens.fontSizeLg,
    fontWeight: tokens.fontWeightSemibold,
    letterSpacing: "-0.01em",
    marginBottom: "7px",
  },
  desc: {
    fontSize: tokens.fontSizeBase,
    lineHeight: 1.5,
    color: tokens.textSecondary,
    marginBottom: "20px",
  },
  name: {
    color: tokens.textPrimary,
    fontWeight: tokens.fontWeightSemibold,
  },
  footer: {
    display: "flex",
    gap: tokens.spaceSm,
  },
  // The dialog's buttons are not the shared Button: they stretch to share the
  // footer and stand 36px rather than 34px. Migrated as they were — pixels stay.
  btn: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
    height: "36px",
    borderRadius: tokens.radiusMd,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSizeBase,
    fontWeight: tokens.fontWeightMedium,
    cursor: "pointer",
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: "transparent",
    transitionProperty: "background-color, border-color, opacity",
    transitionDuration: "150ms",
    transitionTimingFunction: "ease",
  },
  btnGhost: {
    backgroundColor: "transparent",
    borderColor: tokens.borderLight,
    color: tokens.textSecondary,
  },
  btnPrimary: { backgroundColor: tokens.accentPrimary, color: "#fff" },
  btnDanger: { backgroundColor: tokens.accentRed, color: "#fff" },
  btnDisabled: { opacity: 0.55, cursor: "not-allowed" },
});

const hovers = stylex.create({
  ghost: {
    backgroundColor: { default: null, ":hover": tokens.bgCardHover },
    color: { default: null, ":hover": tokens.textPrimary },
  },
  primary: { backgroundColor: { default: null, ":hover": tokens.accentPrimaryHover } },
  danger: { backgroundColor: { default: null, ":hover": tokens.accentRedHover } },
});

export function ModalOverlay({
  onCancel,
  labelledBy,
  children,
}: {
  onCancel: () => void;
  labelledBy?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
      onClick={onCancel}
      {...stylex.props(styles.overlay)}
    >
      {/* Stops a click inside the card from reaching the backdrop's dismiss. */}
      <div onClick={(e) => e.stopPropagation()} {...stylex.props(styles.dialog)}>
        {children}
      </div>
    </div>
  );
}

export function ModalIcon({ tone, children }: { tone: "danger" | "accent"; children: ReactNode }) {
  return (
    <span
      aria-hidden
      {...stylex.props(styles.icon, tone === "danger" ? styles.toneDanger : styles.toneAccent)}
    >
      {children}
    </span>
  );
}

export function ModalTitle({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} {...stylex.props(styles.title)}>
      {children}
    </h3>
  );
}

export function ModalText({ children }: { children: ReactNode }) {
  return <p {...stylex.props(styles.desc)}>{children}</p>;
}

export function ModalName({ children }: { children: ReactNode }) {
  return <strong {...stylex.props(styles.name)}>{children}</strong>;
}

export function ModalActions({ children }: { children: ReactNode }) {
  return <div {...stylex.props(styles.footer)}>{children}</div>;
}

const VARIANT = {
  ghost: styles.btnGhost,
  primary: styles.btnPrimary,
  danger: styles.btnDanger,
} as const;

export function ModalButton({
  variant,
  onClick,
  disabled = false,
  children,
}: {
  variant: "ghost" | "primary" | "danger";
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      {...stylex.props(
        styles.btn,
        VARIANT[variant],
        !disabled && hovers[variant],
        disabled && styles.btnDisabled,
      )}
    >
      {children}
    </button>
  );
}
