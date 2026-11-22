import { ImagePlus } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { ModalOverlay } from "@kaipu/ui";
import { absoluteDate, formatDuration } from "@renderer/features/library/format";
import { LibraryPicker, useLibraryPicker } from "@renderer/features/library/picker";
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

  // The unfiltered lists decide the counts; the picker applies the search to the open tab's, and
  // tells "empty" from "no match" by them: a query over nothing is still "empty".
  const allRecordings = useMemo(
    () => joinableRecordings(videos, openedAssetId, ""),
    [videos, openedAssetId],
  );
  const allScreenshots = useMemo(() => libraryScreenshots(videos, ""), [videos]);

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
          onAdd={() => addTo(item, kind, destination)}
          onPreview={setPointed}
        />
      </>
    );
  };

  const onRecordings = tab === "recordings";

  return (
    <ModalOverlay onCancel={onClose} labelledBy="add-from-library-title" size="xwide">
      <LibraryPicker
        {...uiArea("editorVideo.addFromLibrary")}
        data-testid="add-from-library-modal"
        testIdPrefix="add-from-library"
        items={onRecordings ? allRecordings : allScreenshots}
        loading={!loaded}
        // One search and one selection per tab: switching tabs must not carry a title typed for
        // the other kind, nor a card picked on Screenshots into the recordings list.
        query={queries[tab]}
        onQueryChange={(next) => setQueries((prev) => ({ ...prev, [tab]: next }))}
        selectedId={selectedIds[tab]}
        onSelectedIdChange={(next) => setSelectedIds((prev) => ({ ...prev, [tab]: next }))}
        // A screenshot has no stand-in: nothing is added until one is picked.
        autoSelectFirst={onRecordings}
        onActivate={onRecordings ? (video) => addTo(video, "recording", destination) : undefined}
      >
        <LibraryPicker.Header title={t("addFromLibraryTitle")} titleId="add-from-library-title">
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
              active={onRecordings}
              label={t("addFromLibraryTabRecordings")}
              count={loaded ? allRecordings.length : null}
              onSelect={() => setTab("recordings")}
            />
            <TabButton
              id="add-from-library-tab-screenshots"
              active={!onRecordings}
              label={t("addFromLibraryTabScreenshots")}
              count={loaded ? allScreenshots.length : null}
              onSelect={() => setTab("screenshots")}
            />
          </div>
          <LibraryPicker.Search
            placeholder={
              onRecordings ? t("addFromLibrarySearch") : t("addFromLibrarySearchScreenshots")
            }
          />
          <LibraryPicker.Close label={t("addFromLibraryClose")} onClick={onClose} />
        </LibraryPicker.Header>
        <div
          className={styles.panel}
          role="tabpanel"
          id={TAB_PANEL_ID}
          aria-labelledby={`add-from-library-tab-${tab}`}
        >
          <LibraryPicker.Body
            loading={
              <LibraryPicker.Note>
                {onRecordings ? t("addFromLibraryLoading") : t("addFromLibraryScreenshotsLoading")}
              </LibraryPicker.Note>
            }
            empty={
              <LibraryPicker.Note>
                {failed
                  ? t("addFromLibraryFailed")
                  : onRecordings
                    ? t("addFromLibraryEmpty")
                    : t("addFromLibraryScreenshotsEmpty")}
              </LibraryPicker.Note>
            }
            noMatch={(query) => (
              <LibraryPicker.Note
                title={
                  onRecordings
                    ? t("addFromLibraryNoMatch", { query })
                    : t("addFromLibraryScreenshotsNoMatch", { query })
                }
                hint={t("addFromLibraryNoMatchHint")}
              />
            )}
          >
            {onRecordings ? (
              <>
                <LibraryPicker.List
                  label={t("addFromLibraryTabRecordings")}
                  renderRow={(video) => (
                    <LibraryPicker.Row
                      item={video}
                      durationOnThumb
                      meta={[absoluteDate(video.createdAt, locale), resolutionLabel(video)].filter(
                        (line): line is string => line !== null,
                      )}
                    />
                  )}
                />
                <LibraryPicker.Preview>
                  {(selected) => (
                    <>
                      <div className={styles.titleLine}>
                        <h4 className={styles.detailTitle}>{selected.title}</h4>
                        <span className={styles.facts}>
                          {[formatDuration(selected.durationSeconds), resolutionLabel(selected)]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </div>
                      {placement(selected)}
                    </>
                  )}
                </LibraryPicker.Preview>
              </>
            ) : (
              <>
                <ScreenshotGrid
                  label={t("addFromLibraryTabScreenshots")}
                  openedAssetId={openedAssetId}
                />
                <ScreenshotSide placement={placement} />
              </>
            )}
          </LibraryPicker.Body>
        </div>
      </LibraryPicker>
    </ModalOverlay>
  );
}

/** The Screenshots tab's card grid: a custom list over the picker's items and selection. */
function ScreenshotGrid({
  label,
  openedAssetId,
}: {
  label: string;
  openedAssetId: string;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const { visible, selected, select } = useLibraryPicker();
  return (
    <ul className={styles.grid} aria-label={label}>
      {visible.map((shot) => {
        const resolution = resolutionLabel(shot);
        const isSelected = shot.assetId === selected?.assetId;
        return (
          <li key={shot.assetId}>
            <button
              type="button"
              className={styles.card}
              data-testid="add-from-library-screenshot"
              data-selected={isSelected ? "true" : undefined}
              aria-pressed={isSelected}
              aria-label={shot.title}
              onClick={() => select(shot)}
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
  );
}

/** The Screenshots tab's right column: the still, its facts, and the strip and Add for it. */
function ScreenshotSide({
  placement,
}: {
  placement(item: LibraryVideo): React.JSX.Element;
}): React.JSX.Element {
  const t = useTranslations("videoEditor");
  const locale = useLocale();
  const { selected } = useLibraryPicker();
  return (
    <LibraryPicker.Detail className={styles.shotSide}>
      {selected ? (
        <>
          <LibraryPicker.Frame>
            {selected.thumbnailUrl ? (
              <img
                className={styles.previewImage}
                data-testid="add-from-library-shot-preview"
                src={selected.thumbnailUrl}
                alt=""
              />
            ) : (
              <span className={styles.previewPlaceholder} aria-hidden>
                <ImagePlus size={28} />
              </span>
            )}
          </LibraryPicker.Frame>
          <div className={styles.titleLine}>
            <h4 className={styles.detailTitle}>{selected.title}</h4>
            <span className={styles.facts}>{absoluteDate(selected.createdAt, locale)}</span>
          </div>
          {placement(selected)}
        </>
      ) : (
        <p className={styles.pickHint}>{t("addFromLibraryPickScreenshot")}</p>
      )}
    </LibraryPicker.Detail>
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
