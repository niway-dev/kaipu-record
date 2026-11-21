import { LibraryPicker as Root } from "./library-picker";
import {
  Body,
  CloseButton,
  Detail,
  Footer,
  Frame,
  Header,
  List,
  Note,
  Row,
  SearchBox,
} from "./picker-parts";
import { Preview } from "./picker-preview";

/**
 * The Library picker: `<LibraryPicker>` is the root that owns the state, and the parts hang off
 * it (`LibraryPicker.List`, `LibraryPicker.Preview`, …) so the caller composes the layout.
 * Parts outside a root throw.
 */
export const LibraryPicker = Object.assign(Root, {
  Header,
  Search: SearchBox,
  Close: CloseButton,
  Body,
  Note,
  List,
  Row,
  Detail,
  Frame,
  Preview,
  Footer,
});

export type { LibraryPickerProps } from "./library-picker";
export { useLibraryPicker, type LibraryPickerState } from "./picker-context";
