import React from "react";
import * as RadixSelect from "@radix-ui/react-select";
import { ChevronDown, Check } from "lucide-react";
import { cx } from "./cx";
import styles from "./select.module.css";

/*
 * The last component still on CSS Modules, and it stays here on purpose.
 *
 * Radix communicates its state through data attributes — `[data-state="open"]`,
 * `[data-highlighted]`, `[data-disabled]` — and this stylesheet reacts to them,
 * including through a descendant (`.trigger[data-state=open] .triggerChevron`)
 * and Radix's own `--radix-select-trigger-width`. StyleX can express none of
 * those: it has no arbitrary attribute selectors and no descendant selectors.
 *
 * Migrating it would mean lifting Radix's open/highlight state into React so
 * the styles could be chosen in JS — a behavioural rewrite of the piece whose
 * keyboard handling, typeahead and collision-aware positioning are exactly why
 * Radix is here. That is stage 4's decision (which headless library both
 * surfaces share), not a styling change.
 */

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
      <RadixSelect.Trigger id={id} className={cx(styles.trigger, className)}>
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
