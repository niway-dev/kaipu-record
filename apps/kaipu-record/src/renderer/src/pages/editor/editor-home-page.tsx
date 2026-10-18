import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ChevronDown,
  ClipboardPaste,
  Film,
  ImageIcon,
  ImagePlus,
  Library,
  Play,
  SquareArrowOutUpRight,
} from "lucide-react";
import { ROUTES } from "@shared/routes";
import { KaipuLogo } from "@kaipu/brand";
import { useLocale, useTranslations } from "@kaipu/i18n";
import { useLocalLibrary } from "@renderer/features/library/hooks/use-local-library";
import { EditBadge } from "@renderer/features/library/components/edit-badge";
import { buildLineage, editBadge, type Lineage } from "@renderer/features/library/lineage";
import { formatDuration } from "@renderer/features/library/format";
import type { LibraryVideo } from "@renderer/features/library/types";
import { canOpenInEditor, useOpenInEditor } from "@renderer/features/editor/open-in-editor";
import {
  pasteShortcutLabel,
  usePasteToEditor,
} from "@renderer/features/editor/use-paste-to-editor";
import { useShortcutLabels } from "@renderer/features/shortcuts/use-shortcut-labels";
import {
  CONTINUE_ROWS,
  continueList,
  defaultTab,
  formatAgo,
  SHOW_OLDER_STEP,
  type ContinueEntry,
  type EditorTab,
} from "./editor-continue";
import styles from "./editor-page.module.css";

type Entry = ContinueEntry<LibraryVideo>;

/**
 * `/editor` with nothing open: start something new, or continue what you worked
 * on. Two tabs, Images and Videos. Each shows the last thing worked on as one
 * large card and a few rows under it; Show older adds more in place. Only items
 * opened or saved in an editor appear here, so it never turns into the Library.
 */
export function EditorHomePage(): React.JSX.Element {
  const t = useTranslations("editor");
  const { videos, isLoading } = useLocalLibrary();
  const editable = useMemo(() => videos.filter(canOpenInEditor), [videos]);
  const lineage = useMemo(() => buildLineage(videos), [videos]);
  const lists = useMemo(
    () => ({ images: continueList(editable, "images"), videos: continueList(editable, "videos") }),
    [editable],
  );

  // The tab follows the most recent activity until the user picks one.
  const [picked, setPicked] = useState<EditorTab | null>(null);
  const tab = picked ?? defaultTab(editable);
  const [shown, setShown] = useState(CONTINUE_ROWS);
  const pickTab = (next: EditorTab): void => {
    setPicked(next);
    setShown(CONTINUE_ROWS);
  };

  // ⌘V anywhere on the page opens the image editor on the clipboard image.
  const paste = usePasteToEditor();

  return (
    <div className={styles.home}>
      <div className={styles.homeHeader}>
        <div>
          <h1 className={styles.homeTitle}>{t("title")}</h1>
          <p className={styles.homeSubtitle}>
            {t(tab === "images" ? "subtitleImages" : "subtitleVideos")}
          </p>
        </div>
        <div className={styles.tabs} role="tablist" aria-label={t("tabsLabel")}>
          {(["images", "videos"] as const).map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={styles.tab}
              onClick={() => pickTab(id)}
            >
              {id === "images" ? <ImageIcon size={16} /> : <Film size={16} />}
              {t(id === "images" ? "tabImages" : "tabVideos")}
              <span className={styles.tabCount}>{lists[id].length}</span>
            </button>
          ))}
        </div>
      </div>

      {tab === "images" && <StartImage onPaste={() => void paste.pasteFromClipboard()} />}
      {tab === "images" && paste.empty && (
        <p role="alert" className={styles.homeAlert}>
          {t("pasteEmpty")}
        </p>
      )}

      {!isLoading && (
        <ContinueSection
          tab={tab}
          entries={lists[tab]}
          lineage={lineage}
          shown={shown}
          onShowOlder={() => setShown((n) => n + SHOW_OLDER_STEP)}
          onShowLess={() => setShown(CONTINUE_ROWS)}
        />
      )}
    </div>
  );
}

/** The Images tab's way to start: paste an image (New image), or pick one from the Library. */
function StartImage({ onPaste }: { onPaste: () => void }): React.JSX.Element {
  const t = useTranslations("editor");
  const clip = useClipboardImageSize();
  return (
    <section className={styles.start}>
      <span className={styles.startIcon} aria-hidden>
        <ImagePlus size={24} />
      </span>
      <div className={styles.startText}>
        <h2 className={styles.startTitle}>{t("startTitle")}</h2>
        <p className={styles.startBody}>{t("startBody", { shortcut: pasteShortcutLabel() })}</p>
        {clip && (
          <div className={styles.clipPeek}>
            <span className={styles.clipThumb} aria-hidden>
              <ClipboardPaste size={15} />
            </span>
            <span className={styles.clipText}>
              <span className={styles.clipTitle}>{t("clipboardImage")}</span>
              <span className={styles.clipMeta}>
                {t("clipboardSize", { width: clip.width, height: clip.height })}
              </span>
            </span>
            <button type="button" className={styles.clipPaste} onClick={onPaste}>
              {t("pasteNow", { shortcut: pasteShortcutLabel() })}
            </button>
          </div>
        )}
      </div>
      <div className={styles.startActions}>
        <Link to={ROUTES.editorNew} className={styles.primary} title={t("newTitle")}>
          <ImagePlus size={15} />
          {t("new")}
        </Link>
        <Link to={ROUTES.library} className={styles.secondary}>
          <Library size={15} />
          {t("chooseFromLibrary")}
        </Link>
      </div>
    </section>
  );
}

/**
 * The clipboard image's size, refreshed whenever the window regains focus (the
 * user copies elsewhere, then comes back). null when it holds no image.
 */
function useClipboardImageSize(): { width: number; height: number } | null {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let alive = true;
    const read = (): void => {
      void window.electronAPI
        .peekClipboardImage()
        .then((s) => alive && setSize(s))
        .catch(() => alive && setSize(null));
    };
    read();
    window.addEventListener("focus", read);
    return () => {
      alive = false;
      window.removeEventListener("focus", read);
    };
  }, []);
  return size;
}

function ContinueSection(props: {
  tab: EditorTab;
  entries: Entry[];
  lineage: Lineage;
  shown: number;
  onShowOlder: () => void;
  onShowLess: () => void;
}): React.JSX.Element {
  const t = useTranslations("editor");
  const { tab, entries, lineage, shown } = props;
  if (entries.length === 0) return <EmptyContinue tab={tab} />;

  const [hero, ...rest] = entries;
  const rows = rest.slice(0, shown);
  const hidden = rest.length - rows.length;
  return (
    <section className={styles.continue}>
      <div className={styles.continueHeader}>
        <h2 className={styles.continueTitle}>{t("continueTitle")}</h2>
        <span className={styles.continueCaption}>
          {t(tab === "images" ? "continueImages" : "continueVideos")}
        </span>
        {tab === "videos" && (
          <Link to={ROUTES.library} className={styles.continueLink}>
            <Library size={14} />
            {t("chooseFromLibrary")}
          </Link>
        )}
      </div>
      <HeroCard entry={hero} lineage={lineage} />
      <ul className={styles.rows}>
        {rows.map((entry) => (
          <ContinueRow key={entry.item.assetId} entry={entry} lineage={lineage} />
        ))}
      </ul>
      {hidden > 0 ? (
        <button type="button" className={styles.showMore} onClick={props.onShowOlder}>
          {t("showOlder", { count: hidden })}
          <ChevronDown size={14} />
        </button>
      ) : rest.length > CONTINUE_ROWS ? (
        <button type="button" className={styles.showMore} onClick={props.onShowLess}>
          {t("showLess")}
          <ChevronDown size={14} className={styles.flipped} />
        </button>
      ) : null}
    </section>
  );
}

function useActivityLabel(): (entry: Entry) => string {
  const t = useTranslations("editor");
  const locale = useLocale();
  const now = Date.now();
  const key = {
    edited: "activityEdited",
    saved: "activitySaved",
    opened: "activityOpened",
  } as const;
  return (entry) =>
    t(key[entry.activity.label], { when: formatAgo(entry.activity.at, now, locale) });
}

function Thumb({ item, large }: { item: LibraryVideo; large?: boolean }): React.JSX.Element {
  return (
    <span className={large ? styles.heroThumb : styles.rowThumb}>
      {item.thumbnailUrl ? <img src={item.thumbnailUrl} alt="" /> : null}
      {item.kind !== "screenshot" && item.durationSeconds > 0 && (
        <span className={styles.duration}>{formatDuration(item.durationSeconds)}</span>
      )}
    </span>
  );
}

/** Open (images: a flat PNG, nothing to resume) or Resume (videos: the edit session). */
function OpenAction({
  item,
  primary,
}: {
  item: LibraryVideo;
  primary?: boolean;
}): React.JSX.Element {
  const t = useTranslations("editor");
  const { openItem } = useOpenInEditor();
  const isImage = item.kind === "screenshot";
  return (
    <button
      type="button"
      className={primary ? styles.primary : styles.rowAction}
      onClick={() => openItem(item)}
      aria-label={t(isImage ? "openItem" : "resumeItem", { title: item.title })}
    >
      {isImage ? <SquareArrowOutUpRight size={14} /> : <Play size={13} />}
      {t(isImage ? "open" : "resume")}
    </button>
  );
}

function HeroCard({ entry, lineage }: { entry: Entry; lineage: Lineage }): React.JSX.Element {
  const t = useTranslations("editor");
  const label = useActivityLabel();
  return (
    <div className={styles.hero}>
      <Thumb item={entry.item} large />
      <div className={styles.heroText}>
        <span className={styles.eyebrow}>{t("lastWorkedOn")}</span>
        <span className={styles.heroTitle}>{entry.item.title}</span>
        <span className={styles.heroMeta}>
          {label(entry)}
          <EditBadge state={editBadge(entry.item, lineage)} />
        </span>
      </div>
      <OpenAction item={entry.item} primary />
    </div>
  );
}

function ContinueRow({ entry, lineage }: { entry: Entry; lineage: Lineage }): React.JSX.Element {
  const label = useActivityLabel();
  return (
    <li className={styles.continueRow}>
      <Thumb item={entry.item} />
      <span className={styles.rowText}>
        <span className={styles.rowTitle}>{entry.item.title}</span>
        <span className={styles.rowMeta}>{label(entry)}</span>
      </span>
      <EditBadge state={editBadge(entry.item, lineage)} />
      <OpenAction item={entry.item} />
    </li>
  );
}

function EmptyContinue({ tab }: { tab: EditorTab }): React.JSX.Element {
  const t = useTranslations("editor");
  const shortcuts = useShortcutLabels();
  return (
    <section className={styles.emptyContinue}>
      <span className={styles.emptyMark} aria-hidden>
        <KaipuLogo use="product" size={64} />
      </span>
      <div>
        <h2 className={styles.emptyTitle}>{t("emptyTitle")}</h2>
        <p className={styles.emptyBody}>{t(tab === "images" ? "emptyImages" : "emptyVideos")}</p>
        {tab === "images" && shortcuts && (
          <p className={styles.emptyHint}>
            <kbd className={styles.kbd}>{shortcuts.captureScreenshot}</kbd>
            {t("emptyCaptureHint")}
          </p>
        )}
        {tab === "videos" && (
          <Link to={ROUTES.library} className={styles.secondary}>
            <Library size={15} />
            {t("chooseFromLibrary")}
          </Link>
        )}
      </div>
    </section>
  );
}
