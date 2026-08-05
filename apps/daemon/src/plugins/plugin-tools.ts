/**
 * Инструменты плагинов как источник для `tools_collect` (docs/hooks.md): рядом с источником ядра и
 * той же формы — это и есть шов, ради которого сборка существовала с девятого среза.
 *
 * Источник один на все вклады, а не по источнику на вклад: действующий набор знает реестр, и он же
 * знает про выключенные вклады и про спор одноимённых. Регистрируй по источнику на вклад — придётся
 * держать их список в синхроне с реестром, то есть завести второе место, где написано, какие
 * инструменты действуют.
 */

import { createPluginTool } from "@sovereign/agent-runtime-pi";
import type { ContributionRegistration } from "@sovereign/protocol";

import type { ContributionRegistry } from "./contribution-registry.ts";
import type { Logger } from "../platform/public.ts";
import type { PluginSupervisor } from "./plugin-supervisor.ts";
import type { CollectedTool, ToolSource } from "../sessions/public.ts";

export type PluginToolSourceOptions = {
  registry: ContributionRegistry;
  /** Кого зовём. Нужен только `call`: поднимать и гасить плагины источник не имеет права. */
  plugins: Pick<PluginSupervisor, "call">;
  /**
   * `pluginToolTimeoutMilliseconds` из `config.json`. Своё значение, а не таймаут хуков: инструмент
   * ходит в сеть и ждёт человека, и мерить его пятью секундами значит запретить такие инструменты
   * (docs/data-directory.md).
   */
  timeoutMilliseconds: () => number;
  logger: Logger;
};

export function pluginToolSource(options: PluginToolSourceOptions): ToolSource {
  const { registry, plugins, logger } = options;

  return {
    id: "plugins",
    collect: (context): CollectedTool[] =>
      registry
        .resolvedForProject(context.projectId, "tool")
        .flatMap((registration) =>
          registration.kind === "tool" && registration.ownership === "plugin"
            ? [collected(registration)]
            : [],
        ),
  };

  function collected(
    registration: Extract<ContributionRegistration, { kind: "tool"; ownership: "plugin" }>,
  ): CollectedTool {
    const timeoutMilliseconds = options.timeoutMilliseconds();
    const tool = createPluginTool({
      // Имя, которым инструмент зовёт модель, — объявленный идентификатор: неймспейс с точкой
      // провайдеры в именах инструментов не принимают (docs/hooks.md).
      name: registration.declaredId,
      description: registration.description ?? registration.declaredId,
      parameters: registration.parameters,
      ...(registration.title === undefined ? {} : { label: registration.title }),
      invoke: async (toolArguments) => {
        const outcome = await plugins.call(
          registration.pluginKey,
          { kind: "tool", contributionId: registration.declaredId, arguments: toolArguments },
          { timeoutMilliseconds },
        );

        if (outcome.kind === "value") {
          return invocationOf(registration, outcome.value);
        }

        // Инструмент, который не ответил или сломался, не обрывает турн: модель получает
        // результат-ошибку с названным автором и работает дальше (docs/hooks.md).
        const reason =
          outcome.kind === "timed-out"
            ? `did not answer in ${outcome.waitedMilliseconds} ms`
            : outcome.reason;

        logger.warn("the tool of the plugin did not answer with a result", {
          contribution: registration.id,
          plugin: registration.pluginKey,
          outcome: outcome.kind,
          reason,
        });

        return { content: `the tool ${registration.id} failed: ${reason}`, isError: true };
      },
    });

    return {
      name: tool.name,
      // Группа — плагин: набор виден модели сгруппированным по тому, кто его принёс, а порядок
      // внутри группы задаётся именем. Своего порядка вклад не объявляет (docs/hooks.md).
      group: registration.pluginId,
      order: 0,
      tool: tool.tool,
    };
  }

  /**
   * Что приехало из воркера. Форму держит SDK, но приехала она данными через границу, поэтому
   * непохожий на исход ответ считается сбоем инструмента, а не разворачивается в `undefined`.
   */
  function invocationOf(
    registration: ContributionRegistration,
    value: unknown,
  ): { content: string; isError: boolean } {
    const invoked = (value ?? {}) as { content?: unknown; isError?: unknown };

    if (typeof invoked.content !== "string") {
      logger.error("the tool of the plugin answered with something that is not a result", {
        contribution: registration.id,
      });

      return { content: `the tool ${registration.id} answered with no text`, isError: true };
    }

    return { content: invoked.content, isError: invoked.isError === true };
  }
}
