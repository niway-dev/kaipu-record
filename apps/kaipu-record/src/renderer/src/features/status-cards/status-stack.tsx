import { createContext, useContext, useState } from "react";
import { createPortal } from "react-dom";
import { ExportStatusCards } from "./export-status-cards";
import styles from "./status-stack.module.css";

const SlotContext = createContext<HTMLElement | null>(null);

/**
 * The in-app status cards (NIW2-218 export redesign), mounted once at the app root so they
 * outlive every page. A page adds its own card (its "Recording saved" card) through
 * `StatusCardPortal` into the top-right column, so those line up instead of overlapping.
 * The background export's widget and its "ready" card sit bottom right, out of the way of
 * the page's own controls up top.
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
      </div>
      <div className={styles.exportStack}>
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
