import React, { useState } from "react";
import type { ScreenSource } from "@shared/types/electron-api";
import { PermissionNotice } from "./permission-notice";
import styles from "./screen-source-selector.module.css";

type SourceKind = "screens" | "windows";

const KINDS: { id: SourceKind; label: string; match: ScreenSource["type"] }[] = [
  { id: "screens", label: "Screens", match: "screen" },
  { id: "windows", label: "Windows", match: "window" },
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
            label="Screen Recording access is off"
            onOpenSettings={() => props.onGrantAccess?.()}
          />
        </div>
      );
    }
    if (isLoading) {
      return (
        <div className={styles.pending}>
          <div className={styles.loader} />
          <p>Loading sources…</p>
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
          <p>No {tab.label.toLowerCase()} found</p>
        </div>
      );
    }
    return (
      <div className={styles.grid}>
        {tiles.map((source) => (
          <div
            key={source.id}
            className={
              source.id === currentSourceId ? `${styles.tile} ${styles.tileActive}` : styles.tile
            }
            onClick={() => choose(source)}
          >
            <img src={source.thumbnail} alt={source.name} />
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
          <h3>Select a Screen or Window</h3>
          <button className={styles.closeButton} onClick={props.onClose}>
            ✕
          </button>
        </div>

        <div className={styles.tabs}>
          {KINDS.map((k) => (
            <button
              key={k.id}
              className={
                k.id === kind ? `${styles.tabButton} ${styles.tabButtonActive}` : styles.tabButton
              }
              onClick={() => setKind(k.id)}
            >
              {k.label}
            </button>
          ))}
        </div>

        <div className={styles.content}>{panel}</div>
      </div>
    </div>
  );
}
