import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/types";

/** Track auto-update status: seeds from the main process, then live-updates on events. */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  useEffect(() => {
    let active = true;
    // Subscribe first, then seed — and let the seed only fill an as-yet-idle state,
    // so a `ready` event that lands before the seed resolves is never clobbered.
    const unsubscribe = window.electronAPI.onUpdateStatus(setStatus);
    void window.electronAPI.getUpdateStatus().then((s) => {
      if (active) setStatus((prev) => (prev.state === "idle" ? s : prev));
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return status;
}
