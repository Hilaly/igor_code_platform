/** Компонент множественного выбора MultiSelect с тегами-плашками и полноценной поддержкой клавиатуры. */

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
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const safeListId = `multi-select-${listId.replace(/[^A-Za-z0-9_-]/g, "") || "list"}`;

  function firstEnabledIndex() {
    return options.findIndex((option) => !option.disabled);
  }

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
    } else {
      setActiveIndex(firstEnabledIndex());
    }
  }, [open]);

  function toggleOption(val: T) {
    if (value.includes(val)) {
      onChange(value.filter((v) => v !== val));
    } else {
      onChange([...value, val]);
    }
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else if (options.length > 0) {
        let nextIndex = activeIndex + 1;
        while (nextIndex < options.length && options[nextIndex]?.disabled) {
          nextIndex++;
        }
        if (nextIndex < options.length) {
          setActiveIndex(nextIndex);
        }
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open && options.length > 0) {
        let prevIndex = activeIndex - 1;
        while (prevIndex >= 0 && options[prevIndex]?.disabled) {
          prevIndex--;
        }
        if (prevIndex >= 0) {
          setActiveIndex(prevIndex);
        }
      }
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else if (activeIndex >= 0 && activeIndex < options.length) {
        const selected = options[activeIndex];
        if (selected && !selected.disabled) {
          toggleOption(selected.value);
        }
      }
    } else if (event.key === "Escape") {
      if (open) {
        event.preventDefault();
        setOpen(false);
      }
    } else if (event.key === "Home") {
      event.preventDefault();
      if (open) setActiveIndex(firstEnabledIndex());
    } else if (event.key === "End") {
      event.preventDefault();
      if (open) {
        const reversedIndex = [...options].reverse().findIndex((option) => !option.disabled);
        setActiveIndex(reversedIndex < 0 ? -1 : options.length - reversedIndex - 1);
      }
    }
  }

  const selectedOptions = options.filter((opt) => value.includes(opt.value) && !opt.disabled);
  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;
  const activeOptionId = activeOption
    ? `${safeListId}-opt-${options.indexOf(activeOption)}`
    : undefined;

  return (
    <div className={styles.root} ref={rootRef}>
      <div
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
        aria-disabled={disabled}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-label={label}
        className={`${styles.box}${invalid ? ` ${styles.invalid}` : ""}${
          disabled ? ` ${styles.disabled}` : ""
        }`}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={handleKeyDown}
      >
        {selectedOptions.length > 0 ? (
          selectedOptions.map((opt) => (
            <span key={opt.value} className={styles.tag}>
              <span>{opt.label}</span>
              <button
                type="button"
                className={styles.remove}
                aria-label={`Удалить ${opt.label}`}
                disabled={disabled}
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
        <div
          id={listId}
          className={styles.dropdown}
          role="listbox"
          aria-label={label}
          aria-multiselectable="true"
          tabIndex={-1}
        >
          {options.map((option, index) => {
            const isSelected = value.includes(option.value) && !option.disabled;
            const isActive = index === activeIndex;
            const optionId = `${safeListId}-opt-${index}`;

            return (
              <div
                key={option.value}
                id={optionId}
                role="option"
                aria-selected={isSelected}
                aria-disabled={option.disabled}
                className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}${
                  isActive ? ` ${styles.active}` : ""
                }${option.disabled ? ` ${styles.disabled}` : ""}`}
                onMouseEnter={() => {
                  if (!option.disabled) setActiveIndex(index);
                }}
                onClick={(e) => {
                  e.stopPropagation();
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
