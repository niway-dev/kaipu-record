import { Camera, ImagePlay, Video } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { LibraryKind } from "@renderer/features/library/types";
import styles from "./kind-badge.module.css";

const KIND_META: Record<
  LibraryKind,
  { labelKey: "kindRecording" | "kindScreenshot" | "kindGif"; Icon: typeof Video }
> = {
  recording: { labelKey: "kindRecording", Icon: Video },
  screenshot: { labelKey: "kindScreenshot", Icon: Camera },
  gif: { labelKey: "kindGif", Icon: ImagePlay },
};

/**
 * A small overlay pill marking whether a library item is a recording or a
 * screenshot. Sits on the poster's top-left; the storage state stays on the
 * top-right.
 */
export function KindBadge({ kind }: { kind: LibraryKind }): React.JSX.Element {
  const t = useTranslations("library");
  const { labelKey, Icon } = KIND_META[kind];
  return (
    <span className={styles.badge} data-kind={kind}>
      <Icon size={12} strokeWidth={2} />
      {t(labelKey)}
    </span>
  );
}
