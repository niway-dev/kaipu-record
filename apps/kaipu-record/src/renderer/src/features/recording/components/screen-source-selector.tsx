import React, { useState } from "react";
import { AppWindowMac, Monitor } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import {
  SourceGrid,
  SourcePicker,
  SourcePickerLoading,
  SourcePickerMessage,
  SourceThumbFallback,
  SourceThumbImage,
  SourceTile,
} from "@kaipu/ui";
import type { ScreenSource } from "@shared/types/electron-api";
import { PermissionNotice } from "./permission-notice";

/** The thumbnail, or a clean monitor/window icon when the capture came back blank
 *  (or the image fails to load) — never a broken <img>. */
function SourceThumbnail({ source }: { source: ScreenSource }): React.JSX.Element {
  const [failed, setFailed] = useState(false);
  const blank = !source.thumbnail || source.thumbnail.length < 64;
  if (blank || failed) {
    const Icon = source.type === "screen" ? Monitor : AppWindowMac;
    return (
      <SourceThumbFallback>
        <Icon size={30} strokeWidth={1.75} />
      </SourceThumbFallback>
    );
  }
  return (
    <SourceThumbImage src={source.thumbnail} alt={source.name} onError={() => setFailed(true)} />
  );
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

/** Dumb screen/window picker. The source list is provided by `useScreenSources`.
 *  The frame, tiles and states are `@kaipu/ui`; the tab state, the filtering by
 *  source type, the thumbnail fallback and the translations stay here. */
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
        <SourcePickerMessage>
          <PermissionNotice
            label={t("screenAccessOff")}
            onOpenSettings={() => props.onGrantAccess?.()}
          />
        </SourcePickerMessage>
      );
    }
    if (isLoading) {
      return (
        <SourcePickerLoading>
          <p>{t("loadingSources")}</p>
        </SourcePickerLoading>
      );
    }
    if (error) {
      return (
        <SourcePickerMessage>
          <p>{error}</p>
        </SourcePickerMessage>
      );
    }
    if (tiles.length === 0) {
      return (
        <SourcePickerMessage>
          <p>{kind === "screens" ? t("noScreens") : t("noWindows")}</p>
        </SourcePickerMessage>
      );
    }
    return (
      <SourceGrid>
        {tiles.map((source) => (
          <SourceTile
            key={source.id}
            thumbnail={<SourceThumbnail source={source} />}
            label={source.name}
            isActive={source.id === currentSourceId}
            onSelect={() => choose(source)}
          />
        ))}
      </SourceGrid>
    );
  })();

  return (
    <SourcePicker
      title={t("selectScreenOrWindow")}
      tabs={KINDS.map((k) => ({ id: k.id, label: t(k.labelKey) }))}
      activeTab={kind}
      onTabChange={(id) => setKind(id as SourceKind)}
      onClose={props.onClose}
    >
      {panel}
    </SourcePicker>
  );
}
