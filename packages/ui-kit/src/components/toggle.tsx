/**
 * Переключатель. Подпись — часть компонента, а не соседний элемент: переключатель без подписи не
 * объясняет, что он переключает, ни глазом, ни скринридером. В плотной строке её можно скрыть
 * визуально, но она остаётся связанной с настоящим `input` и показывается через `Tooltip`.
 *
 * Видимый бокс — отдельный элемент рядом с настоящим `input`: сам контрол остаётся в дереве и
 * отвечает за фокус, клавиатуру и роль, а рисуется он соседом (toggle.module.css).
 */

import styles from "./toggle.module.css";
import { Tooltip } from "./tooltip.tsx";

export type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  /** Почему выключено: у выключенного переключателя это единственное объяснение. */
  hint?: string;
  size?: "sm" | "xs";
  /** Показывать подпись рядом с тумблером или только в подсказке внешне подписанной строки. */
  labelDisplay?: "visible" | "tooltip";
};

export function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  hint,
  size = "sm",
  labelDisplay = "visible",
}: ToggleProps) {
  const toggle = (
    <label className={`${styles.toggle} ${styles[size]}`} title={hint}>
      <input
        type="checkbox"
        className={styles.input}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className={styles.box} aria-hidden="true" />
      <span
        className={`${styles.label} ${labelDisplay === "tooltip" ? styles.visuallyHidden : ""}`}
      >
        {label}
      </span>
    </label>
  );

  return labelDisplay === "tooltip" ? <Tooltip content={label}>{toggle}</Tooltip> : toggle;
}
