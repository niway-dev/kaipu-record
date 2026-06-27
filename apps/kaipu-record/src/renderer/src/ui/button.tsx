import React from "react";
import { cx } from "./cx";
import styles from "./button.module.css";

type ButtonVariant = "primary" | "danger" | "ghost" | "outline";
type ButtonSize = "sm" | "default" | "lg";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export function Button({
  variant = "primary",
  size = "default",
  className,
  children,
  ...props
}: ButtonProps): React.JSX.Element {
  return (
    <button
      className={cx(styles.button, className)}
      data-variant={variant}
      data-size={size}
      {...props}
    >
      {children}
    </button>
  );
}
