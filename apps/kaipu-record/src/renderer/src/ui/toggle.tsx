import React from "react";
import * as Switch from "@radix-ui/react-switch";
import styles from "./toggle.module.css";

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  id?: string;
}

export function Toggle({
  checked,
  onChange,
  disabled = false,
  id,
}: ToggleProps): React.JSX.Element {
  return (
    <Switch.Root
      id={id}
      checked={checked}
      onCheckedChange={onChange}
      disabled={disabled}
      className={styles.toggle}
    >
      <Switch.Thumb className={styles.thumb} />
    </Switch.Root>
  );
}
