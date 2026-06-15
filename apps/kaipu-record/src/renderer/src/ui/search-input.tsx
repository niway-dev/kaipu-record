import React from "react";
import { Search } from "lucide-react";
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
  const cls = [styles.wrapper, className].filter(Boolean).join(" ");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange?.(e);
    onSearch?.(e.target.value);
  };

  return (
    <div className={cls}>
      <Search size={14} className={styles.icon} />
      <input type="text" className={styles.input} onChange={handleChange} {...props} />
    </div>
  );
}
