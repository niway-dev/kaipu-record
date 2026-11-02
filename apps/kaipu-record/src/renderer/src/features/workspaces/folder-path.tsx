import React from "react";
import styles from "./folder-path.module.css";

/**
 * A folder shown as text, never as an input: monospace, selectable for copying, the full path
 * in the tooltip. A path too long for the row is cut in the MIDDLE with an ellipsis: the head
 * shrinks and the last segment (the folder's own name) always stays. Both halves are plain
 * text in order, so selecting and copying yields the whole path.
 */
export function FolderPath({
  path,
  bad = false,
}: {
  path: string;
  /** The folder cannot be used (it exists and is not empty, or its drive is gone). */
  bad?: boolean;
}): React.JSX.Element {
  const cut = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  // Split before the last separator, so the tail reads "/Kaipu Record — Work".
  const head = cut > 0 ? path.slice(0, cut) : "";
  const tail = cut > 0 ? path.slice(cut) : path;
  return (
    <span className={styles.path} title={path} data-bad={bad || undefined}>
      {head && <span className={styles.head}>{head}</span>}
      <span className={styles.tail}>{tail}</span>
    </span>
  );
}
