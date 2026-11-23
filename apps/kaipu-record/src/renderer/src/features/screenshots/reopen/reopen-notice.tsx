import { useEffect, useState } from "react";
import { Check, Info, X } from "lucide-react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import type { CanvasLoad } from "./canvas-load";
import styles from "./reopen-notice.module.css";

/** How long "Reopened with everything editable" stays before it fades out. */
export const EDITABLE_NOTICE_MS = 4000;
/** The fade at the end of those 4 s. */
const FADE_MS = 400;

/** "NOV 11 · 11:56" in the app's locale: the saved item's time, without the year. */
function savedWhen(epochMs: number, locale: string): string {
  const date = new Date(epochMs);
  const day = new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  const time = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return `${day} · ${time}`;
}

export type ReopenNoticeProps =
  /** I1: the saved document loaded. Fades after ~4 s, or on the first edit. */
  | { kind: "editable"; savedAt: number | null; edited: boolean }
  /** I2: a document existed but could not be read. Stays until dismissed. */
  | { kind: "flat" }
  /** I3: the document is offloaded by a sync provider. Stays until dismissed. */
  | { kind: "evicted" };

/**
 * The pill at the top-centre of the stage when a saved screenshot is reopened in canvas
 * mode. It says which of the two things happened: everything is still editable, or the
 * flat image opened because the earlier drawings could not be read.
 */
export function ReopenNotice(props: ReopenNoticeProps): React.JSX.Element | null {
  if (props.kind === "editable") return <EditableNotice {...props} />;
  return props.kind === "evicted" ? <FlatNotice evicted /> : <FlatNotice />;
}

/**
 * The notice for what a reopen found: I1 when the document loaded, I2 when one existed but
 * could not be read, nothing for a plain screenshot (or before the read settles).
 */
export function ReopenNoticeSlot({
  reopen,
  edited,
}: {
  reopen: CanvasLoad<unknown> | null;
  edited: boolean;
}): React.JSX.Element | null {
  if (reopen?.status === "loaded") {
    return <EditableNotice savedAt={reopen.savedAt} edited={edited} />;
  }
  if (reopen?.status === "unreadable") return <FlatNotice evicted={reopen.evicted === true} />;
  return null;
}

function EditableNotice({
  savedAt,
  edited,
}: {
  savedAt: number | null;
  edited: boolean;
}): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const locale = useLocale();
  const [leaving, setLeaving] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    const fade = setTimeout(() => setLeaving(true), EDITABLE_NOTICE_MS - FADE_MS);
    const done = setTimeout(() => setGone(true), EDITABLE_NOTICE_MS);
    return () => {
      clearTimeout(fade);
      clearTimeout(done);
    };
  }, []);
  // The first edit is the answer to "is it editable?": the pill has done its job.
  useEffect(() => {
    if (edited) setGone(true);
  }, [edited]);

  if (gone) return null;
  return (
    <div
      {...uiArea("editorImage.reopenNotice")}
      role="status"
      className={leaving ? `${styles.pill} ${styles.leaving}` : styles.pill}
    >
      <span className={`${styles.icon} ${styles.ok}`} aria-hidden="true">
        <Check size={13} strokeWidth={2.4} />
      </span>
      <span>{t("reopenEditable")}</span>
      {savedAt !== null && (
        <span className={styles.date}>
          {t("reopenSaved", { when: savedWhen(savedAt, locale) }).toLocaleUpperCase(locale)}
        </span>
      )}
    </div>
  );
}

function FlatNotice({ evicted = false }: { evicted?: boolean }): React.JSX.Element | null {
  const t = useTranslations("screenshots");
  const library = useTranslations("library");
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div {...uiArea("editorImage.reopenNotice")} role="status" className={styles.pill}>
      <span className={`${styles.icon} ${styles.info}`} aria-hidden="true">
        <Info size={13} />
      </span>
      <span>{evicted ? library("evictedHint") : t("reopenFlat")}</span>
      <button
        type="button"
        className={styles.dismiss}
        aria-label={t("reopenDismiss")}
        onClick={() => setDismissed(true)}
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
