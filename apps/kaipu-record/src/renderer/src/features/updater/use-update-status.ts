import { useEffect, useState } from "react";
import type { UpdateStatus } from "@shared/types";

/** Track auto-update status: seeds from the main process, then live-updates on events. */
export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: "idle" });
  useEffect(() => {
    let active = true;
    void window.electronAPI.getUpdateStatus().then((s) => {
      if (active) setStatus(s);
    });
    const unsubscribe = window.electronAPI.onUpdateStatus(setStatus);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return status;
}
