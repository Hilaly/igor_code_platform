/** Выпадающий список Combobox с поддержкой локального поиска/фильтрации. */

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
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, []);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(query.toLowerCase()),
  );

  return (
    <div className={styles.root} ref={rootRef}>
      <div className={styles.inputWrap}>
        <Input
          value={open ? query : selectedOption?.label || ""}
          onChange={(text) => {
            setQuery(text);
            if (!open) setOpen(true);
          }}
          placeholder={selectedOption?.label || placeholder}
          disabled={disabled}
          invalid={invalid}
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-label={label}
        />
      </div>
      {open ? (
        <div id={listId} className={styles.dropdown} role="listbox">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option) => {
              const isSelected = option.value === value;
              return (
                <div
                  key={option.value}
                  role="option"
                  aria-selected={isSelected}
                  className={`${styles.option}${isSelected ? ` ${styles.selected}` : ""}`}
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
