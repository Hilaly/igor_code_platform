/** Выбор одного из немногих: цветовая схема, локаль. Список приходит данными, как и всё остальное. */

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
    <label className="sv-select">
      <span className="sv-select-label">{label}</span>
      <select
        className="sv-select-input"
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
    </label>
  );
}
