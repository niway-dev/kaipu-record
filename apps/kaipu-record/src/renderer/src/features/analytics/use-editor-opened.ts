import { useEffect, useRef } from "react";
import {
  EDITOR_OPENED_EVENT,
  buildEditorOpenedProperties,
  type EditorKind,
} from "@shared/analytics";
import { captureEvent } from "./analytics-client";

/**
 * Report that an editor opened (`editor_opened`, NIW2-849): once per mounted editor session,
 * when `loaded` first turns true. An editor that fails to load is never counted, and a
 * rerender or a flip of `loaded` never counts it twice. Opening another item remounts the
 * editor, which is a new session. `captureEvent` sends nothing with the usage-and-crash-reports
 * preference off.
 */
export function useEditorOpened(editor: EditorKind, loaded: boolean): void {
  const sent = useRef(false);
  useEffect(() => {
    if (!loaded || sent.current) return;
    sent.current = true;
    captureEvent(EDITOR_OPENED_EVENT, buildEditorOpenedProperties({ editor }));
  }, [editor, loaded]);
}
