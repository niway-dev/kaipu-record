import { Film, ImagePlus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { ModalActions, ModalButton, ModalOverlay, ModalTitle } from "@kaipu/ui";
import { absoluteDate, formatDuration } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { uiArea } from "@renderer/lib/ui-area";
import {
  boundaryAfterClipAt,
  boundaryAtEnd,
  boundaryAtStart,
  joinableRecordings,
  libraryScreenshots,
  resolutionLabel,
} from "../add-from-library";
import type { LayoutEntry } from "../timeline";
import { AddFromLibraryPreview } from "./add-from-library-preview";
import { formatScrubTime } from "./timeline-geometry";
import styles from "./add-from-library-modal.module.css";

/** A boundary of the sequence a recording can be added at (the join's `{ index, time }`). */
export interface AddBoundary {
  index: number;
  time: number;
}

export interface AddFromLibraryModalProps {
  /** Every item the Library holds: the tabs keep the recordings and screenshots they offer. */
  videos: LibraryVideo[];
  /** The recording being edited: never offered as a recording, and its frames are tagged. */
  openedAssetId: string;
  /** The sequence as it is now, which decides where each Add lands. */
  layout: LayoutEntry[];
  /** The playhead, in timeline seconds. */
  playhead: number;
  /** False until the first read lands: nothing is said about "no recordings" before that. */
  loaded: boolean;
  /** The latest Library read failed: with no rows to show, say so instead of "empty". */
  failed?: boolean;
  /** Add this whole recording at `boundary` (one undo step). */
  onAddRecording(video: LibraryVideo, boundary: AddBoundary): void;
  /** Add this screenshot as a floating image at the playhead. */
  onAddScreenshot(video: LibraryVideo): void;
  onClose(): void;
}

type Tab = "recordings" | "screenshots";

/**
 * Add from Library (NIW2-790): the modal the transport's Add recording button opens. Recordings
 * are a list beside a quick-look preview with three ways to add (after the clip under the
 * playhead, at the start, at the end); screenshots are a card grid and a click adds one as a
 * floating image at the playhead. The modal stays open after an add, so several can follow.
 * Nothing in it is draggable: the Clips row's drop target (`timeline-strip`) is kept for
 * dragging recordings to reorder, which is a separate change.
 */
export function AddFromLibraryModal({
  videos,
  openedAssetId,
  layout,
  playhead,
  loaded,
  failed = false,
  onAddRecording,
  onAddScreenshot,
  onClose,
}: AddFromLibraryModalProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("recordings");
  // One search per tab: switching tabs must not carry a title typed for the other kind.
  const [queries, setQueries] = useState<Record<Tab, string>>({ recordings: "", screenshots: "" });
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null);
  const query = queries[tab];
  const needle = query.trim();

  // The unfiltered lists decide the counts and which empty state to show: a query over
  // nothing is still "empty", not "no match".
  const allRecordings = useMemo(
    () => joinableRecordings(videos, openedAssetId, ""),
    [videos, openedAssetId],
  );
  const allScreenshots = useMemo(() => libraryScreenshots(videos, ""), [videos]);
  const recordings = useMemo(
    () => joinableRecordings(videos, openedAssetId, queries.recordings),
    [videos, openedAssetId, queries.recordings],
  );
  const screenshots = useMemo(
    () => libraryScreenshots(videos, queries.screenshots),
    [videos, queries.screenshots],
  );
  // The selection is derived: with none picked yet, or the picked one filtered out or gone
  // from the Library, the first row stands in.
  const selected = recordings.find((video) => video.assetId === selectedAssetId) ?? recordings[0];

  const addAfterClip = (video: LibraryVideo): void =>
    onAddRecording(video, boundaryAfterClipAt(layout, playhead));

  const shown = tab === "recordings" ? recordings : screenshots;
  const all = tab === "recordings" ? allRecordings : allScreenshots;
  const showBody = loaded && shown.length > 0;

  return (
    <ModalOverlay onCancel={onClose} labelledBy="add-from-library-title" size="xwide">
      <div
        {...uiArea("editorVideo.addFromLibrary")}
        className={styles.sheet}
        data-testid="add-from-library-modal"
      >
        <header className={styles.header}>
          <div className={styles.title}>
            <ModalTitle id="add-from-library-title">{t("addFromLibraryTitle")}</ModalTitle>
          </div>
          <div className={styles.tabs} role="tablist">
            <TabButton
              active={tab === "recordings"}
              label={t("addFromLibraryTabRecordings")}
              count={loaded ? allRecordings.length : null}
              onSelect={() => setTab("recordings")}
            />
            <TabButton
              active={tab === "screenshots"}
              label={t("addFromLibraryTabScreenshots")}
              count={loaded ? allScreenshots.length : null}
              onSelect={() => setTab("screenshots")}
            />
          </div>
          <span className={styles.spacer} />
          <button
            type="button"
            className={styles.close}
            aria-label={t("addFromLibraryClose")}
            title={t("addFromLibraryClose")}
            onClick={onClose}
          >
            <X size={14} aria-hidden />
          </button>
        </header>
        <div className={styles.searchRow}>
          <label className={styles.search}>
            <Search size={14} aria-hidden className={styles.searchIcon} />
            <input
              type="search"
              className={styles.searchInput}
              value={query}
              aria-label={
                tab === "recordings"
                  ? t("addFromLibrarySearch")
                  : t("addFromLibrarySearchScreenshots")
              }
              placeholder={
                tab === "recordings"
                  ? t("addFromLibrarySearch")
                  : t("addFromLibrarySearchScreenshots")
              }
              onChange={(event) => setQueries((prev) => ({ ...prev, [tab]: event.target.value }))}
            />
          </label>
        </div>
        {!showBody ? (
          <div className={styles.note} role="status">
            {!loaded ? (
              <p>
                {tab === "recordings"
                  ? t("addFromLibraryLoading")
                  : t("addFromLibraryScreenshotsLoading")}
              </p>
            ) : all.length === 0 ? (
              <p>
                {failed
                  ? t("addFromLibraryFailed")
                  : tab === "recordings"
                    ? t("addFromLibraryEmpty")
                    : t("addFromLibraryScreenshotsEmpty")}
              </p>
            ) : (
              <>
                <p className={styles.noteTitle}>
                  {tab === "recordings"
                    ? t("addFromLibraryNoMatch", { query: needle })
                    : t("addFromLibraryScreenshotsNoMatch", { query: needle })}
                </p>
                <p className={styles.noteHint}>{t("addFromLibraryNoMatchHint")}</p>
              </>
            )}
          </div>
        ) : tab === "recordings" && selected ? (
          <div className={styles.split}>
            <ul className={styles.list} aria-label={t("addFromLibraryTabRecordings")}>
              {recordings.map((video) => {
                const resolution = resolutionLabel(video);
                const isSelected = video.assetId === selected.assetId;
                return (
                  <li key={video.assetId}>
                    <button
                      type="button"
                      className={styles.row}
                      data-testid="add-from-library-row"
                      data-selected={isSelected ? "true" : undefined}
                      aria-pressed={isSelected}
                      aria-label={video.title}
                      onClick={() => setSelectedAssetId(video.assetId)}
                      onDoubleClick={() => addAfterClip(video)}
                    >
                      <span className={styles.thumb}>
                        {video.thumbnailUrl ? (
                          <img className={styles.thumbImage} src={video.thumbnailUrl} alt="" />
                        ) : (
                          <span
                            className={styles.placeholder}
                            data-testid="add-from-library-placeholder"
                          >
                            <Film size={16} aria-hidden />
                          </span>
                        )}
                        <span className={styles.duration}>
                          {formatDuration(video.durationSeconds)}
                        </span>
                      </span>
                      <span className={styles.text}>
                        <span className={styles.name}>{video.title}</span>
                        <span className={styles.meta}>{absoluteDate(video.createdAt, locale)}</span>
                        {resolution && <span className={styles.meta}>{resolution}</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <section className={styles.detail}>
              <AddFromLibraryPreview video={selected} />
              <h4 className={styles.detailTitle}>{selected.title}</h4>
              <div className={styles.facts}>
                <span>{formatDuration(selected.durationSeconds)}</span>
                <span>{absoluteDate(selected.createdAt, locale)}</span>
                {resolutionLabel(selected) && <span>{resolutionLabel(selected)}</span>}
              </div>
              <div className={styles.actions}>
                <div className={styles.cta}>
                  <ModalActions>
                    <ModalButton variant="primary" onClick={() => addAfterClip(selected)}>
                      {t("addFromLibraryAddAfter")}
                    </ModalButton>
                  </ModalActions>
                </div>
                <div className={styles.alternatives}>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => onAddRecording(selected, boundaryAtStart())}
                  >
                    {t("addFromLibraryAddStart")}
                  </button>
                  <button
                    type="button"
                    className={styles.textButton}
                    onClick={() => onAddRecording(selected, boundaryAtEnd(layout))}
                  >
                    {t("addFromLibraryAddEnd")}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : (
          <ul className={styles.grid}>
            {screenshots.map((shot) => {
              const resolution = resolutionLabel(shot);
              return (
                <li key={shot.assetId}>
                  <button
                    type="button"
                    className={styles.card}
                    data-testid="add-from-library-screenshot"
                    aria-label={t("addFromLibraryRow", { title: shot.title })}
                    onClick={() => onAddScreenshot(shot)}
                  >
                    <span className={styles.poster}>
                      {shot.thumbnailUrl ? (
                        <img src={shot.thumbnailUrl} alt="" />
                      ) : (
                        <ImagePlus size={20} aria-hidden />
                      )}
                      {shot.sourceVideoAssetId === openedAssetId && (
                        <span className={styles.tag}>{t("addFromLibraryFromThisRecording")}</span>
                      )}
                    </span>
                    <span className={styles.cardTitle}>{shot.title}</span>
                    <span className={styles.cardMeta}>
                      {resolution
                        ? `${absoluteDate(shot.createdAt, locale)} · ${resolution}`
                        : absoluteDate(shot.createdAt, locale)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {tab === "screenshots" && (
          <footer className={styles.footer}>
            <span>
              {t("addFromLibraryAtPlayhead")} ·{" "}
              <span className={styles.mono}>{formatScrubTime(playhead)}</span>
            </span>
            <span className={styles.spacer} />
            <span>{t("addFromLibraryClickToAdd")}</span>
          </footer>
        )}
      </div>
    </ModalOverlay>
  );
}

function TabButton({
  active,
  label,
  count,
  onSelect,
}: {
  active: boolean;
  label: string;
  count: number | null;
  onSelect(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={styles.tab}
      data-active={active ? "true" : undefined}
      onClick={onSelect}
    >
      {label}
      {count !== null && (
        <>
          {" "}
          <small className={styles.count}>{count}</small>
        </>
      )}
    </button>
  );
}
