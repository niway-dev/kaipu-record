import { Film, ImagePlus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { ModalOverlay, ModalTitle } from "@kaipu/ui";
import { absoluteDate, formatDuration } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { uiArea } from "@renderer/lib/ui-area";
import {
  boundaryForDestination,
  defaultDestination,
  destinationAllowed,
  FLOATING_IMAGE_SECONDS,
  joinableRecordings,
  libraryScreenshots,
  placementPreview,
  sameAsDestination,
  resolutionLabel,
  SEQUENCE_IMAGE_SECONDS,
  type LibraryDestination,
  type LibraryItemKind,
} from "../add-from-library";
import type { LayoutEntry } from "../timeline";
import { AddDestinationButton } from "./add-destination-button";
import { AddFromLibraryPreview } from "./add-from-library-preview";
import { PlacementCard } from "./placement-strip";
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
  /** Add this screenshot as a floating image at the playhead ("Over the video"). */
  onAddScreenshot(video: LibraryVideo): void;
  /** Add this screenshot to the sequence as an image slide at `boundary` (one undo step). */
  onAddScreenshotToSequence(video: LibraryVideo, boundary: AddBoundary): void;
  /** The tab to open on: the Captures panel's add opens the Screenshots one. */
  initialTab?: Tab;
  /** The asset id of the item to select when the modal opens, in `initialTab`'s list. */
  initialSelectedId?: string | null;
  /** The destination last used for each kind in this editor session: what the Add button starts at. */
  rememberedDestinations?: Partial<Record<LibraryItemKind, LibraryDestination>>;
  /** Called after each add with the destination used, so the page can keep it for the next open. */
  onRememberDestination?(kind: LibraryItemKind, destination: LibraryDestination): void;
  onClose(): void;
}

export type Tab = "recordings" | "screenshots";
const TABS: readonly Tab[] = ["recordings", "screenshots"];
const TAB_PANEL_ID = "add-from-library-panel";

/**
 * Add from Library (NIW2-790): the modal the transport's Add recording button opens. Recordings
 * are a list beside a quick-look preview; screenshots are a card grid, and a click selects one.
 * Either way ONE split button adds (NIW2-829): its big part adds at the chosen destination, its
 * arrow opens the menu of them (over the video, or the sequence before / after the clip under
 * the playhead, at the start, at the end), and a strip above it draws the result. The modal
 * stays open after an add, so several can follow.
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
  onAddScreenshotToSequence,
  initialTab = "recordings",
  initialSelectedId = null,
  rememberedDestinations,
  onRememberDestination,
  onClose,
}: AddFromLibraryModalProps): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>(initialTab);
  // One search per tab: switching tabs must not carry a title typed for the other kind.
  const [queries, setQueries] = useState<Record<Tab, string>>({ recordings: "", screenshots: "" });
  // One selection per tab, so a card picked on Screenshots does not move the recordings list.
  const [selectedIds, setSelectedIds] = useState<Record<Tab, string | null>>({
    recordings: initialTab === "recordings" ? initialSelectedId : null,
    screenshots: initialTab === "screenshots" ? initialSelectedId : null,
  });
  // The destination per kind: what the Add button does. It starts at the last one used.
  const [choices, setChoices] = useState<Partial<Record<LibraryItemKind, LibraryDestination>>>(
    rememberedDestinations ?? {},
  );
  // The menu option being pointed at: the big strip draws it until the menu closes.
  const [pointed, setPointed] = useState<LibraryDestination | null>(null);
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
  const selected =
    recordings.find((video) => video.assetId === selectedIds.recordings) ?? recordings[0];
  // A screenshot has no stand-in: nothing is added until one is picked.
  const selectedShot = screenshots.find((shot) => shot.assetId === selectedIds.screenshots);

  const kind: LibraryItemKind = tab === "recordings" ? "recording" : "screenshot";
  // A remembered or chosen destination the kind cannot take falls back to its default: a
  // recording can never end up on the disabled "Over the video".
  const chosen = choices[kind];
  const destination =
    chosen !== undefined && destinationAllowed(kind, chosen) ? chosen : defaultDestination(kind);

  const addTo = (
    item: LibraryVideo,
    itemKind: LibraryItemKind,
    where: LibraryDestination,
  ): void => {
    const boundary = boundaryForDestination(where, layout, playhead);
    if (itemKind === "recording") {
      if (boundary === null) return;
      onAddRecording(item, boundary);
    } else if (boundary === null) {
      onAddScreenshot(item);
    } else {
      onAddScreenshotToSequence(item, boundary);
    }
    onRememberDestination?.(itemKind, where);
  };
  const addSelected = (): void => {
    const item = tab === "recordings" ? selected : selectedShot;
    if (item) addTo(item, kind, destination);
  };
  // The strip and the Add button for the selected item. How long the item is decides what the
  // strip draws: a recording is its own length; a screenshot floats for the floating image's
  // default and takes the sequence image's when it joins the sequence.
  const placement = (item: LibraryVideo): React.JSX.Element => {
    const newSecondsFor = (where: LibraryDestination): number =>
      kind === "recording"
        ? item.durationSeconds
        : where === "over"
          ? FLOATING_IMAGE_SECONDS
          : SEQUENCE_IMAGE_SECONDS;
    const shown = pointed ?? destination;
    return (
      <>
        <PlacementCard
          preview={placementPreview(layout, playhead, shown, newSecondsFor(shown))}
          destination={shown}
          sameAs={sameAsDestination(shown, layout, playhead)}
          formatLength={(seconds) =>
            kind === "recording"
              ? formatDuration(seconds)
              : t("addFromLibrarySeconds", { seconds: Math.round(seconds * 10) / 10 })
          }
        />
        {/* Keyed by item and tab: another selection closes the menu. */}
        <AddDestinationButton
          key={`${tab}:${item.assetId}`}
          kind={kind}
          value={destination}
          onChange={(next) => setChoices((prev) => ({ ...prev, [kind]: next }))}
          onAdd={addSelected}
          onPreview={setPointed}
        />
      </>
    );
  };

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
          <div
            className={styles.tabs}
            role="tablist"
            aria-label={t("addFromLibraryTitle")}
            onKeyDown={(event) => {
              // WAI-ARIA tabs, as in the Timeline guide: arrows and Home/End move between tabs, and
              // only the selected one is a Tab stop.
              const index = TABS.indexOf(tab);
              const target =
                event.key === "ArrowRight"
                  ? TABS[(index + 1) % TABS.length]
                  : event.key === "ArrowLeft"
                    ? TABS[(index - 1 + TABS.length) % TABS.length]
                    : event.key === "Home"
                      ? TABS[0]
                      : event.key === "End"
                        ? TABS[TABS.length - 1]
                        : null;
              if (!target) return;
              event.preventDefault();
              setTab(target);
              document.getElementById(`add-from-library-tab-${target}`)?.focus();
            }}
          >
            <TabButton
              id="add-from-library-tab-recordings"
              active={tab === "recordings"}
              label={t("addFromLibraryTabRecordings")}
              count={loaded ? allRecordings.length : null}
              onSelect={() => setTab("recordings")}
            />
            <TabButton
              id="add-from-library-tab-screenshots"
              active={tab === "screenshots"}
              label={t("addFromLibraryTabScreenshots")}
              count={loaded ? allScreenshots.length : null}
              onSelect={() => setTab("screenshots")}
            />
          </div>
          <span className={styles.spacer} />
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
        <div
          className={styles.panel}
          role="tabpanel"
          id={TAB_PANEL_ID}
          aria-labelledby={`add-from-library-tab-${tab}`}
        >
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
                        onClick={() =>
                          setSelectedIds((prev) => ({ ...prev, recordings: video.assetId }))
                        }
                        onDoubleClick={() => addTo(video, "recording", destination)}
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
                          <span className={styles.meta}>
                            {absoluteDate(video.createdAt, locale)}
                          </span>
                          {resolution && <span className={styles.meta}>{resolution}</span>}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
              <section className={styles.detail}>
                <AddFromLibraryPreview video={selected} />
                <div className={styles.titleLine}>
                  <h4 className={styles.detailTitle}>{selected.title}</h4>
                  <span className={styles.facts}>
                    {[formatDuration(selected.durationSeconds), resolutionLabel(selected)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </div>
                {placement(selected)}
              </section>
            </div>
          ) : (
            <div className={styles.split}>
              <ul className={styles.grid} aria-label={t("addFromLibraryTabScreenshots")}>
                {screenshots.map((shot) => {
                  const resolution = resolutionLabel(shot);
                  const isSelected = shot.assetId === selectedShot?.assetId;
                  return (
                    <li key={shot.assetId}>
                      <button
                        type="button"
                        className={styles.card}
                        data-testid="add-from-library-screenshot"
                        data-selected={isSelected ? "true" : undefined}
                        aria-pressed={isSelected}
                        aria-label={shot.title}
                        onClick={() =>
                          setSelectedIds((prev) => ({ ...prev, screenshots: shot.assetId }))
                        }
                      >
                        <span className={styles.poster}>
                          {shot.thumbnailUrl ? (
                            <img src={shot.thumbnailUrl} alt="" />
                          ) : (
                            <ImagePlus size={20} aria-hidden />
                          )}
                          {shot.sourceVideoAssetId === openedAssetId && (
                            <span className={styles.tag}>
                              {t("addFromLibraryFromThisRecording")}
                            </span>
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
              <section className={`${styles.detail} ${styles.shotSide}`}>
                {selectedShot ? (
                  <>
                    <div className={styles.preview}>
                      <div className={styles.previewFrame}>
                        {selectedShot.thumbnailUrl ? (
                          <img
                            className={styles.previewImage}
                            data-testid="add-from-library-shot-preview"
                            src={selectedShot.thumbnailUrl}
                            alt=""
                          />
                        ) : (
                          <span className={styles.previewPlaceholder} aria-hidden>
                            <ImagePlus size={28} />
                          </span>
                        )}
                      </div>
                    </div>
                    <div className={styles.titleLine}>
                      <h4 className={styles.detailTitle}>{selectedShot.title}</h4>
                      <span className={styles.facts}>
                        {absoluteDate(selectedShot.createdAt, locale)}
                      </span>
                    </div>
                    {placement(selectedShot)}
                  </>
                ) : (
                  <p className={styles.pickHint}>{t("addFromLibraryPickScreenshot")}</p>
                )}
              </section>
            </div>
          )}
        </div>
      </div>
    </ModalOverlay>
  );
}

function TabButton({
  id,
  active,
  label,
  count,
  onSelect,
}: {
  id: string;
  active: boolean;
  label: string;
  count: number | null;
  onSelect(): void;
}): React.JSX.Element {
  return (
    <button
      type="button"
      role="tab"
      id={id}
      aria-controls={TAB_PANEL_ID}
      aria-selected={active}
      tabIndex={active ? 0 : -1}
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
