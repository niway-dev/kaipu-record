import React from "react";
import styles from "./filter-chip.module.css";

interface FilterChipProps {
  active: boolean;
  empty?: boolean;
  tone?: "default" | "alert";
  onClick: () => void;
  children: React.ReactNode;
}

export function FilterChip({
  active,
  empty,
  tone = "default",
  onClick,
  children,
}: FilterChipProps): React.JSX.Element {
  return (
    <button
      className={styles.filterChip}
      data-active={active}
      data-empty={!active && empty}
      data-tone={tone}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
