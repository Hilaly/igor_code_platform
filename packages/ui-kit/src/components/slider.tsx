/** Компонент ползунка Slider для диапазонного числового ввода. */

import styles from "./slider.module.css";

export type SliderProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  showValue?: boolean;
  label?: string;
  id?: string;
};

export function Slider({
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  showValue = false,
  label,
  id,
}: SliderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.track}>
        <input
          type="range"
          id={id}
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-valuenow={value}
          aria-valuemin={min}
          aria-valuemax={max}
          className={styles.input}
          onChange={(event) => onChange(Number(event.target.value))}
        />
      </div>
      {showValue ? <span className={styles.value}>{value}</span> : null}
    </div>
  );
}
