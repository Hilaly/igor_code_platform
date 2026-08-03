/**
 * Схемы поставки. Список живёт в ките, а не в приложении: он же нужен тесту контраста, каталогу
 * компонентов и вью внешнего вида, и три копии одного перечисления разошлись бы на первой добавке.
 *
 * Порядок — порядок в выпадающем списке: сначала встроенная, затем остальные темы
 * (docs/ui-kit.md).
 */

import type { ColorScheme } from "../scheme.ts";
import { imperiumScheme } from "./imperium.ts";
import { nordScheme } from "./nord.ts";
import { oledScheme } from "./oled.ts";
import { sageScheme } from "./sage.ts";

export const shippedSchemes: readonly ColorScheme[] = [
  imperiumScheme,
  nordScheme,
  oledScheme,
  sageScheme,
];
