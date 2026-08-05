/**
 * Сведение ответов подписчиков на хук (docs/hooks.md). Живёт в области сессий, а не плагинов: зовёт
 * хуки сессия, а граница областей запрещает сессиям знать о плагинах. Реестр подписок наполняет
 * область плагинов — тот же приём, которым она наполняет сборку инструментов
 * (docs/repository-structure.md).
 *
 * Правил слияния четыре, и здесь их три: собирающий — это `tool-collection.ts`, у него своя форма.
 * Наблюдательный не ждут вовсе, решающий опрашивает всех и любой отказ побеждает, перезаписывающий
 * идёт цепочкой.
 *
 * Ни о плагинах, ни о канале воркера диспетчер не знает: подписка приносит с собой `invoke`, а чем
 * он обернут — забота того, кто подписку зарегистрировал.
 */

import {
  coreEventTypes,
  pluginSourceRank,
  projectOfPluginSource,
  type HookCriticality,
  type HookRefusal,
  type PluginSource,
} from "@sovereign/protocol";

import type { EventBus } from "../platform/public.ts";
import type { Logger } from "../platform/public.ts";

/**
 * Чем кончился один вызов подписчика. Форма своя, а не канала плагина: диспетчер живёт в области
 * сессий и о канале не знает. Таймаут отделён от сбоя, потому что исход у них разный: сбой — это
 * ошибка в журнал, а таймаут разбирается по таблице критичности (docs/hooks.md).
 */
export type HookAnswer =
  | { kind: "value"; value: unknown }
  | { kind: "refused"; reason: string }
  | { kind: "failed"; reason: string }
  | { kind: "timed-out" };

export type HookSubscription = {
  /**
   * Идентификатор вклада: он же автор отказа и он же адрес вызова. Не идентификатор плагина —
   * подписок у плагина несколько, и выключать придётся конкретную (docs/hooks.md).
   */
  contributionId: string;
  event: string;
  criticality: HookCriticality;
  /** Источник плагина: по его рангу считается порядок цепочки. */
  source: PluginSource;
  /**
   * Позвать подписчика. Ожидание передаётся вызову, а не берётся им самим: величина живёт в
   * `config.json`, и читает её диспетчер.
   */
  invoke: (payload: unknown, timeoutMilliseconds: number) => Promise<HookAnswer>;
};

/**
 * Кого спрашивают. Проект обязателен: подписка плагина, поставленного в папку проекта, не касается
 * сессий чужого проекта — это то же правило применимости, по которому реестр разрешает вклады
 * (docs/plugins.md).
 */
export type HookAudience = { projectId: string };

/** Исход решающего хука. Разрешение — это пустой список, а не чей-то голос «за» (docs/hooks.md). */
export type HookDecision = { refusals: HookRefusal[] };

export type HookRewrite<Payload> = {
  /** Нагрузка, как её оставила цепочка: вход следующего — выход предыдущего. */
  payload: Payload;
  /**
   * Накопленная поправка для рантайма: поля всех ответов, где ответ более позднего звена побеждает.
   * `undefined` значит «никто ничего не менял» — отдельного способа сказать это нет (docs/hooks.md).
   */
  patch: Record<string, unknown> | undefined;
  /**
   * Критичный подписчик не ответил в срок, и турну продолжаться нельзя. Обрывает его тот, кто звал:
   * способ оборвать зависит от рантайма, а диспетчер о рантайме не знает.
   */
  aborted?: HookRefusal;
};

export type HookDispatcher = {
  /** Возвращает снятие: подписка исчезает вместе с плагином, который её завёл. */
  register: (subscription: HookSubscription) => () => void;
  /** Есть ли кого спрашивать. Рантайм по этому решает, звать ли диспетчер вовсе. */
  subscribed: (event: string, audience: HookAudience) => boolean;
  /**
   * Наблюдательный хук: ядро **не ждёт** ответа. Отсюда то, чего иначе не получить, — наблюдатель
   * плагина не задерживает возврат сессии в `idle` и не может уронить турн (docs/hooks.md).
   */
  observe: (event: string, payload: unknown, audience: HookAudience) => void;
  /** Решающий хук: опрашиваются все, отказы собираются списком. */
  decide: (event: string, payload: unknown, audience: HookAudience) => Promise<HookDecision>;
  /** Перезаписывающий хук: цепочка, где каждый видит нагрузку в том виде, в каком её оставил предыдущий. */
  rewrite: <Payload extends object>(
    event: string,
    payload: Payload,
    audience: HookAudience,
  ) => Promise<HookRewrite<Payload>>;
};

export type CreateHookDispatcherOptions = {
  logger: Logger;
  /** Куда уходит таймаут: он не бывает молчаливым (docs/hooks.md). */
  bus: EventBus;
  /** `hookTimeoutMilliseconds` из `config.json`; читается на каждый вызов — файл перечитывается живым. */
  timeoutMilliseconds: () => number;
};

export function createHookDispatcher(options: CreateHookDispatcherOptions): HookDispatcher {
  const { logger, bus } = options;
  const subscriptions = new Set<HookSubscription>();

  const forEvent = (event: string, audience: HookAudience): HookSubscription[] =>
    [...subscriptions]
      .filter((subscription) => subscription.event === event && applies(subscription, audience))
      .sort(byRankThenId);

  const reportTimeout = (
    subscription: HookSubscription,
    outcome: "refused" | "skipped" | "aborted-the-turn",
    waitedMilliseconds: number,
  ): void => {
    logger.warn("the hook subscription did not answer in time", {
      contribution: subscription.contributionId,
      event: subscription.event,
      criticality: subscription.criticality,
      outcome,
      waitedMilliseconds,
    });
    bus.publish(coreEventTypes.hookTimedOut, {
      contributionId: subscription.contributionId,
      event: subscription.event,
      criticality: subscription.criticality,
      outcome,
      waitedMilliseconds,
    });
  };

  const reportFailure = (subscription: HookSubscription, reason: string): void => {
    // Исключение подписчика — ошибка в журнал, и только: до рантайма ему доходить нельзя, там оно
    // роняет турн, а глушить его молча значило бы терять причину (docs/hooks.md).
    logger.error("the hook subscription failed", {
      contribution: subscription.contributionId,
      event: subscription.event,
      reason,
    });
  };

  /** Вызов, который не бросает: исключение обёртки — такой же сбой, как исключение подписчика. */
  const ask = async (
    subscription: HookSubscription,
    payload: unknown,
    timeoutMilliseconds: number,
  ): Promise<HookAnswer> => {
    try {
      return await subscription.invoke(payload, timeoutMilliseconds);
    } catch (cause) {
      return { kind: "failed", reason: cause instanceof Error ? cause.message : String(cause) };
    }
  };

  return {
    register: (subscription) => {
      subscriptions.add(subscription);

      return () => subscriptions.delete(subscription);
    },
    subscribed: (event, audience) => forEvent(event, audience).length > 0,
    observe: (event, payload, audience) => {
      const timeoutMilliseconds = options.timeoutMilliseconds();

      for (const subscription of forEvent(event, audience)) {
        // Ответ никого не интересует, а вот сбой интересует: наблюдатель, который падает молча,
        // выглядит как наблюдатель, которого не звали.
        void ask(subscription, payload, timeoutMilliseconds).then((answer) => {
          if (answer.kind === "failed") {
            reportFailure(subscription, answer.reason);
          }
        });
      }
    },
    decide: async (event, payload, audience) => {
      const timeoutMilliseconds = options.timeoutMilliseconds();
      const asked = forEvent(event, audience);
      // Опрашиваются все и одновременно: последовательный опрос складывал бы ожидания подписчиков.
      const answers = await Promise.all(
        asked.map((subscription) => ask(subscription, payload, timeoutMilliseconds)),
      );
      const refusals: HookRefusal[] = [];

      answers.forEach((answer, index) => {
        const subscription = asked[index];

        if (subscription === undefined) {
          return;
        }

        if (answer.kind === "timed-out") {
          // Пометка критичности решающего хука не меняет ничего: таймаут равен отказу и без неё.
          // Таймаут, считающийся разрешением, выключал бы политику именно под нагрузкой.
          reportTimeout(subscription, "refused", timeoutMilliseconds);
          refusals.push({
            contributionId: subscription.contributionId,
            reason: `the subscription did not answer in ${timeoutMilliseconds} ms`,
          });

          return;
        }

        if (answer.kind === "failed") {
          reportFailure(subscription, answer.reason);

          return;
        }

        if (answer.kind === "refused") {
          refusals.push({ contributionId: subscription.contributionId, reason: answer.reason });
        }
      });

      return { refusals };
    },
    rewrite: async (event, payload, audience) => {
      const timeoutMilliseconds = options.timeoutMilliseconds();
      let current = payload;
      let patch: Record<string, unknown> | undefined;

      for (const subscription of forEvent(event, audience)) {
        const answer = await ask(subscription, current, timeoutMilliseconds);

        if (answer.kind === "timed-out") {
          if (subscription.criticality === "critical") {
            reportTimeout(subscription, "aborted-the-turn", timeoutMilliseconds);

            return {
              payload: current,
              patch,
              aborted: {
                contributionId: subscription.contributionId,
                reason: `the critical subscription did not answer in ${timeoutMilliseconds} ms`,
              },
            };
          }

          // Некритичный: его изменение не применяется, а цепочка идёт дальше — остальные подписчики
          // ни при чём.
          reportTimeout(subscription, "skipped", timeoutMilliseconds);

          continue;
        }

        if (answer.kind === "failed") {
          reportFailure(subscription, answer.reason);

          continue;
        }

        if (answer.kind === "refused") {
          // Перезаписывающему хуку отказывать нечему: запрещать действие умеет решающий. Пометка
          // остаётся в журнале, чтобы автор увидел, что его отказ никого не остановил.
          reportFailure(subscription, `a rewriting hook cannot refuse: ${answer.reason}`);

          continue;
        }

        const change = asFields(answer.value);

        if (change === undefined) {
          continue;
        }

        patch = { ...patch, ...change };
        current = withKnownFields(current, change);
      }

      return { payload: current, patch };
    },
  };
}

/**
 * Подписка плагина проекта применима только к сессиям своего проекта. Непроектный источник —
 * встроенный и папка данных — применим ко всем: это та же применимость, что у остальных вкладов.
 */
function applies(subscription: HookSubscription, audience: HookAudience): boolean {
  const project = projectOfPluginSource(subscription.source);

  return project === undefined || project === audience.projectId;
}

/** Порядок цепочки: ранг источника, затем идентификатор вклада (docs/hooks.md). */
function byRankThenId(left: HookSubscription, right: HookSubscription): number {
  const byRank = pluginSourceRank(left.source) - pluginSourceRank(right.source);

  // Идём от менее специфичного источника к более специфичному: последнее слово за более частным.
  return byRank !== 0 ? byRank : left.contributionId.localeCompare(right.contributionId, "en");
}

/** Пустой ответ — это «мне нечего добавить», и он же ответ обработчика, вернувшего `void`. */
function asFields(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }

  const fields = value as Record<string, unknown>;

  return Object.keys(fields).length === 0 ? undefined : fields;
}

/**
 * Следующее звено видит нагрузку с заменёнными полями — но только теми, которые у нагрузки есть.
 * Ответ рантайма это **поправка**, а не та же форма: у `session_before_compact` в ответе лежит
 * `cancel`, которого у события нет, и дописывать его в нагрузку значило бы отдать следующему
 * подписчику событие, которого у Pi не бывает.
 */
function withKnownFields<Payload extends object>(
  payload: Payload,
  change: Record<string, unknown>,
): Payload {
  const known = Object.fromEntries(
    Object.entries(change).filter(([field]) => field in payload),
  ) as Partial<Payload>;

  return Object.keys(known).length === 0 ? payload : { ...payload, ...known };
}
