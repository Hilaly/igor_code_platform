/**
 * Инструменты поставки как источник для `tools_collect` (docs/hooks.md).
 *
 * Они приходят из агентного рантайма, а не из плагинов: «агент из коробки умеет править файлы и
 * bash» — свойство рантайма (docs/agent-runtime-contract.md). Источником они оформлены затем, что
 * подписка плагина встаёт рядом вторым источником и ничего здесь не меняет.
 */

import { createCoreTools } from "@sovereign/agent-runtime-pi";

import type { CollectedTool, ToolSource } from "./tool-collection.ts";

/** Группа инструментов ядра. Она первая по алфавиту, и это не совпадение: сортировка по группе. */
export const coreToolGroup = "core";

/**
 * Порядок внутри группы задан явно, а не алфавитом: он определяет, в каком виде набор уезжает
 * модели, и «bash первым» — решение, а не следствие имени.
 */
const orders: Record<string, number> = { bash: 10, read: 20, write: 30, edit: 40 };

export function coreToolSource(): ToolSource {
  return {
    id: "core",
    collect: (): CollectedTool[] =>
      createCoreTools().map((entry) => ({
        name: entry.name,
        group: coreToolGroup,
        order: orders[entry.name] ?? 100,
        tool: entry.tool,
      })),
  };
}
