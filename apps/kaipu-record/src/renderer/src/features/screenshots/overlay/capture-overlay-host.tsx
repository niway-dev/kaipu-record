import { useEffect, useState } from "react";
import type { OverlayState } from "@shared/types/screenshot-capture";
import { CaptureOverlay, type CaptureOverlayApi } from "./capture-overlay";
import type { OverlayQuery } from "./overlay-query";

interface CaptureOverlayHostProps {
  query: OverlayQuery;
  api?: CaptureOverlayApi;
}

/**
 * The window's root. A capture overlay window outlives its pick: main keeps it hidden after
 * the pick ends and shows it again for the next one (NIW2-878). So nothing of a pick may live
 * in the window itself: this host mounts a new `CaptureOverlay` for every pick (React `key` =
 * the pick's session id), seeded with the state that opened it, and unmounts it when main
 * resets the window. A pick therefore starts with no leftover drag, countdown, toast, hover,
 * intent, mode or frame, however the previous one ended.
 *
 * A window that was not loaded ahead (`spare` absent) is a plain overlay with everything it
 * needs in its query.
 */
export function CaptureOverlayHost({
  query,
  api = window.electronAPI,
}: CaptureOverlayHostProps): React.JSX.Element | null {
  const bridge = api.captureOverlay;
  const [pick, setPick] = useState<OverlayState | null>(null);

  useEffect(() => {
    if (!query.spare) return;
    const offState = bridge.onState((incoming) => {
      // Only a new pick changes what is mounted; the overlay follows the updates of its own.
      setPick((current) =>
        current && (incoming.session ?? 0) === (current.session ?? 0) ? current : incoming,
      );
    });
    const offReset = bridge.onReset(() => setPick(null));
    // Main may have sent the first state before this listener existed.
    bridge.requestState();
    return () => {
      offState();
      offReset();
    };
  }, [bridge, query.spare]);

  if (!query.spare) return <CaptureOverlay query={query} api={api} />;
  if (!pick) return null;
  return <CaptureOverlay key={pick.session ?? 0} query={query} initialState={pick} api={api} />;
}
