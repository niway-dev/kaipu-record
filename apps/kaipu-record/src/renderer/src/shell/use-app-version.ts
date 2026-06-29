import { useEffect, useState } from "react";

/** The running app version (e.g. "0.1.0"), read once from the main process. */
export function useAppVersion(): string | null {
  const [version, setVersion] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    void window.electronAPI.getAppVersion().then((v) => {
      if (active) setVersion(v);
    });
    return () => {
      active = false;
    };
  }, []);
  return version;
}
