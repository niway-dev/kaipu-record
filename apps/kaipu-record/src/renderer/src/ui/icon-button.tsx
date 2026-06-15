import React from "react";
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
  const cls = [styles.iconButton, styles[size], className].filter(Boolean).join(" ");
  return (
    <button className={cls} {...props}>
      {children}
    </button>
  );
}
