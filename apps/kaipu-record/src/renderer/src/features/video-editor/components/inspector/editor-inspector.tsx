/**
 * The right-hand properties column. Picks the one panel that applies to the current
 * selection — never shows controls that do not apply (UI spec § 7). Every selection
 * kind resolves to a panel now (zoom, redaction, annotation — plus the annotation
 * defaults while a drawing tool is armed), and everything else falls through to the
 * Detection panel, so the column is never empty. Clip selections keep the timeline.
 */
import type { ReactNode } from "react";
import styles from "./editor-inspector.module.css";

export function EditorInspector({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <aside className={styles.column} data-testid="editor-inspector">
      {children}
    </aside>
  );
}
