import React, { useSyncExternalStore } from "react";
import { useTranslations } from "@kaipu/i18n";
import { ToastList } from "@kaipu/ui";
import { dismissToast, getToasts, subscribeToasts } from "./toast-store";

/**
 * The desktop's toast host: the thin container ADR 0009 asks for. It reads this
 * app's store and resolves this app's copy, then hands both to the shared
 * presentational stack — which owns no store and knows no translation catalog,
 * so the web can mount the same component against its own.
 *
 * Mount once near the app root.
 */
export function ToastHost(): React.JSX.Element {
  const toasts = useSyncExternalStore(subscribeToasts, getToasts);
  const t = useTranslations("common");
  return <ToastList toasts={toasts} onDismiss={dismissToast} closeLabel={t("close")} />;
}
