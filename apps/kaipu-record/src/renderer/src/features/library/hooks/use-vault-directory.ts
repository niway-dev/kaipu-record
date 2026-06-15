import { useCallback, useEffect, useState } from "react";
import type { VaultDirectory } from "@shared/types";

export interface VaultDirectoryControls {
  directory: VaultDirectory | null;
  /** Open the folder picker; updates state if the user chose a folder. */
  choose(): Promise<void>;
  /** Reset to the platform default recordings folder. */
  reset(): Promise<void>;
}

/** Reads + manages where recordings are stored (the vault folder). */
export function useVaultDirectory(): VaultDirectoryControls {
  const [directory, setDirectory] = useState<VaultDirectory | null>(null);

  const refresh = useCallback(async () => {
    setDirectory(await window.electronAPI.getVaultDirectory());
  }, []);

  const choose = useCallback(async () => {
    const next = await window.electronAPI.chooseVaultDirectory();
    if (next) setDirectory(next);
  }, []);

  const reset = useCallback(async () => {
    setDirectory(await window.electronAPI.resetVaultDirectory());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { directory, choose, reset };
}
