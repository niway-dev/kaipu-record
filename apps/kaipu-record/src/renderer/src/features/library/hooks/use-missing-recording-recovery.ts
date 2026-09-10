import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { captureEvent } from "@renderer/features/analytics";

/** Delay before the single recovery re-list — long enough for a just-finalized
 *  file to become visible in the vault, short enough to still feel instant. */
const RETRY_DELAY_MS = 500;

export interface MissingRecoveryParams {
  /** Asset id from the URL (`/library/:assetId`). */
  id: string | undefined;
  /** Whether that id is present in the currently-listed vault. */
  found: boolean;
  /** The library list is still being read. */
  isLoading: boolean;
  /** Size of the current list — context for the diagnostic event. */
  listSize: number;
  /** True when we arrived straight from a finished recording (see app-shell). */
  fromRecording: boolean;
  /** Re-list the vault. */
  refresh: () => Promise<void>;
}

/**
 * Recovers a detail page whose recording id isn't in the vault list. The one case
 * we've observed (rarely, never reproduced locally) is a transient race right
 * after a recording finalizes: the navigation to `/library/:assetId` beats the item
 * into the freshly-listed vault, so `videos.find` misses and the page would show
 * "File not found" for a recording that is, in fact, on disk.
 *
 * Rather than dead-ending, we re-list once after a short grace delay and, if the
 * id is *still* missing, log the miss to PostHog (to catch it in the wild) and
 * fall back to the Library — where the recording actually is.
 *
 * Returns `recovering`, so the page can keep showing its loader (never the scary
 * not-found screen) until recovery has truly given up.
 */
export function useMissingRecordingRecovery(params: MissingRecoveryParams): {
  recovering: boolean;
} {
  const { id, found, isLoading, listSize, fromRecording, refresh } = params;
  const navigate = useNavigate();
  const phase = useRef<"idle" | "retried" | "done">("idle");

  // Navigating between two detail pages reuses this component (same route, new
  // param), so reset the state machine whenever the id changes.
  const trackedId = useRef(id);
  if (trackedId.current !== id) {
    trackedId.current = id;
    phase.current = "idle";
  }

  const missing = !isLoading && !!id && !found;

  useEffect(() => {
    if (!missing) {
      if (found) phase.current = "idle"; // the item showed up — arm recovery again
      return undefined;
    }
    if (phase.current === "idle") {
      phase.current = "retried";
      const timer = setTimeout(() => void refresh(), RETRY_DELAY_MS);
      return () => clearTimeout(timer);
    }
    if (phase.current === "retried") {
      phase.current = "done";
      captureEvent("library-detail-missing", { id, listSize, fromRecording });
      navigate("/library", { replace: true });
    }
    return undefined;
  }, [missing, found, id, listSize, fromRecording, refresh, navigate]);

  return { recovering: missing && phase.current !== "done" };
}
