import React from "react";
import { Ellipsis, FileText, ImagePlus, Redo2, Undo2 } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import { uiArea } from "@renderer/lib/ui-area";
import type { AnnotationTool } from "../annotations/tools";
import { ADD_IMAGE_KEY, TOOL_KEYS, toolMeta } from "./tool-meta";
import { detectKeyPlatform } from "../overlay/overlay-keys";
import { undoKeyLabel, redoKeyLabel } from "./use-history-shortcuts";
import { MENU_DIVIDER, ToolbarMenu, type ToolbarMenuItem } from "./toolbar-menu";

/**
 * The compact toolbar's "•••" menu (mock B3): what no longer fits in the row. Export frame, Add
 * image and Select text first, then Undo and Redo, then PDF. Each item shows its key where it has
 * one (X, M, ⌘Z, ⇧⌘Z); PDF and Select text have none today.
 */
export function MoreMenu({
  canvasMode,
  textTool,
  onPick,
  onAddImage,
  undo,
  redo,
  pdf,
}: {
  canvasMode: boolean;
  textTool: boolean;
  onPick: (tool: AnnotationTool) => void;
  /** Opens the Add image menu; the item is listed only in canvas mode. */
  onAddImage: () => void;
  undo: { onSelect: () => void; disabled: boolean };
  redo: { onSelect: () => void; disabled: boolean };
  pdf: { onSelect: () => void; disabled: boolean };
}): React.JSX.Element {
  const t = useTranslations("screenshots");
  const platform = detectKeyPlatform();
  const frame = toolMeta("crop", canvasMode);
  const selectText = toolMeta("selectText", canvasMode);
  const items: Array<ToolbarMenuItem | typeof MENU_DIVIDER> = [
    {
      id: "crop",
      label: t(frame.labelKey),
      icon: <frame.Icon size={15} />,
      hint: TOOL_KEYS.crop,
      onSelect: () => onPick("crop"),
    },
  ];
  if (canvasMode) {
    items.push({
      id: "addImage",
      label: t("addImage"),
      icon: <ImagePlus size={15} />,
      hint: ADD_IMAGE_KEY,
      onSelect: onAddImage,
    });
  }
  if (textTool) {
    items.push({
      id: "selectText",
      label: t(selectText.labelKey),
      icon: <selectText.Icon size={15} />,
      onSelect: () => onPick("selectText"),
    });
  }
  items.push(
    MENU_DIVIDER,
    {
      id: "undo",
      label: t("undo"),
      icon: <Undo2 size={15} />,
      hint: undoKeyLabel(platform),
      ...undo,
    },
    {
      id: "redo",
      label: t("redo"),
      icon: <Redo2 size={15} />,
      hint: redoKeyLabel(platform),
      ...redo,
    },
    MENU_DIVIDER,
    { id: "pdf", label: t("exportPdf"), icon: <FileText size={15} />, ...pdf },
  );
  return (
    <ToolbarMenu
      area={uiArea("editorImage.moreMenu")}
      label={t("toolMore")}
      menuLabel={t("moreMenuLabel")}
      items={items}
    >
      <Ellipsis size={17} />
    </ToolbarMenu>
  );
}
