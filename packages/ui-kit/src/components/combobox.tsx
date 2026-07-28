/** Выпадающий список Combobox с поддержкой локального поиска/фильтрации и клавиатурной навигации. */

import { useEffect, useId, useRef, useState } from "react";

import { Input } from "./input.tsx";
import styles from "./combobox.module.css";

export type ComboboxOption<T extends string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type ComboboxProps<T extends string> = {
  options: ComboboxOption<T>[];
  value: T;
  onChange: (value: T) => void;
  placeholder?: string;
  disabled?: boolean;
  invalid?: boolean;
  label?: string;
  emptyText?: string;
};

export function Combobox<T extends string>({
  options,
  value,
  onChange,
  placeholder = "Выберите...",
  disabled = false,
  invalid = false,
  label,
  emptyText = "Ничего не найдено",
}: ComboboxProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number>(-1);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const safeListId = `combobox-${listId.replace(/[^A-Za-z0-9_-]/g, "") || "list"}`;

  const selectedOption = options.find((opt) => opt.value === value && !opt.disabled);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()),
  );

  function filterOptions(nextQuery: string) {
    return options.filter((option) => option.label.toLowerCase().includes(nextQuery.toLowerCase()));
  }

  function firstEnabledIndex(items: readonly ComboboxOption<T>[]) {
    return items.findIndex((option) => !option.disabled);
  }

  function selectedOrFirstEnabledIndex(items: readonly ComboboxOption<T>[]) {
    const selectedIndex = items.findIndex((option) => option.value === value && !option.disabled);
    return selectedIndex >= 0 ? selectedIndex : firstEnabledIndex(items);
  }

  useEffect(() => {
    if (!open) {
      setQuery("");
      setActiveIndex(-1);
    } else {
      setActiveIndex(selectedOrFirstEnabledIndex(filteredOptions));
    }
  }, [open, query, value, options]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (disabled) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
      } else if (filteredOptions.length > 0) {
        let nextIndex = activeIndex + 1;
        while (nextIndex < filteredOptions.length && filteredOptions[nextIndex]?.disabled) {
          nextIndex++;
        }
        if (nextIndex < filteredOptions.length) {
          setActiveIndex(nextIndex);
        }
      }
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (open && filteredOptions.length > 0) {
        let prevIndex = activeIndex - 1;
        while (prevIndex >= 0 && filteredOptions[prevIndex]?.disabled) {
          prevIndex--;
        }
        if (prevIndex >= 0) {
          setActiveIndex(prevIndex);
        }
      }
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && activeIndex < filteredOptions.length) {
        event.preventDefault();
        const selected = filteredOptions[activeIndex];
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
      if (open) {
        event.preventDefault();
        setActiveIndex(firstEnabledIndex(filteredOptions));
      }
    } else if (event.key === "End") {
      if (open) {
        event.preventDefault();
        const reversedIndex = [...filteredOptions]
          .reverse()
          .findIndex((option) => !option.disabled);
        setActiveIndex(reversedIndex < 0 ? -1 : filteredOptions.length - reversedIndex - 1);
      }
    }
  }

  const activeOption = activeIndex >= 0 ? filteredOptions[activeIndex] : undefined;
  const activeOptionId = activeOption
    ? `${safeListId}-opt-${filteredOptions.indexOf(activeOption)}`
    : undefined;

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.inputWrap}>
        <Input
          value={open ? query : selectedOption?.label || ""}
          onChange={(text) => {
            setQuery(text);
            setActiveIndex(selectedOrFirstEnabledIndex(filterOptions(text)));
            if (!open) setOpen(true);
          }}
          onClick={() => {
            if (!disabled) setOpen((prev) => !prev);
          }}
          onKeyDown={handleKeyDown}
          placeholder={selectedOption?.label || placeholder}
          disabled={disabled}
          invalid={invalid}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-haspopup="listbox"
          aria-autocomplete="list"
          aria-activedescendant={open ? activeOptionId : undefined}
          aria-label={label}
        />
      </div>
      {open ? (
        <div
          id={listId}
          className={styles.dropdown}
          role="listbox"
          aria-label={label}
          tabIndex={-1}
        >
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, index) => {
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
                  onClick={() => {
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
            })
          ) : (
            <div className={styles.empty}>{emptyText}</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
