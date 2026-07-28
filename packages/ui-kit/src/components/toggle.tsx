/**
 * Переключатель. Подпись — часть компонента, а не соседний элемент: переключатель без подписи не
 * объясняет, что он переключает, ни глазом, ни скринридером.
 *
 * Видимый бокс — отдельный элемент рядом с настоящим `input`: сам контрол остаётся в дереве и
 * отвечает за фокус, клавиатуру и роль, а рисуется он соседом (toggle.module.css).
 */

import styles from "./toggle.module.css";

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Почему выключено: у выключенного переключателя это единственное объяснение. */
  hint?: string;
};

export function Toggle({ checked, onChange, label, disabled = false, hint }: ToggleProps) {
  return (
    <label className={styles.toggle} title={hint}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.box} aria-hidden="true" />
      <span className={styles.label}>{label}</span>
    </label>
  );
}
