import { ChevronDown, ChevronUp, Copy, X } from "lucide-react";
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTranslations, type Translator } from "@kaipu/i18n";
import { Button } from "@kaipu/ui";
import { reportError } from "@renderer/features/analytics";
import { ModelOffer } from "@renderer/features/transcription/model-offer";
import { useTranscribeControl } from "@renderer/features/transcription/use-transcribe-control";
import { useTranscript } from "@renderer/features/transcription/use-transcript";
import { useTranscriptionStatus } from "@renderer/features/transcription/use-transcription-status";
import { uiArea } from "@renderer/lib/ui-area";
import type { ProjectionAudio } from "./transcript-projection";
import { projectTranscript } from "./transcript-projection";
import type { LayoutEntry } from "./timeline";
import { groupParagraphs } from "./transcript-paragraphs";
import { occurrenceAtTime, searchOccurrences } from "./transcript-lookup";
import {
  buildRows,
  formatStamp,
  panelView,
  transcriptText,
  unresolvedMarks,
  viewState,
  type TranscriptRow,
  type UnresolvedMark,
} from "./transcript-panel-model";
import styles from "./transcript-panel.module.css";

/** After the user scrolls the list by hand, playback stops pulling the current word into view. */
const FOLLOW_PAUSE_MS = 4000;
const COPIED_MS = 1500;

export interface TranscriptPanelProps {
  /** The library item and its recording: what the transcript file and the job are keyed by. */
  itemId: string;
  assetId: string;
  mediaUrl: string;
  durationMs: number;
  /** The edited timeline, so the panel shows only the words that play. */
  layout: LayoutEntry[];
  audioMuted: boolean;
  mutedRanges: ProjectionAudio["mutedRanges"];
  /** `false`: the recording has no audio track. `null`: not known yet. */
  hasAudio: boolean | null;
  /** Move the playhead (timeline seconds). */
  onSeek(timelineSeconds: number): void;
  /** The playhead's moving clock; called at animation-frame rate while playing. */
  subscribeTime(listener: (t: number) => void): () => void;
  /** The playhead right now (timeline seconds). */
  readTime(): number;
  onClose(): void;
}

/**
 * The editor's right column while Transcript is open (NIW2-818, ADR 0063): the words of the
 * EDITED video, in paragraphs with their start time. A click on a word or a time moves the
 * playhead; the word that is playing is highlighted without re-rendering the list (the
 * highlight is an attribute set on one element from the playhead's clock), and a 60-minute
 * transcript is a few hundred paragraphs with one delegated click handler, not a handler per
 * word.
 */
export function TranscriptPanel({
  itemId,
  assetId,
  mediaUrl,
  durationMs,
  layout,
  audioMuted,
  mutedRanges,
  hasAudio,
  onSeek,
  subscribeTime,
  readTime,
  onClose,
}: TranscriptPanelProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const transcript = useTranscript(itemId);
  const control = useTranscribeControl({
    id: itemId,
    assetId,
    mediaUrl,
    durationMs,
    // The transcript file is read by `useTranscript`; the control only drives the job.
    transcribedAt: null,
  });
  const [offerOpen, setOfferOpen] = useState(false);

  const file = transcript.transcript;
  const view = panelView({
    transcript: {
      state: transcript.state,
      stale: transcript.stale,
      unresolvedCount: file?.unresolved.length ?? 0,
    },
    control: control.state,
    hasAudio,
  });

  const occurrences = useMemo(
    () => (file ? projectTranscript(file.words, layout, { audioMuted, mutedRanges }) : []),
    [file, layout, audioMuted, mutedRanges],
  );
  const paragraphs = useMemo(() => groupParagraphs(occurrences), [occurrences]);
  const marks = useMemo(
    () => (file ? unresolvedMarks(file.unresolved, layout) : []),
    [file, layout],
  );
  const rows = useMemo(() => buildRows(paragraphs, marks), [paragraphs, marks]);

  const listRef = useRef<HTMLDivElement>(null);
  const wordEls = useRef<HTMLElement[]>([]);
  const lastUserScroll = useRef(0);

  // The word elements by occurrence index, rebuilt whenever the rows are.
  useLayoutEffect(() => {
    wordEls.current = listRef.current
      ? Array.from(listRef.current.querySelectorAll<HTMLElement>("[data-w]"))
      : [];
  }, [rows, view.kind]);

  const reveal = useCallback((el: HTMLElement | undefined, force: boolean): void => {
    const list = listRef.current;
    if (!el || !list) return;
    if (!force && Date.now() - lastUserScroll.current < FOLLOW_PAUSE_MS) return;
    const box = list.getBoundingClientRect();
    const at = el.getBoundingClientRect();
    if (at.top >= box.top && at.bottom <= box.bottom) return;
    el.scrollIntoView?.({ block: "center" });
  }, []);

  // The playing word: one attribute on one element, from the playhead's clock. Nothing in React
  // state changes per frame.
  useEffect(() => {
    if (occurrences.length === 0) return;
    // This render's elements: a cleanup must clear the ones its own effect marked.
    const els = wordEls.current;
    let current = -1;
    const apply = (time: number): void => {
      const next = occurrenceAtTime(occurrences, time);
      if (next === current) return;
      els[current]?.removeAttribute("data-current");
      const el = els[next];
      el?.setAttribute("data-current", "");
      current = next;
      reveal(el, false);
    };
    apply(readTime());
    const unsubscribe = subscribeTime(apply);
    return () => {
      unsubscribe();
      els[current]?.removeAttribute("data-current");
    };
  }, [occurrences, rows, subscribeTime, readTime, reveal]);

  // Search.
  const [query, setQuery] = useState("");
  const [matchPos, setMatchPos] = useState(0);
  const matches = useMemo(() => searchOccurrences(occurrences, query), [occurrences, query]);
  const position = matches.length === 0 ? 0 : Math.min(matchPos, matches.length - 1);
  useEffect(() => {
    const els = wordEls.current;
    for (const index of matches) els[index]?.setAttribute("data-match", "");
    const currentEl = els[matches[position]];
    currentEl?.setAttribute("data-match-current", "");
    reveal(currentEl, true);
    return () => {
      for (const index of matches) {
        els[index]?.removeAttribute("data-match");
        els[index]?.removeAttribute("data-match-current");
      }
    };
  }, [matches, position, rows, reveal]);

  const goToMatch = (next: number): void => {
    if (matches.length === 0) return;
    const at = (next + matches.length) % matches.length;
    setMatchPos(at);
    const occurrence = occurrences[matches[at]];
    if (occurrence) onSeek(occurrence.start);
  };

  // Copy.
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (copiedTimer.current) clearTimeout(copiedTimer.current);
    },
    [],
  );
  const copyAll = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(transcriptText(paragraphs));
    } catch (error) {
      reportError(t("transcriptCopyFailed"), error, { context: { phase: "copy-transcript" } });
      return;
    }
    setCopied(true);
    if (copiedTimer.current) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  // One handler for every word and every time stamp.
  const onListClick = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target = event.target as HTMLElement;
    const word = target.closest<HTMLElement>("[data-w]");
    if (word) {
      const occurrence = occurrences[Number(word.dataset.w)];
      if (occurrence) onSeek(occurrence.start);
      return;
    }
    const stamp = target.closest<HTMLElement>("[data-seek]");
    if (stamp) onSeek(Number(stamp.dataset.seek));
  };

  const transcribe = (): void => {
    // Without the model the first step is the offer, not a job that would be refused.
    if (control.state.kind === "needs-model") {
      setOfferOpen(true);
      return;
    }
    void control.start();
  };

  const showWords = view.kind === "words";
  return (
    <aside
      {...uiArea("editorVideo.transcriptPanel")}
      className={styles.panel}
      aria-label={t("transcriptTitle")}
      data-testid="transcript-panel"
      data-state={viewState(view)}
    >
      <div className={styles.header}>
        <h2 className={styles.title}>{t("transcriptTitle")}</h2>
        <button
          type="button"
          className={styles.close}
          aria-label={t("transcriptClose")}
          title={t("transcriptClose")}
          onClick={onClose}
        >
          <X size={14} />
        </button>
      </div>

      {view.kind === "loading" && <p className={styles.note}>{t("transcriptLoading")}</p>}

      {view.kind === "idle" && (
        <div className={styles.block}>
          <p className={styles.note}>{t("transcriptIdleBody")}</p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={transcribe}>
              {t("transcriptTranscribe")}
            </Button>
          </div>
        </div>
      )}

      {view.kind === "needsModel" && (
        <div className={styles.block}>
          <p className={styles.note}>{t("transcriptNeedsModelBody")}</p>
          {!offerOpen && (
            <div className={styles.actions}>
              <Button variant="primary" size="sm" onClick={() => setOfferOpen(true)}>
                {t("transcriptShowModel")}
              </Button>
            </div>
          )}
          {offerOpen && <ModelOfferHost />}
        </div>
      )}

      {view.kind === "downloading" && (
        <div className={styles.block}>
          <p className={styles.note}>{t("transcriptDownloadingBody")}</p>
          <ModelOfferHost />
        </div>
      )}

      {view.kind === "running" && (
        <div className={styles.block}>
          <p className={styles.note}>{phaseLabel(t, view.phase)}</p>
          <div
            className={styles.track}
            role="progressbar"
            aria-label={t("transcriptRunning")}
            aria-valuemin={0}
            aria-valuemax={view.segmentsTotal > 0 ? view.segmentsTotal : undefined}
            aria-valuenow={view.segmentsTotal > 0 ? view.segmentsDone : undefined}
            data-testid="transcript-progress"
          >
            <div
              className={styles.fill}
              data-indeterminate={view.segmentsTotal > 0 ? undefined : ""}
              style={
                view.segmentsTotal > 0
                  ? { width: `${Math.round((view.segmentsDone / view.segmentsTotal) * 100)}%` }
                  : undefined
              }
            />
          </div>
          {view.segmentsTotal > 0 && (
            <p className={styles.meta}>
              {t("transcriptProgress", { done: view.segmentsDone, total: view.segmentsTotal })}
            </p>
          )}
          <div className={styles.actions}>
            <Button variant="outline" size="sm" onClick={control.cancel}>
              {t("transcriptCancel")}
            </Button>
          </div>
        </div>
      )}

      {view.kind === "failed" && (
        <div className={styles.block}>
          <p className={styles.heading}>{t("transcriptFailedTitle")}</p>
          <p className={styles.error} role="alert">
            {view.reason === "invalid"
              ? t("transcriptInvalid")
              : t(`transcriptFailure_${view.reason}`)}
          </p>
          <div className={styles.actions}>
            <Button variant="primary" size="sm" onClick={transcribe}>
              {t("transcriptRetry")}
            </Button>
          </div>
        </div>
      )}

      {view.kind === "noAudio" && <p className={styles.note}>{t("transcriptNoAudio")}</p>}
      {view.kind === "unavailable" && <p className={styles.note}>{t("transcriptUnavailable")}</p>}
      {view.kind === "busy" && <p className={styles.note}>{t("transcriptBusy")}</p>}

      {showWords && (
        <>
          {view.stale && (
            <div className={styles.banner} role="status" data-testid="transcript-stale">
              <p className={styles.heading}>{t("transcriptStaleTitle")}</p>
              <p className={styles.note}>{t("transcriptStaleBody")}</p>
              {view.failure && (
                <p className={styles.error} role="alert">
                  {t(`transcriptFailure_${view.failure}`)}
                </p>
              )}
              <div className={styles.actions}>
                <Button variant="outline" size="sm" onClick={transcribe}>
                  {t("transcriptTranscribeAgain")}
                </Button>
              </div>
              {offerOpen && control.state.kind === "needs-model" && <ModelOfferHost />}
            </div>
          )}
          {view.unresolved && (
            <p className={styles.note} data-testid="transcript-unresolved-note">
              {t("transcriptUnresolvedNote")}
            </p>
          )}
          <div className={styles.tools}>
            <div className={styles.search}>
              <input
                type="search"
                className={styles.searchInput}
                value={query}
                placeholder={t("transcriptSearchPlaceholder")}
                aria-label={t("transcriptSearchLabel")}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setMatchPos(0);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  goToMatch(position + (event.shiftKey ? -1 : 1));
                }}
              />
              <span className={styles.count} aria-live="polite">
                {query.trim() === ""
                  ? ""
                  : matches.length === 0
                    ? t("transcriptSearchNone")
                    : t("transcriptSearchCount", { current: position + 1, total: matches.length })}
              </span>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t("transcriptSearchPrevious")}
                title={t("transcriptSearchPrevious")}
                disabled={matches.length === 0}
                onClick={() => goToMatch(position - 1)}
              >
                <ChevronUp size={14} />
              </button>
              <button
                type="button"
                className={styles.iconButton}
                aria-label={t("transcriptSearchNext")}
                title={t("transcriptSearchNext")}
                disabled={matches.length === 0}
                onClick={() => goToMatch(position + 1)}
              >
                <ChevronDown size={14} />
              </button>
            </div>
            <button
              type="button"
              className={styles.copy}
              disabled={occurrences.length === 0}
              onClick={() => void copyAll()}
            >
              <Copy size={13} />
              <span aria-live="polite">{copied ? t("transcriptCopied") : t("transcriptCopy")}</span>
            </button>
          </div>
          {occurrences.length === 0 && marks.length === 0 ? (
            <p className={styles.note}>{t("transcriptEmptyEdit")}</p>
          ) : (
            // Event delegation: one handler for the whole list. Words are spans without
            // handlers; the time stamps are real buttons, which is the keyboard's way in.
            <div
              ref={listRef}
              className={styles.list}
              data-testid="transcript-list"
              onClick={onListClick}
              onWheel={() => {
                lastUserScroll.current = Date.now();
              }}
              onTouchMove={() => {
                lastUserScroll.current = Date.now();
              }}
            >
              {rows.map((row) =>
                row.kind === "gap" ? (
                  <Gap key={row.id} mark={row.mark} label={t("transcriptUnresolvedMark")} />
                ) : (
                  <ParagraphView
                    key={row.paragraph.id}
                    row={row}
                    markLabel={t("transcriptUnresolvedMark")}
                    seekLabel={t("transcriptSeek", { time: formatStamp(row.paragraph.start) })}
                  />
                ),
              )}
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function phaseLabel(t: Translator<"videoEditor">, phase: string): string {
  switch (phase) {
    case "starting":
      return t("transcriptPhaseStarting");
    case "receiving-audio":
      return t("transcriptPhaseReceiving");
    case "writing":
      return t("transcriptPhaseWriting");
    default:
      return t("transcriptPhaseTranscribing");
  }
}

function Gap({ mark, label }: { mark: UnresolvedMark; label: string }): React.JSX.Element {
  return (
    <p className={styles.gapRow} data-testid="transcript-gap">
      <span className={styles.stamp} data-static>
        {formatStamp(mark.start)}
      </span>
      <span className={styles.gap}>[{label}]</span>
    </p>
  );
}

type ParagraphRow = Extract<TranscriptRow, { kind: "paragraph" }>;

const ParagraphView = memo(function ParagraphView({
  row,
  markLabel,
  seekLabel,
}: {
  row: ParagraphRow;
  markLabel: string;
  seekLabel: string;
}): React.JSX.Element {
  const { paragraph, firstIndex, marks } = row;
  const children: React.ReactNode[] = [];
  let nextMark = 0;
  paragraph.occurrences.forEach((occurrence, i) => {
    while (nextMark < marks.length && marks[nextMark].before <= i) {
      children.push(
        <span key={`m${nextMark}`} className={styles.gap}>
          [{markLabel}]{" "}
        </span>,
      );
      nextMark += 1;
    }
    children.push(
      <span key={`${occurrence.wordId}:${occurrence.start}`} data-w={firstIndex + i}>
        {occurrence.text}
      </span>,
      " ",
    );
  });
  for (; nextMark < marks.length; nextMark += 1) {
    children.push(
      <span key={`m${nextMark}`} className={styles.gap}>
        [{markLabel}]{" "}
      </span>,
    );
  }
  return (
    <p className={styles.paragraph}>
      <button
        type="button"
        className={styles.stamp}
        data-seek={paragraph.start}
        aria-label={seekLabel}
        title={seekLabel}
      >
        {formatStamp(paragraph.start)}
      </button>
      <span className={styles.words}>{children}</span>
    </p>
  );
});

/** The speech model's offer inside the panel: the same component Settings and onboarding use. */
function ModelOfferHost(): React.JSX.Element | null {
  const { status, failures, download, cancel, remove } = useTranscriptionStatus();
  if (!status) return null;
  const model = status.models.find((m) => m.id === status.defaultModelId) ?? null;
  return (
    <ModelOffer
      model={model}
      availability={status.availability}
      failure={model ? failures[model.id] : undefined}
      onDownload={() => model && void download(model.id)}
      onCancel={() => model && void cancel(model.id)}
      onRemove={() => model && void remove(model.id)}
    />
  );
}
