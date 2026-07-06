import React, { useSyncExternalStore } from "react";
import { useTranslations } from "@kaipu/i18n";
import { cx } from "./cx";
import { dismissToast, getToasts, subscribeToasts, type ToastSpec } from "./toast-store";
import styles from "./toast.module.css";

function Toast({ toast }: { toast: ToastSpec }): React.JSX.Element {
  const t = useTranslations("common");
  return (
    <div className={styles.toast} role="alert">
      <span className={styles.message}>{toast.message}</span>
      {toast.action ? (
        <button
          type="button"
          className={styles.action}
          onClick={() => {
            toast.action?.onClick();
            dismissToast(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      ) : null}
      <button
        type="button"
        className={styles.close}
        aria-label={t("close")}
        onClick={() => dismissToast(toast.id)}
      >
        ×
      </button>
    </div>
  );
}

/** Mount once near the app root. Renders the live toast stack from the store. */
export function ToastHost({ className }: { className?: string }): React.JSX.Element {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  return (
    <div className={cx(styles.host, className)} data-empty={toasts.length === 0}>
      {toasts.map((toast) => (
        <Toast key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
