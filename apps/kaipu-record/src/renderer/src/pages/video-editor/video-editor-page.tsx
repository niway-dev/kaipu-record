import { useEffect } from "react";
import { Navigate, useLocation } from "react-router-dom";
import styles from "./video-editor-page.module.css";

export interface VideoEditorSource {
  id: string;
  title: string;
  durationSeconds: number;
}

function isVideoEditorSource(value: unknown): value is VideoEditorSource {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.durationSeconds === "number" &&
    v.durationSeconds > 0
  );
}

export function VideoEditorPage(): React.JSX.Element {
  const location = useLocation();
  const source = location.state;
  if (!isVideoEditorSource(source)) return <Navigate to="/library" replace />;
  // Remount per navigation so a different recording never inherits editor state.
  return <VideoEditor key={location.key} source={source} />;
}

function VideoEditor({ source }: { source: VideoEditorSource }): React.JSX.Element {
  useEffect(() => {
    // Same window growth the screenshot editor uses; restored on unmount.
    window.electronAPI.setEditorWindowMode(true);
    return () => window.electronAPI.setEditorWindowMode(false);
  }, []);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h1 className={styles.title}>{source.title}</h1>
      </header>
      <main className={styles.stage}>{/* preview lands in Task 5 */}</main>
      <footer className={styles.timeline}>{/* timeline lands in plan 02 */}</footer>
    </div>
  );
}
