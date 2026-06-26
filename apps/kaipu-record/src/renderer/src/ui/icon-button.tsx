import React from "react";
import { cx } from "./cx";
import styles from "./icon-button.module.css";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  size?: "sm" | "default" | "lg";
}

export function IconButton({
  size = "default",
  className,
  children,
  ...props
}: IconButtonProps): React.JSX.Element {
  return (
    <button className={cx(styles.iconButton, className)} data-size={size} {...props}>
      {children}
    </button>
  );
}
