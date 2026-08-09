/**
 * Команды плагина (docs/ui-extension-model.md). У команды нет содержимого — только исполнение,
 * поэтому одну и ту же команду зовут кнопкой в месте «действие», палитрой и кодом чужого плагина.
 *
 * Обработчик — экспорт браузерного бандла, а значит вызов обязан дождаться загрузки. Ждать умеет
 * только тот, кто видит кеш модулей, — отсюда хук, а не свободная функция.
 */

import { resolveCommand, type CommandContributionRegistration } from "@sovereign/protocol";
import { Button } from "@sovereign/ui-kit";
import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { useDiagnosticVoice } from "./diagnostics.ts";
import type { PluginModuleLoad } from "./host.tsx";
import {
  BrowserRuntimeContext,
  type BrowserRuntime,
  type PlaceContext,
} from "./runtime-context.tsx";

/**
 * Дескриптор команды: то, что плагин экспортирует из браузерного бандла.
 *
 * `available` — обычный предикат в том же realm, что и `run`; декларативного условия здесь нет и не
 * будет. Скрыть команду он не может, только выключить: исчезающая кнопка потребовала бы решения **до**
 * загрузки кода, а выключенная деградирует мягко.
 */
export type Command = {
  run(context: PlaceContext): void | Promise<void>;
  available?(context: PlaceContext): boolean;
};

/**
 * Чем кончился вызов. Значением, а не исключением: команда — действие интерфейса, и брошенное из неё
 * исключение уронило бы дерево React у того, кто её позвал.
 */
export type CommandOutcome =
  | { kind: "done" }
  /** Команда есть, но в этом контексте отказалась исполняться. */
  | { kind: "unavailable" }
  /** Такой команды нет в действующем наборе этого контекста. */
  | { kind: "unknown" }
  /** Бандл не загрузился, экспорта нет или обработчик бросил. */
  | { kind: "failed"; reason: string };

export type CommandInvoker = {
  invoke(commandId: string, context?: PlaceContext): Promise<CommandOutcome>;
};

/**
 * Поверхность вызова команд. Отдаётся и хосту, и плагину: адрес команды разрешается по тому же
 * снимку и тем же правилам контекста, кто бы ни звал.
 */
export function useCommands(): CommandInvoker {
  const runtime = useContext(BrowserRuntimeContext);
  const say = useDiagnosticVoice(runtime);
  /**
   * Ожидающие загрузки вызовы. Размонтирование провайдера обязано их завершить: подписка на кеш
   * оборвётся вместе с ним, и обещание, которое некому исполнить, висело бы вечно.
   */
  const waiting = useRef(new Set<(load: PluginModuleLoad) => void>());

  useEffect(() => {
    const abandoned = waiting.current;

    return () => {
      for (const settle of [...abandoned]) {
        settle({ kind: "failed", reason: "the browser runtime went away while the bundle loaded" });
      }
      abandoned.clear();
    };
  }, []);

  const invoke = useCallback(
    async (commandId: string, context: PlaceContext = {}): Promise<CommandOutcome> => {
      if (runtime === undefined) {
        return { kind: "unknown" };
      }

      const registration = resolveCommand(commandId, runtime.contributions, context);

      if (registration === undefined || registration.ownership !== "plugin") {
        return { kind: "unknown" };
      }

      const outcome = await runCommand(runtime, registration, context, waiting.current);

      if (outcome.kind === "failed") {
        say(`the command ${commandId} failed: ${outcome.reason}`);
      }

      return outcome;
    },
    [runtime, say],
  );

  return { invoke };
}

async function runCommand(
  runtime: BrowserRuntime,
  registration: CommandContributionRegistration & { ownership: "plugin" },
  context: PlaceContext,
  waiting: Set<(load: PluginModuleLoad) => void>,
): Promise<CommandOutcome> {
  const status = runtime.plugins.find((plugin) => plugin.key === registration.pluginKey);

  if (status === undefined) {
    return {
      kind: "failed",
      reason: `the plugin ${registration.pluginKey} is not in the snapshot`,
    };
  }

  const load = await settledModule(runtime, status.key, waiting);

  if (load.kind === "failed") {
    return { kind: "failed", reason: load.reason };
  }

  const command = load.module[registration.export];

  if (!isCommand(command)) {
    return {
      kind: "failed",
      reason: `the plugin ${status.key} exports no command ${registration.export}`,
    };
  }
  if (command.available?.(context) === false) {
    return { kind: "unavailable" };
  }

  try {
    await command.run(context);
  } catch (cause: unknown) {
    return { kind: "failed", reason: cause instanceof Error ? cause.message : String(cause) };
  }

  return { kind: "done" };
}

/**
 * Дождаться, пока бандл перестанет быть «в пути». Кеш отвечает состоянием, а не обещанием, поэтому
 * ожидание строится на его же подписке — второй загрузчик рядом означал бы второй `import()`.
 */
function settledModule(
  runtime: BrowserRuntime,
  pluginKey: string,
  waiting: Set<(load: PluginModuleLoad) => void>,
): Promise<Exclude<PluginModuleLoad, { kind: "loading" }>> {
  const current = (): PluginModuleLoad | undefined => {
    const status = runtime.plugins.find((plugin) => plugin.key === pluginKey);

    return status === undefined ? undefined : runtime.cache.moduleOf(status);
  };
  const first = current();

  if (first !== undefined && first.kind !== "loading") {
    return Promise.resolve(first);
  }

  return new Promise((resolve) => {
    let settle: (load: PluginModuleLoad) => void = () => {};
    const unsubscribe = runtime.cache.subscribe(() => {
      const load = current();

      if (load !== undefined && load.kind !== "loading") {
        settle(load);
      }
    });

    settle = (load) => {
      waiting.delete(settle);
      unsubscribe();
      resolve(
        load.kind === "loading" ? { kind: "failed", reason: "the bundle never settled" } : load,
      );
    };
    waiting.add(settle);
  });
}

function isCommand(value: unknown): value is Command {
  return (
    typeof value === "object" && value !== null && typeof (value as Command).run === "function"
  );
}

export type CommandButtonProps = {
  registration: CommandContributionRegistration;
  context: PlaceContext;
};

/**
 * Кнопка команды в месте кардинальности «действие». Заголовок берётся из снимка, поэтому полоса не
 * прыгает по мере загрузки плагинов, а плагин со сломанной сборкой оставляет кнопку, которая честно
 * отвечает отказом, вместо пустоты.
 *
 * Цена названа: доступность известна только загруженному бандлу, и до его загрузки кнопка выглядит
 * доступной. Обещать обратное значило бы обещать решение без кода — то самое, ради чего пришлось бы
 * заводить отвергнутый декларативный язык условий.
 */
export function CommandButton({ registration, context }: CommandButtonProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);
  const { invoke } = useCommands();
  const status =
    registration.ownership === "plugin"
      ? runtime?.plugins.find((plugin) => plugin.key === registration.pluginKey)
      : undefined;
  const load = useSyncExternalStore(runtime?.cache.subscribe ?? emptySubscribe, () =>
    runtime === undefined || status === undefined ? undefined : runtime.cache.moduleOf(status),
  );
  const exported = load?.kind === "loaded" ? load.module[registration.export] : undefined;
  const unavailable = isCommand(exported) && exported.available?.(context) === false;

  return (
    <Button
      size="sm"
      tone="secondary"
      disabled={unavailable}
      onClick={() => {
        void invoke(registration.id, context);
      }}
    >
      {registration.title}
    </Button>
  );
}

function emptySubscribe(): () => void {
  return () => {};
}
