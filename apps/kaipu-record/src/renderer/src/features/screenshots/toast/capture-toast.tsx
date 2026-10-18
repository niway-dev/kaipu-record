import React, { useEffect, useState } from "react";
import { ExternalLink, PenLine, Save, X } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { CaptureMode, CaptureToastPayload } from "@shared/types/screenshot-capture";
import type { CaptureToastBridge } from "@shared/types/electron-api";
import { detectKeyPlatform, type KeyPlatform } from "../overlay/overlay-keys";
import styles from "./capture-toast.module.css";

/** Shown in the footer; main owns the real timer (`TOAST_AUTO_HIDE_MS`). */
const AUTO_HIDE_SECONDS = 6;

const MODE_KEY = {
  frame: "modeFrame",
  window: "modeWindow",
  screen: "modeScreen",
} as const satisfies Record<CaptureMode, string>;

interface CaptureToastProps {
  /** Injected by tests; the window's bridge otherwise. */
  api?: CaptureToastBridge;
  platform?: KeyPlatform;
}

/**
 * Root of the capture toast window (`?window=capture-toast`), shown by main after a quiet
 * capture: what happened, the size and mode, Annotate, and Open in Library or Save to
 * Library. It only renders main's payload and reports presses; main runs every action
 * and owns the 6 s auto-hide, which the pointer pauses while it is over the card.
 */
export function CaptureToast({
  api = window.electronAPI.captureToast,
  platform: platformProp,
}: CaptureToastProps): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const [payload, setPayload] = useState<CaptureToastPayload | null>(null);
  const platform = platformProp ?? detectKeyPlatform();

  useEffect(() => {
    const unsubscribe = api.onShow(setPayload);
    // After subscribing: main sends the current payload in answer.
    api.ready();
    return unsubscribe;
  }, [api]);

  if (!payload) return null;

  const meta = [
    t("toast.meta", {
      width: payload.width,
      height: payload.height,
      mode: t(MODE_KEY[payload.mode]),
    }),
    ...(payload.copied
      ? [t("toast.pasteWith", { key: platform === "mac" ? "⌘V" : "Ctrl+V" })]
      : []),
  ].join(" · ");
  const footer = payload.saved
    ? payload.copied
      ? t("toast.footerAlsoSaved", { seconds: AUTO_HIDE_SECONDS })
      : t("toast.footer", { seconds: AUTO_HIDE_SECONDS })
    : t("toast.footerNotSaved", { seconds: AUTO_HIDE_SECONDS });

  return (
    <div
      role="status"
      aria-label={t("toast.label")}
      className={styles.card}
      onPointerEnter={() => api.hover(true)}
      onPointerLeave={() => api.hover(false)}
    >
      <div className={styles.head}>
        <img className={styles.thumbnail} src={payload.thumbnail} alt="" draggable={false} />
        <div className={styles.text}>
          <p className={styles.title}>
            {payload.copied ? t("toast.copiedTitle") : t("toast.savedTitle")}
          </p>
          <p className={styles.meta}>{meta}</p>
        </div>
        <button
          type="button"
          className={styles.close}
          aria-label={t("toast.dismiss")}
          onClick={() => api.action("dismiss")}
        >
          <X size={14} aria-hidden />
        </button>
      </div>
      <div className={styles.actions}>
        <button type="button" className={styles.primary} onClick={() => api.action("annotate")}>
          <PenLine size={14} aria-hidden />
          {t("toast.annotate")}
        </button>
        {payload.saved ? (
          <button
            type="button"
            className={styles.secondary}
            onClick={() => api.action("open-library")}
          >
            <ExternalLink size={14} aria-hidden />
            {t("toast.openInLibrary")}
          </button>
        ) : (
          <button type="button" className={styles.secondary} onClick={() => api.action("save")}>
            <Save size={14} aria-hidden />
            {t("toast.saveToLibrary")}
          </button>
        )}
      </div>
      <p className={styles.footer}>{footer}</p>
    </div>
  );
}
