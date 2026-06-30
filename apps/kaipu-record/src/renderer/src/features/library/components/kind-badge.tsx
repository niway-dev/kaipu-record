import { Camera, Video } from "lucide-react";
import type { LibraryKind } from "@renderer/features/library/types";
import styles from "./kind-badge.module.css";

const KIND_META: Record<LibraryKind, { label: string; Icon: typeof Video }> = {
  recording: { label: "Recording", Icon: Video },
  screenshot: { label: "Screenshot", Icon: Camera },
};

/**
 * A small overlay pill marking whether a library item is a recording or a
 * screenshot. Sits on the poster's top-left; the storage state stays on the
 * top-right. Labels are English by product convention.
 */
export function KindBadge({ kind }: { kind: LibraryKind }): React.JSX.Element {
  const { label, Icon } = KIND_META[kind];
  return (
    <span className={styles.badge} data-kind={kind}>
      <Icon size={12} strokeWidth={2} />
      {label}
    </span>
  );
}
