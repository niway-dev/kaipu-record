/**
 * Shared product UI, styled with StyleX over @kaipu/tokens.
 *
 * `atoms/` holds components that import no other component from this package
 * and hold no state. A piece that composes atoms, or keeps presentation state,
 * belongs in a `molecules/` folder — added when the first one exists, not
 * before.
 *
 * Nothing here may import a router, @kaipu/i18n, IPC, or the domain: labels,
 * navigation and data arrive as props, so the desktop and the landing can
 * render the same component from different sources.
 */
export { Badge, type BadgeProps } from "./atoms/badge";
export { Button, type ButtonProps } from "./atoms/button";
export { Card, type CardProps } from "./atoms/card";
export { Input, type InputProps } from "./atoms/input";
export { SearchInput, type SearchInputProps } from "./atoms/search-input";
