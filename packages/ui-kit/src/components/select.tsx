/**
 * Выбор одного из немногих: цветовая схема, локаль. Список приходит данными, как и всё остальное.
 *
 * Раскрывает список браузер — это нативный `select`. Обёртка вокруг него нужна стрелке: своя
 * рисуется на ней, потому что нативную убирает `appearance: none` (select.module.css).
 */

import styles from "./select.module.css";

export type SelectOption = {
  value: string;
  label: string;
};

export type SelectProps = {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  label: string;
  disabled?: boolean;
};

export function Select({ value, options, onChange, label, disabled = false }: SelectProps) {
  return (
    <label className={styles.select}>
      <span className={styles.label}>{label}</span>
      <span className={styles.control}>
        <select
          className={styles.input}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </span>
    </label>
  );
}
