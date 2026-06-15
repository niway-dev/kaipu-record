import React from "react";
import styles from "./card.module.css";

export interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps): React.JSX.Element {
  const cls = [styles.card, className].filter(Boolean).join(" ");
  return <div className={cls}>{children}</div>;
}
