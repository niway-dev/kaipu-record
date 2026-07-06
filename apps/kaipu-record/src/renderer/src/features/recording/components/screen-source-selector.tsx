import React, { useState } from "react";
import { AppWindowMac, Monitor } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { ScreenSource } from "@shared/types/electron-api";
import { PermissionNotice } from "./permission-notice";
import styles from "./screen-source-selector.module.css";

/** The thumbnail, or a clean monitor/window icon when the capture came back blank
 *  (or the image fails to load) — never a broken <img>. */
function SourceThumbnail({ source }: { source: ScreenSource }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const blank = !source.thumbnail || source.thumbnail.length < 64;
  if (blank || failed) {
    const Icon = source.type === "screen" ? Monitor : AppWindowMac;
    return (
      <div className={styles.thumbFallback} aria-hidden>
        <Icon size={30} strokeWidth={1.75} />
      </div>
    );
  }
  return <img src={source.thumbnail} alt={source.name} onError={() => setFailed(true)} />;
}

type SourceKind = "screens" | "windows";

const KINDS: {
  id: SourceKind;
  labelKey: "screensTab" | "windowsTab";
  match: ScreenSource["type"];
}[] = [
  { id: "screens", labelKey: "screensTab", match: "screen" },
  { id: "windows", labelKey: "windowsTab", match: "window" },
];

interface ScreenSourceSelectorProps {
  isOpen: boolean;
  sources: ScreenSource[];
  isLoading: boolean;
  error?: string | null;
  isAccessGranted?: boolean;
  currentSourceId?: string;
  onClose: () => void;
  onSelectSource: (source: ScreenSource) => void;
  onGrantAccess?: () => void;
}

/** Dumb screen/window picker. The source list is provided by `useScreenSources`. */
export function ScreenSourceSelector(props: ScreenSourceSelectorProps): React.JSX.Element | null {
  const t = useTranslations("record");
  const { isOpen, sources, isLoading, error, isAccessGranted = true, currentSourceId } = props;
  const [kind, setKind] = useState<SourceKind>("screens");

  if (!isOpen) return null;

  const tab = KINDS.find((k) => k.id === kind) ?? KINDS[0];
  const tiles = sources.filter((s) => s.type === tab.match);

  const choose = (source: ScreenSource): void => {
    props.onSelectSource(source);
    props.onClose();
  };

  // Single source of truth for what fills the content area.
  const panel = ((): React.JSX.Element => {
    if (!isAccessGranted) {
      return (
        <div className={styles.placeholder}>
          <PermissionNotice
            label={t("screenAccessOff")}
            onOpenSettings={() => props.onGrantAccess?.()}
          />
        </div>
      );
    }
    if (isLoading) {
      return (
        <div className={styles.pending}>
          <div className={styles.loader} />
          <p>{t("loadingSources")}</p>
        </div>
      );
    }
    if (error) {
      return (
        <div className={styles.placeholder}>
          <p>{error}</p>
        </div>
      );
    }
    if (tiles.length === 0) {
      return (
        <div className={styles.placeholder}>
          <p>{kind === "screens" ? t("noScreens") : t("noWindows")}</p>
        </div>
      );
    }
    return (
      <div className={styles.grid}>
        {tiles.map((source) => (
          <div
            key={source.id}
            className={styles.tile}
            data-active={source.id === currentSourceId || undefined}
            onClick={() => choose(source)}
          >
            <SourceThumbnail source={source} />
            <div className={styles.tileLabel}>
              <div className={styles.tileLabelText}>{source.name}</div>
            </div>
          </div>
        ))}
      </div>
    );
  })();

  return (
    <div
      className={styles.overlay}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className={styles.modal}>
        <div className={styles.header}>
          <h3>{t("selectScreenOrWindow")}</h3>
          <button className={styles.closeButton} onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div className={styles.tabs}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={styles.tabButton}
              data-active={k.id === kind || undefined}
              onClick={() => setKind(k.id)}
            >
              {t(k.labelKey)}
            </button>
          ))}
        </div>

        <div className={styles.content}>{panel}</div>
      </div>
    </div>
  );
}
