import React, { useEffect, useRef, useState } from "react";
import { useTranslations } from "@kaipu/i18n";
import { TAG_COLORS, type TagColor } from "@kaipu/domain/constants";
import styles from "./tag-chip.module.css";

/** A colored tag pill: a dot in the tag's color and its name. */
export function TagChip({
  name,
  color,
  size = "sm",
}: {
  name: string;
  color: TagColor;
  size?: "sm" | "md";
}): React.JSX.Element {
  return (
    <span className={styles.chip} data-color={color} data-size={size} title={name}>
      <span className={styles.dot} aria-hidden />
      <span className={styles.name}>{name}</span>
    </span>
  );
}

/**
 * The mini color menu: a swatch button showing the current color that opens a
 * grid of the palette. Closes on pick, on Esc and on a click outside.
 */
export function ColorMenu({
  value,
  onChange,
  label,
}: {
  value: TagColor;
  onChange(color: TagColor): void;
  label: string;
}): React.JSX.Element {
  const t = useTranslations("library");
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (!anchor.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  return (
    <span className={styles.menuAnchor} ref={anchor}>
      <button
        type="button"
        className={styles.swatchButton}
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.dot} data-color={value} aria-hidden />
      </button>
      {open && (
        <span className={styles.menu} role="radiogroup" aria-label={label}>
          {TAG_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={color === value}
              aria-label={t(`tagColor_${color}`)}
              title={t(`tagColor_${color}`)}
              className={styles.swatch}
              data-color={color}
              onClick={() => {
                onChange(color);
                setOpen(false);
              }}
            />
          ))}
        </span>
      )}
    </span>
  );
}
