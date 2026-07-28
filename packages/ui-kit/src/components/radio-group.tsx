/** Группа радио-кнопок для единичного выбора из нескольких вариантов. */

import { useId } from "react";

import styles from "./radio-group.module.css";

export type RadioOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type RadioGroupProps<T extends string> = {
  options: RadioOption<T>[];
  value: T;
  onChange: (value: T) => void;
  name?: string;
  label?: string;
  disabled?: boolean;
};

export function RadioGroup<T extends string>({
  options,
  value,
  onChange,
  name,
  label,
  disabled = false,
}: RadioGroupProps<T>) {
  const defaultName = useId();
  const groupName = name || defaultName;

  return (
    <div className={styles.root} role="radiogroup" aria-label={label}>
      {options.map((option) => {
        const itemId = `${groupName}-${option.value}`;
        const isSelected = option.value === value;
        const isDisabled = disabled || option.disabled;

        return (
          <label
            key={option.value}
            htmlFor={itemId}
            className={`${styles.item}${isDisabled ? ` ${styles.disabled}` : ""}`}
          >
            <input
              type="radio"
              id={itemId}
              name={groupName}
              value={option.value}
              checked={isSelected}
              disabled={isDisabled}
              className={styles.radio}
              onChange={() => {
                if (!isDisabled) {
                  onChange(option.value);
                }
              }}
            />
            <span>{option.label}</span>
          </label>
        );
      })}
    </div>
  );
}
