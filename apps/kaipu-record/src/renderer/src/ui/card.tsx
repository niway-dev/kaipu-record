import React from "react";
import { cx } from "./cx";
import styles from "./card.module.css";

export interface CardProps {
  children: React.ReactNode;
  className?: string;
}

export function Card({ children, className }: CardProps): React.JSX.Element {
  return <div className={cx(styles.card, className)}>{children}</div>;
}
