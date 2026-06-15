import React from "react";
import styles from "./input.module.css";

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
}

export function Input({ label, className, id, ...props }: InputProps): React.JSX.Element {
  const cls = [styles.input, className].filter(Boolean).join(" ");

  if (label) {
    return (
      <div className={styles.wrapper}>
        <label className={styles.label} htmlFor={id}>
          {label}
        </label>
        <input id={id} className={cls} {...props} />
      </div>
    );
  }

  return <input id={id} className={cls} {...props} />;
}
