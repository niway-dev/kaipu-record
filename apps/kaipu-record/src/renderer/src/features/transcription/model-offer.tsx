import React, { useId, useState } from "react";
import { useTranslations, type Translator } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { formatSize } from "@renderer/features/library/format";
import type { UiAreaProps } from "@renderer/lib/ui-area";
import type {
  TranscriptionAvailability,
  TranscriptionModelInfo,
} from "@shared/types/transcription";
import styles from "./model-offer.module.css";
import type { ModelDownloadFailure } from "./use-transcription-status";

type OfferState = "missing" | "downloading" | "ready" | "failed" | "unavailable";

export interface ModelOfferProps {
  /**
   * The catalog entry to offer. `null` only when the engine is unavailable and main listed no
   * model to describe: the offer then shows just why it cannot run.
   */
  model: TranscriptionModelInfo | null;
  availability: TranscriptionAvailability;
  /** Why the last download failed, when this session knows; main's own message is not shown. */
  failure?: ModelDownloadFailure;
  /** Download, and Try again after a failure. */
  onDownload: () => void;
  onCancel: () => void;
  onRemove: () => void;
  /** The catalog area this offer is on the screen that hosts it (`uiArea("<screen>.<area>")`). */
  ui?: UiAreaProps;
}

function offerState(
  model: TranscriptionModelInfo | null,
  availability: TranscriptionAvailability,
): OfferState {
  if (availability.status === "unavailable" || !model) return "unavailable";
  return model.status.state;
}

function percentOf(receivedBytes: number, totalBytes: number): number {
  if (totalBytes <= 0) return 0;
  return Math.min(100, Math.max(0, Math.floor((receivedBytes / totalBytes) * 100)));
}

/**
 * The offer to install the speech model: what it is, what it costs in disk space, where it
 * goes, whose work it is, and the one action that fits the state it is in. It knows nothing
 * about the screen around it: Settings, onboarding and the Transcript panel all host it.
 */
export function ModelOffer({
  model,
  availability,
  failure,
  onDownload,
  onCancel,
  onRemove,
  ui,
}: ModelOfferProps): React.JSX.Element | null {
  const t = useTranslations("transcription");
  const titleId = useId();
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  if (availability.status === "available" && !model) return null;

  const state = offerState(model, availability);
  const size = model ? formatSize(model.sizeBytes) : "";

  return (
    <section
      {...ui}
      className={styles.offer}
      data-testid="model-offer"
      data-state={state}
      aria-labelledby={titleId}
    >
      <header className={styles.header}>
        <h4 id={titleId} className={styles.title}>
          {model?.label ?? t("fallbackTitle")}
        </h4>
        <span className={styles.badge} data-state={state}>
          {t(`badge_${state}`)}
        </span>
      </header>

      {state === "missing" && model && (
        <>
          <p className={styles.lead}>{t("intro")}</p>
          <Facts
            rows={[
              [t("sizeLabel"), size],
              [t("locationInstallsTo"), model.location, "path"],
            ]}
          />
          <License model={model} />
          <p className={styles.note} data-testid="model-offer-note">
            {t("note")}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={onDownload}>
              {t("download")}
            </Button>
          </div>
        </>
      )}

      {state === "downloading" && model?.status.state === "downloading" && (
        <>
          <div
            className={styles.track}
            role="progressbar"
            aria-label={t("progressLabel", { label: model.label })}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentOf(model.status.receivedBytes, model.status.totalBytes)}
            data-testid="model-offer-progress"
          >
            <div
              className={styles.fill}
              style={{
                width: `${percentOf(model.status.receivedBytes, model.status.totalBytes)}%`,
              }}
            />
          </div>
          <div className={styles.progressLine}>
            <span>
              {t("progressBytes", {
                received: formatSize(model.status.receivedBytes),
                total: formatSize(model.status.totalBytes),
              })}
            </span>
            <span>
              {t("progressPercent", {
                percent: percentOf(model.status.receivedBytes, model.status.totalBytes),
              })}
            </span>
          </div>
          <div className={styles.actions}>
            <Button variant="outline" size="sm" onClick={onCancel}>
              {t("cancel")}
            </Button>
          </div>
        </>
      )}

      {state === "ready" && model && (
        <>
          <p className={styles.lead}>{t("readyLead")}</p>
          <Facts
            rows={[
              [t("sizeInstalledLabel"), size],
              [t("locationInstalledIn"), model.location, "path"],
            ]}
          />
          <License model={model} />
          {confirmingRemove ? (
            <div className={styles.confirm} data-testid="model-offer-confirm">
              <p className={styles.confirmTitle}>
                {t("removeConfirmTitle", { label: model.label })}
              </p>
              <p className={styles.note}>{t("removeConfirmBody", { size })}</p>
              <div className={styles.actions}>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => {
                    setConfirmingRemove(false);
                    onRemove();
                  }}
                >
                  {t("removeConfirm")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingRemove(false)}>
                  {t("keep")}
                </Button>
              </div>
            </div>
          ) : (
            <div className={styles.actions}>
              <Button variant="outline" size="sm" onClick={() => setConfirmingRemove(true)}>
                {t("remove")}
              </Button>
            </div>
          )}
        </>
      )}

      {state === "failed" && model && (
        <>
          <p className={styles.error} role="alert">
            {failureText(t, failure, size)}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={onDownload}>
              {t("retry")}
            </Button>
          </div>
        </>
      )}

      {state === "unavailable" && availability.status === "unavailable" && (
        <p className={styles.lead}>{t(`unavailable_${availability.reason}`)}</p>
      )}
    </section>
  );
}

function failureText(
  t: Translator<"transcription">,
  failure: ModelDownloadFailure | undefined,
  size: string,
): string {
  switch (failure) {
    case "network":
      return t("failed_network");
    case "hash-mismatch":
    case "size-mismatch":
      return t("failed_corrupt");
    case "insufficient-disk-space":
      return t("failed_disk", { size });
    case "busy":
      return t("failed_busy");
    default:
      return t("failed_unknown");
  }
}

function Facts({
  rows,
}: {
  rows: ReadonlyArray<readonly [label: string, value: string, kind?: "path"]>;
}): React.JSX.Element {
  return (
    <dl className={styles.facts}>
      {rows.map(([label, value, kind]) => (
        <div key={label} className={styles.fact}>
          <dt>{label}</dt>
          <dd className={kind === "path" ? styles.path : undefined} title={value}>
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function License({ model }: { model: TranscriptionModelInfo }): React.JSX.Element {
  const t = useTranslations("transcription");
  return (
    <p className={styles.license}>
      {model.license.attribution}{" "}
      <a href={model.license.url} target="_blank" rel="noopener noreferrer">
        {t("licenseLink", { license: model.license.name })}
      </a>
    </p>
  );
}
