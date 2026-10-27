import { useCallback, useEffect, useId, useRef, useState, type RefObject } from "react";

export interface SettingsDisclosure {
  open: boolean;
  setOpen: (open: boolean) => void;
  close: () => void;
  chevronRef: RefObject<HTMLButtonElement | null>;
  settingsId: string;
}

/**
 * Open state plus the chevron ref and the id a split tile and its settings share. An open
 * disclosure closes when its window loses focus: the capture panel hides on blur and the
 * main window may be hidden to the tray, and neither tells the renderer, so whatever the
 * open settings hold (the mic meter's device) would stay held.
 */
export function useSettingsDisclosure(): SettingsDisclosure {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const chevronRef = useRef<HTMLButtonElement>(null);
  const settingsId = useId();
  useCloseOnWindowBlur(open, close);
  return { open, setOpen, close, chevronRef, settingsId };
}

type Exclusivable = { setOpen: (open: boolean) => void; close: () => void };

/**
 * Makes a set of controls mutually exclusive: opening one closes the others. Used by the
 * capture panel, whose drawers share one narrow column. Each control only needs `setOpen`
 * and `close`, so Camera's own control fits next to the audio ones.
 */
export function exclusive<T extends readonly Exclusivable[]>(controls: readonly [...T]): [...T] {
  return controls.map((control) => ({
    ...control,
    setOpen: (open: boolean) => {
      if (open) for (const other of controls) if (other !== control) other.close();
      control.setOpen(open);
    },
  })) as unknown as [...T];
}

/** Calls `close` when the window loses focus while `open`. */
export function useCloseOnWindowBlur(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [open, close]);
}
