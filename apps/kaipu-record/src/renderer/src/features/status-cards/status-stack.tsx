import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { ExportStatusCards } from "./export-status-cards";
import styles from "./status-stack.module.css";

const SlotContext = createContext<HTMLElement | null>(null);

/**
 * The top-right stack of in-app status cards (NIW2-218 export redesign), mounted once at
 * the app root so it outlives every page. App-level cards (the background export's progress
 * and "Ready to share") render here directly; a page adds its own (its "Recording saved"
 * card) through `StatusCardPortal`, so every card lines up in one column instead of
 * overlapping.
 */
export function StatusStackProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  return (
    <SlotContext.Provider value={slot}>
      {children}
      <div className={styles.stack}>
        <div ref={setSlot} className={styles.slot} />
        <ExportStatusCards />
      </div>
    </SlotContext.Provider>
  );
}

/** Renders a page's card into the stack; nothing outside a `StatusStackProvider`. */
export function StatusCardPortal({ children }: { children: React.ReactNode }): React.ReactNode {
  const slot = useContext(SlotContext);
  return slot ? createPortal(children, slot) : null;
}
