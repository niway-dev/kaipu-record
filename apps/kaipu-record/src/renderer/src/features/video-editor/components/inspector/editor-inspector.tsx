/**
 * The right-hand properties column. Picks the one panel that applies to the current
 * selection — never shows controls that do not apply (UI spec § 7). Annotation and
 * clip selections keep their existing UI (floating OverlayOptions / timeline) and show
 * the Detection panel here, so the column is never empty.
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
