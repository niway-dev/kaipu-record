import React from "react";
import { Card } from "@renderer/ui/card";
import styles from "./settings-page.module.css";

/** One settings page: title, subtitle, then its titled sections. */
export function SettingsPanel({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.page}>
      <div className={styles.pageHeader}>
        <h2 className={styles.pageTitle}>{title}</h2>
        <p className={styles.pageSubtitle}>{subtitle}</p>
      </div>
      <div className={styles.sections}>{children}</div>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      <Card>{children}</Card>
    </div>
  );
}
