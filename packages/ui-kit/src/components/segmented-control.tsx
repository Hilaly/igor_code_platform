/**
 * Сегментированный переключатель выборов с подвижной плавающей кареткой.
 * Используется для быстрой смены режима, вида или интервала из 2–5 вариантов.
 */

import { useId, useRef } from "react";

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
  const selectedIndex = Math.max(
    0,
    options.findIndex((opt) => opt.value === value),
  );
  const count = options.length;
  const optionRefs = useRef(new Map<T, HTMLButtonElement>());
  const firstEnabledIndex = options.findIndex((option) => !option.disabled && !disabled);
  const tabIndex = (index: number) =>
    !disabled &&
    !options[index]?.disabled &&
    (options[index]?.value === value || (firstEnabledIndex >= 0 && index === firstEnabledIndex))
      ? 0
      : -1;

  function moveFocus(fromIndex: number, direction: 1 | -1 | "first" | "last") {
    const enabled = options
      .map((option, index) => ({ option, index }))
      .filter(({ option }) => !disabled && !option.disabled);
    if (enabled.length === 0) return;
    const current = enabled.findIndex(({ index }) => index === fromIndex);
    const target =
      direction === "first"
        ? enabled[0]
        : direction === "last"
          ? enabled.at(-1)
          : enabled[(current + direction + enabled.length) % enabled.length];
    if (!target) return;
    onChange(target.option.value);
    optionRefs.current.get(target.option.value)?.focus();
  }

  return (
    <div
      className={styles.root}
      role="radiogroup"
      aria-label={label}
      id={groupId}
      style={
        {
          "--segmented-count": count,
          "--segmented-index": selectedIndex,
        } as React.CSSProperties
      }
    >
      <div className={styles.indicator} />
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
            tabIndex={tabIndex(options.indexOf(option))}
            className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}${
              isDisabled ? ` ${styles.disabled}` : ""
            }`}
            ref={(element) => {
              if (element) optionRefs.current.set(option.value, element);
              else optionRefs.current.delete(option.value);
            }}
            onKeyDown={(event) => {
              const index = options.indexOf(option);
              if (event.key === "ArrowRight" || event.key === "ArrowDown") {
                event.preventDefault();
                moveFocus(index, 1);
              } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
                event.preventDefault();
                moveFocus(index, -1);
              } else if (event.key === "Home") {
                event.preventDefault();
                moveFocus(index, "first");
              } else if (event.key === "End") {
                event.preventDefault();
                moveFocus(index, "last");
              }
            }}
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
