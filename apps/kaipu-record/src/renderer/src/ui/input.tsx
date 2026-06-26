import React from "react";
import { cx } from "./cx";
import styles from "./input.module.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...props }: InputProps): React.JSX.Element {
  const field = <input id={id} className={cx(styles.input, className)} {...props} />;

  if (!label) return field;

  return (
    <div className={styles.wrapper}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      {field}
    </div>
  );
}
