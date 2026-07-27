/**
 * Переключатель. Подпись — часть компонента, а не соседний элемент: переключатель без подписи не
 * объясняет, что он переключает, ни глазом, ни скринридером.
 */

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
    <label className="sv-toggle" title={hint}>
      <input
        type="checkbox"
        className="sv-toggle-input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="sv-toggle-label">{label}</span>
    </label>
  );
}
