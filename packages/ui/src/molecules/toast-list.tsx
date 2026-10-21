import * as stylex from "@stylexjs/stylex";
import { tokens } from "@kaipu/tokens/kaipu.stylex";
import type { ReactNode } from "react";

/**
 * The toast stack, presentational. It takes the toasts to show and the two
 * callbacks it can fire; it owns no store and subscribes to nothing.
 *
 * That split is what makes it shareable. The desktop's version read its own
 * module-level store and called `useTranslations` for the close button's label,
 * which are the two things ADR 0009 keeps out of here — the store is a surface's
 * state, and the label belongs to whichever catalog that surface uses. Each app
 * keeps a thin host that wires its own store to this.
 *
 * It is a molecule: the stack composes toasts, each of which composes its own
 * parts.
 */

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastItem {
  id: string;
  message: ReactNode;
  action?: ToastAction;
}

const styles = stylex.create({
  host: {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    gap: "8px",
    // The stack must not swallow clicks aimed at the app behind it; each toast
    // turns pointer events back on for itself.
    pointerEvents: "none",
  },
  hidden: { display: "none" },
  toast: {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    minWidth: "280px",
    maxWidth: "420px",
    paddingBlock: "12px",
    paddingInline: "14px",
    borderRadius: "10px",
    backgroundColor: tokens.bgCardHover,
    borderWidth: "1px",
    borderStyle: "solid",
    borderColor: tokens.border,
    color: tokens.textPrimary,
    boxShadow: "0 8px 24px rgba(0, 0, 0, 0.18)",
    pointerEvents: "auto",
  },
  message: {
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    fontSize: "13px",
    lineHeight: 1.4,
  },
  action: {
    flexShrink: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    padding: 0,
    fontSize: "13px",
    fontWeight: 600,
    color: tokens.accentPrimary,
    cursor: "pointer",
  },
  close: {
    flexShrink: 0,
    borderStyle: "none",
    backgroundColor: "transparent",
    paddingBlock: 0,
    paddingInline: "2px",
    fontSize: "16px",
    lineHeight: 1,
    color: tokens.textMuted,
    cursor: "pointer",
  },
});

export interface ToastListProps {
  toasts: readonly ToastItem[];
  onDismiss: (id: string) => void;
  /** Accessible name for the close button — the surface's own catalog provides it. */
  closeLabel: string;
}

export function ToastList({ toasts, onDismiss, closeLabel }: ToastListProps) {
  return (
    <div {...stylex.props(styles.host, toasts.length === 0 && styles.hidden)}>
      {toasts.map((toast) => (
        <div key={toast.id} role="alert" {...stylex.props(styles.toast)}>
          <span {...stylex.props(styles.message)}>{toast.message}</span>
          {toast.action ? (
            <button
              type="button"
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              {...stylex.props(styles.action)}
            >
              {toast.action.label}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={closeLabel}
            onClick={() => onDismiss(toast.id)}
            {...stylex.props(styles.close)}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
