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
export { Row, type RowProps } from "./atoms/row";
export { SearchInput, type SearchInputProps } from "./atoms/search-input";
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
  ToastList,
  type ToastAction,
  type ToastItem,
  type ToastListProps,
} from "./molecules/toast-list";
