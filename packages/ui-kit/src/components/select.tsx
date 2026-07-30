/**
 * Кастомный выпадающий список Select с полной поддержкой токенов цветовых схем,
 * glassmorphic-оформлением и клавиатурной навигацией.
 */

import { useEffect, useId, useRef, useState } from "react";

import styles from "./select.module.css";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  /**
   * Что стоит в триггере, пока ничего не выбрано. Обязателен и без значения по умолчанию: строка,
   * зашитая в кит, приезжает на чужом языке — переводить её обязан вызывающий (docs/ui-kit.md).
   */
  placeholder: string;
  disabled?: boolean;
};

export function Select({
  value,
  options,
  onChange,
  label,
  placeholder,
  disabled = false,
}: SelectProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const safeListId = `select-${listId.replace(/[^A-Za-z0-9_-]/g, "") || "list"}`;

  const selectedOption = options.find((opt) => opt.value === value && !opt.disabled);

  function firstEnabledIndex() {
    return options.findIndex((option) => !option.disabled);
  }

  function selectedOrFirstEnabledIndex() {
    const selectedIndex = options.findIndex((option) => option.value === value && !option.disabled);
    return selectedIndex >= 0 ? selectedIndex : firstEnabledIndex();
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
      setActiveIndex(selectedOrFirstEnabledIndex());
    }
  }, [open]);

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
          onChange(selected.value);
          setOpen(false);
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

  const activeOption = activeIndex >= 0 ? options[activeIndex] : undefined;
  const activeOptionId = activeOption
    ? `${safeListId}-opt-${options.indexOf(activeOption)}`
    : undefined;

  return (
    <div className={styles.root} ref={rootRef}>
      {label ? <span className={styles.label}>{label}</span> : null}
      <div
        tabIndex={disabled ? -1 : 0}
        role="combobox"
        aria-expanded={open}
        aria-disabled={disabled}
        aria-controls={listId}
        aria-haspopup="listbox"
        aria-activedescendant={open ? activeOptionId : undefined}
        aria-label={label}
        className={`${styles.control}${disabled ? ` ${styles.disabled}` : ""}`}
        onClick={() => {
          if (!disabled) setOpen((prev) => !prev);
        }}
        onKeyDown={handleKeyDown}
      >
        <span className={styles.valueText}>{selectedOption?.label || placeholder}</span>
        <span className={`${styles.arrow}${open ? ` ${styles.open}` : ""}`}>▼</span>
      </div>
      {open ? (
        <div
          id={listId}
          className={styles.dropdown}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
        >
          {options.map((option, index) => {
            const isSelected = option.value === value && !option.disabled;
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
                    onChange(option.value);
                    setOpen(false);
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
