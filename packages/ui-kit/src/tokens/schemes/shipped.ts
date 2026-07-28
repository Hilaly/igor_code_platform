/**
 * Схемы поставки. Список живёт в ките, а не в приложении: он же нужен тесту контраста, каталогу
 * компонентов и вью внешнего вида, и три копии одного перечисления разошлись бы на первой добавке.
 *
 * Порядок — порядок в выпадающем списке: сначала встроенная, потом перенесённые, проверочная
 * последней (docs/ui-kit.md).
 */

import type { ColorScheme } from "../scheme.ts";
import { baseScheme } from "./base.ts";
import { checkScheme } from "./check.ts";
import { imperiumScheme } from "./imperium.ts";
import { neutralScheme } from "./neutral.ts";
import { nordScheme } from "./nord.ts";
import { obsidianScheme } from "./obsidian.ts";
import { terminalScheme } from "./terminal.ts";

export const shippedSchemes: readonly ColorScheme[] = [
  baseScheme,
  imperiumScheme,
  neutralScheme,
  nordScheme,
  obsidianScheme,
  terminalScheme,
  checkScheme,
];
