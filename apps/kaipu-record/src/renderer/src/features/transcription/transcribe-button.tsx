import React, { useEffect, useState } from "react";
import { Captions, Check, Loader2, X } from "lucide-react";
import { useTranslations, type Translator } from "@kaipu/i18n";
import { ModalActions, ModalButton, ModalOverlay, ModalText, ModalTitle } from "@kaipu/ui";
import { uiArea, type UiAreaProps } from "@renderer/lib/ui-area";
import { ModelOffer } from "./model-offer";
import styles from "./transcribe-button.module.css";
import type { TranscribeControlState } from "./transcribe-control";
import type { StartFailure } from "./transcription-job-store";
import {
  useTranscribeControl,
  type TranscribeControl,
  type TranscribeControlItem,
} from "./use-transcribe-control";

/**
 * Where the button lives. `card` and `row` are Library list items, where space is tight: the
 * label is an accessible name and a tooltip, not visible text. `detail` and `editor` have room
 * for the icon and the word.
 */
export type TranscribeButtonVariant = "card" | "row" | "detail" | "editor";

export interface TranscribeButtonProps {
  item: TranscribeControlItem;
  variant: TranscribeButtonVariant;
  /** The catalog area this button is on the screen that hosts it (`uiArea("<screen>.<area>")`). */
  ui?: UiAreaProps;
}

const ICON_SIZE: Record<TranscribeButtonVariant, number> = {
  card: 14,
  row: 15,
  detail: 15,
  editor: 14,
};

/** The dialog's catalog area on the screen that hosts the button. */
function dialogArea(variant: TranscribeButtonVariant): UiAreaProps {
  switch (variant) {
    case "detail":
      return uiArea("libraryDetail.transcribeModelDialog");
    case "editor":
      return uiArea("editorVideo.transcribeModelDialog");
    default:
      return uiArea("library.transcribeModelDialog");
  }
}

function failureText(t: Translator<"transcription">, failure: StartFailure): string {
  switch (failure) {
    case "no-audio":
      return t("transcribeFailed_no-audio");
    case "engine-unavailable":
      return t("transcribeFailed_engine-unavailable");
    case "model-missing":
      return t("transcribeFailed_model-missing");
    case "engine-failed":
      return t("transcribeFailed_engine-failed");
    case "write-failed":
      return t("transcribeFailed_write-failed");
    case "item-changed":
      return t("transcribeFailed_item-changed");
    case "decode-failed":
      return t("transcribeFailed_decode-failed");
    case "busy":
      return t("transcribeFailed_busy");
    default:
      return t("transcribeFailed_unknown");
  }
}

function percentOf(received: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((received / total) * 100)));
}

/**
 * The Transcribe action of one video, for the Library card, the Library row, the Library detail
 * page and the editor. It shows what `useTranscribeControl` decides: nothing with the flag off or
 * without local media, "Transcribe" when a job can start, the download offer when the speech
 * model is missing, progress with a Cancel while a job runs, and a non-clickable "Transcribed"
 * badge once the video has a transcript. A click never reaches the card or row around it.
 */
export function TranscribeButton({
  item,
  variant,
  ui,
}: TranscribeButtonProps): React.JSX.Element | null {
  const control = useTranscribeControl(item);
  return <TranscribeButtonView control={control} variant={variant} ui={ui} />;
}

interface ViewProps {
  control: TranscribeControl;
  variant: TranscribeButtonVariant;
  ui?: UiAreaProps;
}

function TranscribeButtonView({ control, variant, ui }: ViewProps): React.JSX.Element | null {
  const t = useTranslations("transcription");
  const { state } = control;
  const [offerOpen, setOfferOpen] = useState(false);
  const iconSize = ICON_SIZE[variant];
  const showLabel = variant === "detail" || variant === "editor";

  // The offer belongs to the "needs a model" state: once the download has started (or the
  // model arrived some other way) it goes away, and never comes back on its own.
  useEffect(() => {
    if (state.kind !== "needs-model") setOfferOpen(false);
  }, [state.kind]);

  if (state.kind === "hidden" || state.kind === "unavailable" || state.kind === "loading") {
    return null;
  }

  const rootProps = {
    ...ui,
    className: styles.root,
    "data-variant": variant,
    "data-state": state.kind,
    // The card and the row open the item on a click; nothing in here may do that.
    onClick: (e: React.MouseEvent) => e.stopPropagation(),
  };

  if (state.kind === "done") {
    const label = t("transcribed");
    return (
      <span {...rootProps}>
        <span className={styles.badge} title={label} data-testid="transcribe-done">
          <Check size={iconSize} strokeWidth={2} aria-hidden />
          <span className={showLabel ? styles.label : styles.visuallyHidden}>{label}</span>
        </span>
      </span>
    );
  }

  if (state.kind === "running") {
    const label = runningLabel(t, state);
    return (
      <span {...rootProps}>
        <span
          className={styles.progress}
          role="status"
          title={label}
          data-testid="transcribe-progress"
        >
          <Loader2 size={iconSize} strokeWidth={1.8} className={styles.spinner} aria-hidden />
          <span className={styles.progressText}>{label}</span>
        </span>
        <button
          type="button"
          className={styles.cancel}
          onClick={control.cancel}
          title={t("transcribeCancel")}
          aria-label={t("transcribeCancel")}
        >
          <X size={iconSize - 2} strokeWidth={2} aria-hidden />
        </button>
      </span>
    );
  }

  if (state.kind === "model-downloading") {
    const model = control.offer.status?.models.find(
      (m) => m.id === control.offer.status?.defaultModelId,
    );
    const label =
      model?.status.state === "downloading" && model.status.totalBytes > 0
        ? t("transcribeDownloadingModelPercent", {
            percent: percentOf(model.status.receivedBytes, model.status.totalBytes),
          })
        : t("transcribeDownloadingModel");
    return (
      <span {...rootProps}>
        <button type="button" className={styles.button} disabled title={label} aria-label={label}>
          <Loader2 size={iconSize} strokeWidth={1.8} className={styles.spinner} aria-hidden />
          {showLabel && <span className={styles.label}>{label}</span>}
        </button>
      </span>
    );
  }

  if (state.kind === "busy-elsewhere") {
    const hint = t("transcribeBusy");
    return (
      <span {...rootProps}>
        <button
          type="button"
          className={styles.button}
          disabled
          title={hint}
          aria-label={`${t("transcribe")}. ${hint}`}
        >
          <Captions size={iconSize} strokeWidth={1.8} aria-hidden />
          {showLabel && <span className={styles.label}>{t("transcribe")}</span>}
        </button>
      </span>
    );
  }

  // idle, needs-model, failed, stale, invalid: a button that does something.
  const label = state.kind === "stale" ? t("transcribeAgain") : t("transcribe");
  const hint = hintOf(t, state);
  const onClick = (): void => {
    if (state.kind === "needs-model") setOfferOpen(true);
    else void control.start();
  };
  return (
    <span {...rootProps}>
      <button
        type="button"
        className={styles.button}
        onClick={onClick}
        title={hint ?? label}
        aria-label={hint && !showLabel ? `${label}. ${hint}` : label}
        data-failed={state.kind === "failed" || undefined}
      >
        <Captions size={iconSize} strokeWidth={1.8} aria-hidden />
        {showLabel && <span className={styles.label}>{label}</span>}
      </button>
      {hint && showLabel && (
        <span className={styles.hint} role="status">
          {hint}
        </span>
      )}
      {offerOpen && state.kind === "needs-model" && (
        <TranscribeModelDialog
          control={control}
          ui={dialogArea(variant)}
          onClose={() => setOfferOpen(false)}
        />
      )}
    </span>
  );
}

function runningLabel(
  t: Translator<"transcription">,
  state: Extract<TranscribeControlState, { kind: "running" }>,
): string {
  if (state.phase === "starting") return t("transcribeStarting");
  if (state.segmentsTotal > 0) {
    return t("transcribeProgress", { done: state.segmentsDone, total: state.segmentsTotal });
  }
  return t("transcribePreparing");
}

function hintOf(t: Translator<"transcription">, state: TranscribeControlState): string | null {
  if (state.kind === "failed") return failureText(t, state.failure as StartFailure);
  if (state.kind === "invalid") return t("transcribeInvalidHint");
  return null;
}

/**
 * The download offer a Transcribe click opens when the speech model is missing. Its download
 * button only starts the download and the dialog goes away with the state it belongs to; closing
 * it never blocks anything.
 */
function TranscribeModelDialog({
  control,
  ui,
  onClose,
}: {
  control: TranscribeControl;
  ui: UiAreaProps;
  onClose: () => void;
}): React.JSX.Element | null {
  const t = useTranslations("transcription");
  const { status, failures, refresh, download, cancel, remove } = control.offer;

  // Another control may have started or finished a download since this one last read.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (!status) return null;
  const model = status.models.find((m) => m.id === status.defaultModelId) ?? null;

  return (
    <ModalOverlay onCancel={onClose} labelledBy="transcribe-dialog-title">
      <div {...ui} className={styles.dialog}>
        <ModalTitle id="transcribe-dialog-title">{t("transcribeDialogTitle")}</ModalTitle>
        <ModalText>{t("transcribeDialogBody")}</ModalText>
        <ModelOffer
          model={model}
          availability={status.availability}
          failure={model ? failures[model.id] : undefined}
          downloadLabel={t("downloadInBackground")}
          onDownload={() => model && void download(model.id)}
          onCancel={() => model && void cancel(model.id)}
          onRemove={() => model && void remove(model.id)}
        />
        <ModalActions>
          <ModalButton variant="ghost" onClick={onClose}>
            {t("transcribeDialogClose")}
          </ModalButton>
        </ModalActions>
      </div>
    </ModalOverlay>
  );
}
