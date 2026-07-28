/**
 * Сегментированный переключатель выборов с подложкой.
 * Используется для быстрой смены режима, вида или интервала из 2–5 вариантов.
 */

import { useId } from "react";

import styles from "./segmented-control.module.css";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Описание группы для скринридеров. */
  label?: string;
  disabled?: boolean;
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  disabled = false,
}: SegmentedControlProps<T>) {
  const groupId = useId();

  return (
    <div
      className={styles.root}
      role="radiogroup"
      aria-label={label}
      id={groupId}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        const isDisabled = disabled || option.disabled;

        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={isDisabled}
            className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}${
              isDisabled ? ` ${styles.disabled}` : ""
            }`}
            onClick={() => {
              if (!isDisabled && !isSelected) {
                onChange(option.value);
              }
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
