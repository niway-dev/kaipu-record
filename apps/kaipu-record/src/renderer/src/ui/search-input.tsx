import React from "react";
import { Search } from "lucide-react";
import { cx } from "./cx";
import styles from "./search-input.module.css";

export interface SearchInputProps extends Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  "type"
> {
  onSearch?: (value: string) => void;
}

export function SearchInput({
  onSearch,
  onChange,
  className,
  ...props
}: SearchInputProps): React.JSX.Element {
  return (
    <label className={cx(styles.wrapper, className)}>
      <Search size={14} strokeWidth={1.8} className={styles.icon} />
      <input
        type="text"
        className={styles.input}
        onChange={(event) => {
          onChange?.(event);
          onSearch?.(event.target.value);
        }}
        {...props}
      />
    </label>
  );
}
