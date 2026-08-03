/**
 * Собирающий хук `tools_collect` (docs/hooks.md): набор инструментов сессии не задан заранее, он
 * складывается из источников на каждый турн.
 *
 * В срезе 9a источник ровно один — ядро с четырьмя инструментами рантайма. Подписка плагина
 * (срез 11) встаёт вторым источником и формы не меняет: это и есть шов, ради которого сборка
 * существует уже сейчас.
 *
 * Таймаута и критичности здесь нет намеренно: их назначает срез с подписками, а придуманные впрок
 * значения пришлось бы менять вместе с первым же настоящим подписчиком (docs/backlog.md).
 */

export type CollectedTool = {
  /** Имя, которым инструмент виден модели. В собранном наборе уникально. */
  name: string;
  /**
   * Группа и порядок задают детерминированную сортировку: появление нового плагина не переставляет
   * уже существующее (docs/hooks.md).
   */
  group: string;
  order: number;
  /** Ручка на реализацию. Ядру она непрозрачна: понимать её незачем, надо только передать дальше. */
  tool: unknown;
};

export type ToolSource = {
  id: string;
  collect: (context: ToolContext) => CollectedTool[] | Promise<CollectedTool[]>;
};

export type ToolContext = {
  /** Идентичность проекта; папка остаётся рабочей директорией, но не заменяет её. */
  projectId: string;
  /** Папка проекта. Источнику она может понадобиться; ядру для своих инструментов — нет. */
  folder: string;
};

export type CollectedTools = {
  tools: CollectedTool[];
  /** Что не собралось. Сборка не срывается: остальные инструменты сессии нужны (docs/hooks.md). */
  problems: string[];
};

export type ToolCollector = {
  /** Возвращает снятие: источник исчезает вместе с плагином, который его завёл. */
  register: (source: ToolSource) => () => void;
  collect: (context: ToolContext) => Promise<CollectedTools>;
};

export function createToolCollector(): ToolCollector {
  const sources = new Set<ToolSource>();

  return {
    register: (source) => {
      sources.add(source);

      return () => sources.delete(source);
    },
    collect: async (context) => {
      const problems: string[] = [];
      const gathered: CollectedTool[] = [];

      for (const source of [...sources]) {
        try {
          gathered.push(...(await source.collect(context)));
        } catch (cause) {
          // Источник, который отказал, не срывает сборку: без остальных инструментов сессия
          // осталась бы вовсе без набора.
          problems.push(
            `the tool source ${source.id} failed: ${cause instanceof Error ? cause.message : String(cause)}`,
          );
        }
      }

      const byName = new Map<string, CollectedTool[]>();

      for (const tool of gathered) {
        byName.set(tool.name, [...(byName.get(tool.name) ?? []), tool]);
      }

      const tools: CollectedTool[] = [];

      for (const [name, claimants] of byName) {
        // Спор за имя разрешается общим правилом реестра вкладов: не применяется ни один, и оба
        // автора названы (docs/plugins.md).
        if (claimants.length > 1) {
          problems.push(
            `the tool ${name} is claimed by ${claimants.map((tool) => tool.group).join(", ")} and none of them applies`,
          );

          continue;
        }

        const single = claimants[0];

        if (single !== undefined) {
          tools.push(single);
        }
      }

      tools.sort(byGroupThenOrderThenName);

      return { tools, problems };
    },
  };
}

/** Порядок сборки: группа, затем порядок, затем имя (docs/hooks.md). */
function byGroupThenOrderThenName(left: CollectedTool, right: CollectedTool): number {
  if (left.group !== right.group) {
    return left.group < right.group ? -1 : 1;
  }

  if (left.order !== right.order) {
    return left.order - right.order;
  }

  return left.name < right.name ? -1 : 1;
}
