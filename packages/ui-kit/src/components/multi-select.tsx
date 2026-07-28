/** Компонент множественного выбора MultiSelect с тегами-плашками. */

import { useEffect, useId, useRef, useState } from "react";

import styles from "./multi-select.module.css";

export type MultiSelectOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type MultiSelectProps<T extends string> = {
  options: MultiSelectOption<T>[];
  value: T[];
  onChange: (value: T[]) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
};

export function MultiSelect<T extends string>({
  options,
  value,
  onChange,
  placeholder = "Выберите...",
  disabled = false,
  invalid = false,
  label,
}: MultiSelectProps<T>) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function toggleOption(val: T) {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  }

  const selectedOptions = options.filter((opt) => value.includes(opt.value));

  return (
    <div className={styles.root} ref={rootRef}>
      <div
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={label}
        className={`${styles.box}${invalid ? ` ${styles.invalid}` : ""}${
          disabled ? ` ${styles.disabled}` : ""
        }`}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
            <span key={opt.value} className={styles.tag}>
              <span>{opt.label}</span>
              <button
                type="button"
                className={styles.remove}
                onClick={(e) => {
                  e.stopPropagation();
                  toggleOption(opt.value);
                }}
              >
                ×
              </button>
            </span>
          ))
        ) : (
          <span className={styles.placeholder}>{placeholder}</span>
        )}
      </div>
      {open ? (
        <div id={listId} className={styles.dropdown} role="listbox">
          {options.map((option) => {
            const isSelected = value.includes(option.value);
            return (
              <div
                key={option.value}
                role="option"
                aria-selected={isSelected}
                className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}`}
                onClick={() => {
                  if (!option.disabled) {
                    toggleOption(option.value);
                  }
                }}
              >
                <span>{option.label}</span>
                {isSelected ? <span>✓</span> : null}
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
