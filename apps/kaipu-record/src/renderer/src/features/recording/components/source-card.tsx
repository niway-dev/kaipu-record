import React from "react";
import { Monitor } from "lucide-react";
import type { SelectedSource } from "@renderer/features/recording/types";
import styles from "./source-card.module.css";

interface SourceCardProps {
  source: SelectedSource | null;
  variant?: "full" | "compact";
  onChoose: () => void;
}

/** Dumb selected-source summary + choose/change action. */
export function SourceCard({
  source,
  variant = "full",
  onChoose,
}: SourceCardProps): React.JSX.Element {
  const compact = variant === "compact";
  return (
    <div className={[styles.card, compact ? styles.compact : ""].join(" ")}>
      <Monitor size={compact ? 14 : 16} className={styles.icon} />
      <div className={styles.info}>
        <span className={styles.name}>{source?.name ?? "No source selected"}</span>
        <span className={styles.meta}>
          {source ? (source.type === "screen" ? "SCREEN" : "WINDOW") : "CHOOSE A SOURCE"}
        </span>
      </div>
      <button type="button" className={styles.button} onClick={onChoose}>
        {source ? "Change" : "Choose"}
      </button>
    </div>
  );
}
