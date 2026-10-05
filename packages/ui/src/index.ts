/**
 * Shared product UI, styled with StyleX over @kaipu/tokens.
 *
 * `atoms/` holds components that import no other component from this package
 * and hold no state. `molecules/` holds the pieces that compose, or that carry
 * behavior of their own — the Modal's focus and dismissal, for instance.
 *
 * Nothing here may import a router, @kaipu/i18n, IPC, or the domain: labels,
 * navigation and data arrive as props, so the desktop and the landing can
 * render the same component from different sources.
 */
export { Badge, type BadgeProps } from "./atoms/badge";
export { Button, type ButtonProps } from "./atoms/button";
export { Card, type CardProps } from "./atoms/card";
export { Input, type InputProps } from "./atoms/input";
export { RecordButton, type RecordButtonProps } from "./atoms/record-button";
export { Row, type RowProps } from "./atoms/row";
export { SearchInput, type SearchInputProps } from "./atoms/search-input";
export { SourceCard, type SourceCardProps } from "./atoms/source-card";
export {
  SourceGrid,
  SourcePickerLoading,
  SourcePickerMessage,
  SourceThumbFallback,
  SourceThumbImage,
  SourceTile,
  type SourceTileProps,
} from "./atoms/source-grid";
export { StatusToggle, type StatusToggleProps } from "./atoms/status-toggle";
export { Toggle, type ToggleProps } from "./atoms/toggle";

export {
  ModalActions,
  ModalButton,
  ModalIcon,
  ModalName,
  ModalOverlay,
  ModalText,
  ModalTitle,
} from "./molecules/modal";
export {
  Popover,
  PopoverItem,
  type PopoverItemProps,
  type PopoverProps,
} from "./molecules/popover";
export {
  SourcePicker,
  type SourcePickerProps,
  type SourcePickerTab,
} from "./molecules/source-picker";
export {
  StatusToggleRow,
  type StatusToggleItem,
  type StatusToggleRowProps,
} from "./molecules/status-toggle-row";
export {
  ToastList,
  type ToastAction,
  type ToastItem,
  type ToastListProps,
} from "./molecules/toast-list";
