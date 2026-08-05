/**
 * Ручка инструмента плагина для рантайма (docs/hooks.md). Собирается здесь, потому что это тип Pi:
 * ядру ручка остаётся непрозрачной, как и у четырёх инструментов поставки.
 *
 * Схема аргументов приезжает **данными** — результатом `z.toJSONSchema()` в SDK. Pi её принимает: он
 * проверяет аргументы typebox-схемой, только если у схемы есть его символ, а иначе разбирает её как
 * обычную JSON Schema (`validateToolArguments` в pi-ai). Поэтому слоя перевода схемы здесь нет.
 */

import type { AgentTool } from "./agent-session.ts";

export type PluginToolInvocation = {
  /** Что инструмент сказал модели. Текст, а не контент Pi: картинок у инструмента плагина пока нет. */
  content: string;
  /**
   * Неудача инструмента — не сбой платформы: она уезжает модели признаком рядом с текстом, и турн
   * продолжается (docs/hooks.md).
   */
  isError: boolean;
};

export type PluginToolDefinition = {
  /** Имя, которым инструмент зовёт модель. Оно же идентификатор вклада (docs/hooks.md). */
  name: string;
  description: string;
  /** JSON Schema аргументов. Через границу воркера ходит только описание, не сама схема. */
  parameters: object;
  /** Заголовок для интерфейса. Не назван — берётся имя. */
  label?: string;
  invoke: (toolArguments: unknown) => Promise<PluginToolInvocation>;
};

/**
 * Инструмент, который зовёт воркер плагина. `execute` не бросает: и таймаут, и мёртвый плагин
 * приезжают сюда исходом, а исключение из инструмента Pi превратил бы в ошибку турна.
 */
export function createPluginTool(definition: PluginToolDefinition): AgentTool {
  return {
    name: definition.name,
    tool: {
      name: definition.name,
      label: definition.label ?? definition.name,
      description: definition.description,
      parameters: definition.parameters,
      execute: async (_toolCallId: string, params: unknown) => {
        const invoked = await definition.invoke(params);

        return {
          content: [{ type: "text", text: invoked.content }],
          details: undefined,
          isError: invoked.isError,
        };
      },
    },
  };
}
