import React, { useState } from "react";
import type { ScreenSource } from "@shared/types/electron-api";
import { PermissionNotice } from "./permission-notice";
import styles from "./screen-source-selector.module.css";

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

/** Dumb screen/window picker. Sources are fetched by `useScreenSources`. */
export function ScreenSourceSelector({
  isOpen,
  sources,
  isLoading,
  error,
  isAccessGranted = true,
  currentSourceId,
  onClose,
  onSelectSource,
  onGrantAccess,
}: ScreenSourceSelectorProps): React.JSX.Element | null {
  const [selectedTab, setSelectedTab] = useState<"screens" | "windows">("screens");

  const handleSourceClick = (source: ScreenSource): void => {
    onSelectSource(source);
    onClose();
  };

  const handleOverlayClick = (e: React.MouseEvent): void => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!isOpen) return null;

  const screenSources = sources.filter((s) => s.type === "screen");
  const windowSources = sources.filter((s) => s.type === "window");
  const visible = selectedTab === "screens" ? screenSources : windowSources;

  return (
    <div className={styles.overlay} onClick={handleOverlayClick}>
      <div className={styles.modal}>
        <div className={styles.header}>
          <h3>Select a Screen or Window</h3>
          <button className={styles.closeButton} onClick={onClose}>
            ✕
          </button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tabButton} ${selectedTab === "screens" ? styles.tabButtonActive : ""}`}
            onClick={() => setSelectedTab("screens")}
          >
            Screens
          </button>
          <button
            className={`${styles.tabButton} ${selectedTab === "windows" ? styles.tabButtonActive : ""}`}
            onClick={() => setSelectedTab("windows")}
          >
            Windows
          </button>
        </div>

        <div className={styles.content}>
          {!isAccessGranted ? (
            <div className={styles.emptyState}>
              <PermissionNotice
                label="Screen Recording access is off"
                onOpenSettings={() => onGrantAccess?.()}
              />
            </div>
          ) : isLoading ? (
            <div className={styles.loadingState}>
              <div className={styles.spinner} />
              <p>Loading sources…</p>
            </div>
          ) : error ? (
            <div className={styles.emptyState}>
              <p>{error}</p>
            </div>
          ) : (
            <>
              <div className={styles.grid}>
                {visible.map((source) => (
                  <div
                    key={source.id}
                    className={[
                      styles.sourceItem,
                      source.id === currentSourceId ? styles.sourceItemActive : "",
                    ].join(" ")}
                    onClick={() => handleSourceClick(source)}
                  >
                    <img src={source.thumbnail} alt={source.name} />
                    <div className={styles.sourceNameOverlay}>
                      <div className={styles.sourceName}>{source.name}</div>
                    </div>
                  </div>
                ))}
              </div>
              {visible.length === 0 && (
                <div className={styles.emptyState}>
                  <p>No {selectedTab === "screens" ? "screens" : "windows"} found</p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
