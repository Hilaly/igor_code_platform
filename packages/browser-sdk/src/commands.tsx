/**
 * Команды плагина (docs/ui-extension-model.md). У команды нет содержимого — только исполнение,
 * поэтому одну и ту же команду зовут кнопкой в месте «действие», палитрой и кодом чужого плагина.
 *
 * Обработчик — экспорт браузерного бандла, а значит вызов обязан дождаться загрузки. Ждать умеет
 * только тот, кто видит кеш модулей, — отсюда хук, а не свободная функция.
 */

import {
  commandsForContext,
  resolveCommand,
  type CommandContributionRegistration,
} from "@sovereign/protocol";
import { Button } from "@sovereign/ui-kit";
import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";
import type { ReactNode } from "react";

import { useDiagnosticVoice } from "./diagnostics.ts";
import type { LoadedPluginModule, PluginModuleCache } from "./host.tsx";
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
  const runtimeRef = useRef(runtime);
  const sayRef = useRef(say);
  runtimeRef.current = runtime;
  sayRef.current = say;
  /**
   * Ожидающие загрузки вызовы. Размонтирование провайдера обязано их завершить: подписка на кеш
   * оборвётся вместе с ним, и обещание, которое некому исполнить, висело бы вечно.
   */
  const waiting = useRef(new Set<WaitingCheck>());

  useEffect(() => {
    for (const check of [...waiting.current]) {
      check();
    }
  }, [runtime]);

  useEffect(() => {
    const abandoned = waiting.current;

    return () => {
      for (const check of [...abandoned]) {
        check("the browser runtime went away while the bundle loaded");
      }
      abandoned.clear();
    };
  }, []);

  const invoke = useCallback(
    async (commandId: string, context: PlaceContext = {}): Promise<CommandOutcome> => {
      const current = runtimeRef.current;

      if (current === undefined) {
        return { kind: "unknown" };
      }

      const registration = resolveCommand(commandId, current.contributions, context);

      if (registration === undefined || registration.ownership !== "plugin") {
        return { kind: "unknown" };
      }

      let outcome: CommandOutcome;

      try {
        outcome = await runCommand(runtimeRef, commandId, context, waiting.current);
      } catch (cause: unknown) {
        outcome = { kind: "failed", reason: reasonOf(cause) };
      }

      if (outcome.kind === "failed") {
        sayRef.current(`the command ${commandId} failed: ${outcome.reason}`);
      }

      return outcome;
    },
    [],
  );

  return { invoke };
}

/**
 * Команды, действующие в этом контексте. Палитра показывает набор целиком, поэтому ей нужен не
 * адресный поиск, а перечень — с теми же отбором по проекту и разрешением спора.
 */
export function useCommandCatalog(context: PlaceContext): CommandContributionRegistration[] {
  const runtime = useContext(BrowserRuntimeContext);

  return runtime === undefined ? [] : commandsForContext(runtime.contributions, context);
}

async function runCommand(
  runtimeRef: { current: BrowserRuntime | undefined },
  commandId: string,
  context: PlaceContext,
  waiting: Set<WaitingCheck>,
): Promise<CommandOutcome> {
  for (;;) {
    const settled = await settledCommandModule(runtimeRef, commandId, context, waiting);

    if (settled.kind === "failed") {
      return settled;
    }

    // Promise continuation is a new microtask. Re-read once more before calling plugin code so a
    // runtime update between the cache announcement and this continuation cannot revive a revision.
    const current = inspectCommandModule(runtimeRef.current, commandId, context);

    if (current.kind === "waiting") {
      continue;
    }
    if (current.kind === "failed") {
      return current;
    }

    try {
      const command = current.module[current.registration.export];

      if (!isCommand(command)) {
        return {
          kind: "failed",
          reason: `the plugin ${current.registration.pluginKey} exports no command ${current.registration.export}`,
        };
      }
      if (command.available?.(context) === false) {
        return { kind: "unavailable" };
      }

      await command.run(context);
      return { kind: "done" };
    } catch (cause: unknown) {
      return { kind: "failed", reason: reasonOf(cause) };
    }
  }
}

type WaitingCheck = (abandonedReason?: string) => void;

type CommandModuleState =
  | { kind: "waiting"; cache: PluginModuleCache }
  | {
      kind: "loaded";
      module: LoadedPluginModule;
      registration: CommandContributionRegistration & { ownership: "plugin" };
    }
  | { kind: "failed"; reason: string };

function inspectCommandModule(
  runtime: BrowserRuntime | undefined,
  commandId: string,
  context: PlaceContext,
): CommandModuleState {
  if (runtime === undefined) {
    return { kind: "failed", reason: "the browser runtime went away while the bundle loaded" };
  }

  const registration = resolveCommand(commandId, runtime.contributions, context);

  if (registration === undefined || registration.ownership !== "plugin") {
    return {
      kind: "failed",
      reason: `the command ${commandId} left the snapshot while its bundle loaded`,
    };
  }

  const status = runtime.plugins.find((plugin) => plugin.key === registration.pluginKey);

  if (status === undefined) {
    return {
      kind: "failed",
      reason: `the plugin ${registration.pluginKey} is not in the snapshot`,
    };
  }

  const load = runtime.cache.load(status);

  if (load.kind === "loading") {
    return { kind: "waiting", cache: runtime.cache };
  }
  if (load.kind === "failed") {
    return load;
  }

  return { kind: "loaded", module: load.module, registration };
}

/**
 * Дождаться текущей ревизии. Изменение runtime будит check из хука, а смена cache заставляет этот
 * waiter снять прежнюю подписку и слушать новый экземпляр.
 */
function settledCommandModule(
  runtimeRef: { current: BrowserRuntime | undefined },
  commandId: string,
  context: PlaceContext,
  waiting: Set<WaitingCheck>,
): Promise<Exclude<CommandModuleState, { kind: "waiting" }>> {
  return new Promise((resolve) => {
    let subscribedCache: PluginModuleCache | undefined;
    let unsubscribe = () => {};
    let finished = false;

    const finish = (state: Exclude<CommandModuleState, { kind: "waiting" }>): void => {
      if (finished) {
        return;
      }

      finished = true;
      waiting.delete(check);
      unsubscribe();
      resolve(state);
    };

    const check: WaitingCheck = (abandonedReason) => {
      if (abandonedReason !== undefined) {
        finish({ kind: "failed", reason: abandonedReason });
        return;
      }

      let state: CommandModuleState;

      try {
        state = inspectCommandModule(runtimeRef.current, commandId, context);
      } catch (cause: unknown) {
        finish({ kind: "failed", reason: reasonOf(cause) });
        return;
      }

      if (state.kind !== "waiting") {
        finish(state);
        return;
      }

      if (state.cache !== subscribedCache) {
        unsubscribe();
        subscribedCache = state.cache;
        unsubscribe = state.cache.subscribe(check);
      }
    };

    waiting.add(check);
    check();
  });
}

function isCommand(value: unknown): value is Command {
  return (
    typeof value === "object" && value !== null && typeof (value as Command).run === "function"
  );
}

function reasonOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
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
    runtime === undefined || status === undefined ? undefined : runtime.cache.load(status),
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
