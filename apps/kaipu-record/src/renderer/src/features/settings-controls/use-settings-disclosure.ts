import { useCallback, useId, useRef, useState, type RefObject } from "react";

export interface SettingsDisclosure {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  chevronRef: RefObject<HTMLButtonElement | null>;
  settingsId: string;
}

/** Open state plus the chevron ref and the id a split tile and its settings share. */
export function useSettingsDisclosure(): SettingsDisclosure {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const settingsId = useId();
  return { open, setOpen, close, chevronRef, settingsId };
}
