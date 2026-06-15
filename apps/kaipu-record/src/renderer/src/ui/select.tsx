import React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import styles from "./select.module.css";

interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  options: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  id?: string;
}

export function Select({
  options,
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  id,
}: SelectProps): React.JSX.Element {
  return (
    <RadixSelect.Root value={value || undefined} onValueChange={onChange} disabled={disabled}>
      <RadixSelect.Trigger
        id={id}
        className={[styles.trigger, className].filter(Boolean).join(" ")}
      >
        <RadixSelect.Value placeholder={placeholder ?? " "} />
        <RadixSelect.Icon asChild>
          <ChevronDown className={styles.triggerChevron} size={12} />
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content className={styles.menu} position="popper" sideOffset={4}>
          <RadixSelect.Viewport>
            {options.map((opt) => (
              <RadixSelect.Item key={opt.value} value={opt.value} className={styles.menuOption}>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
                <RadixSelect.ItemIndicator className={styles.menuOptionIndicator}>
                  <Check size={12} />
                </RadixSelect.ItemIndicator>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
