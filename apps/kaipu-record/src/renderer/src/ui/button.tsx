import React from "react";
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
  const cls = [styles.button, styles[variant], styles[size], className].filter(Boolean).join(" ");
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  );
}
