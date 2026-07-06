import React, { useState } from "react";
import { ArrowUpDown, ChevronDown, Check } from "lucide-react";
import { useTranslations } from "@kaipu/i18n";
import type { SortKey } from "@renderer/features/library/library-filters";
import styles from "./sort-menu.module.css";

const SORT_OPTIONS: Array<{ key: SortKey; labelKey: "sortNewest" | "sortOldest" | "sortLargest" }> =
  [
    { key: "newest", labelKey: "sortNewest" },
    { key: "oldest", labelKey: "sortOldest" },
    { key: "largest", labelKey: "sortLargest" },
  ];

interface SortMenuProps {
  sort: SortKey;
  onChange: (key: SortKey) => void;
}

export function SortMenu({ sort, onChange }: SortMenuProps): React.JSX.Element {
  const t = useTranslations("library");
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.key === sort) ?? SORT_OPTIONS[0];
  return (
    <div className={styles.root}>
      <button className={styles.sortButton} onClick={() => setOpen((o) => !o)} type="button">
        <ArrowUpDown size={14} strokeWidth={1.8} />
        {t(current.labelKey)}
        <ChevronDown size={14} strokeWidth={1.8} />
      </button>
      {open && (
        <>
          <div className={styles.sortBackdrop} onClick={() => setOpen(false)} />
          <div className={styles.sortDropdown}>
            {SORT_OPTIONS.map((o) => (
              <button
                key={o.key}
                className={styles.sortOption}
                data-active={o.key === sort}
                onClick={() => {
                  onChange(o.key);
                  setOpen(false);
                }}
                type="button"
              >
                {o.key === sort && <Check size={13} />}
                {t(o.labelKey)}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
