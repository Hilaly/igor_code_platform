import { convert, resolve, utils } from "@asamuzakjp/css-color";

/**
 * Проверяет цвет как самостоятельное значение токена. Ссылки на внешние CSS-переменные и
 * `currentColor` здесь непригодны: схема применяется на корне документа и не имеет контекста,
 * который мог бы разрешить такие зависимости одинаково во всех потребителях.
 */
export function isResolvableColor(value: unknown): value is string {
  if (typeof value !== "string" || value.trim() === "" || !utils.isColor(value)) {
    return false;
  }

  try {
    const specified = resolve(value, { format: "specifiedValue" });

    if (
      specified === null ||
      utils.extractDashedIdent(specified).length > 0 ||
      /\bcurrentcolor\b/i.test(specified)
    ) {
      return false;
    }

    const channels = convert.colorToRgb(resolve(value) ?? value);

    return channels.length === 4 && channels.every((channel) => Number.isFinite(channel));
  } catch {
    return false;
  }
}
