/**
 * Коллекция моделей глазами одной сессии (docs/model-routing.md).
 *
 * Harness ходит в провайдера **только** через `Models`, и коллекцию ему передаём мы. Отсюда и место
 * врезки: фасад на сессию подставляет её ключ в каждый запрос и после отказа берётся за следующую
 * попытку — не трогая ни общий каталог, ни сам рантайм.
 *
 * **Переход возможен только до первого содержательного события.** События копятся, пока не станет
 * ясно, что попытка удалась; отказ до этого момента невидим для ленты, а после — обычный упавший
 * турн, как раньше. Повтор после начала ответа удвоил бы уже показанный текст.
 */

import { createAssistantMessageEventStream } from "@earendil-works/pi-ai";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  Context,
  Model,
  ModelAuth,
  Models,
  ModelsSimpleStreamOptions,
  ProviderHeaders,
} from "@earendil-works/pi-ai";
import {
  classifyFailure,
  planRoute,
  type Attempt,
  type Candidate,
  type KeyVerdict,
} from "@sovereign/model-routing";

/** Что фасаду нужно знать про ключи и кандидатов. Всё остальное он берёт у коллекции. */
export type SessionRouter = {
  /**
   * Чем можно ходить вместо этой модели, по порядку. Сегодня это она сама; с алиасами — список,
   * который назвал человек.
   */
  candidatesFor: (model: Model<Api>) => Candidate[];
  /** Ключи провайдера по порядку пригодности. Пустой список — ходить кредом окружения. */
  keysOf: (providerId: string) => string[];
  /**
   * Ключ новой сессии. Годные раздаются по кругу, поэтому две сессии подряд берут разные ключи —
   * без этого все начинали бы с одного и того же (docs/model-routing.md).
   */
  lease: (providerId: string) => string | undefined;
  /** Авторизация ключа. `undefined` — ключа нет, и запрос идёт обычным путём рантайма. */
  authFor: (attempt: Attempt) => Promise<ModelAuth | undefined>;
  /** Что случилось с ключом попытки. */
  report: (attempt: Attempt, verdict: KeyVerdict | "success") => void;
  /**
   * Сессия берётся за следующую попытку. Наблюдение: в дерево сессии это не пишется — переключение
   * сделал не человек, и восстанавливать его при перечитывании сессии нечего.
   */
  onSwitch?: (from: Attempt, to: Attempt, reason: string) => void;
};

export type CreateSessionModelsOptions = {
  /** Общий каталог. Второй экземпляр означал бы вторые креды и второй кэш списков. */
  models: Models;
  router: SessionRouter;
};

export function createSessionModels(options: CreateSessionModelsOptions): Models {
  const base = options.models;
  const { router } = options;

  /** Чем сессия ходит сейчас. Держится до отказа — в этом вся липкость. */
  let sticky: Attempt | undefined;

  const route = (model: Model<Api>): Attempt[] => {
    const candidates = router.candidatesFor(model);
    const first = candidates[0];

    // Ключ берётся на первом же запросе, а не при открытии сессии: сессия, которая так и не пошла в
    // модель, не должна занимать место в раздаче по кругу.
    if (sticky === undefined && first !== undefined) {
      const leased = router.lease(first.providerId);

      if (leased !== undefined) {
        sticky = { candidate: first, keyId: leased };
      }
    }

    return planRoute({
      candidates,
      keysOf: router.keysOf,
      ...(sticky === undefined ? {} : { sticky }),
    });
  };

  const modelOf = (attempt: Attempt, requested: Model<Api>): Model<Api> | undefined =>
    attempt.candidate.providerId === requested.provider &&
    attempt.candidate.modelId === requested.id
      ? requested
      : base.getModel(attempt.candidate.providerId, attempt.candidate.modelId);

  /**
   * Один поход. Возвращает либо «уже отдано наружу», либо отказ с виноватым: решение о следующей
   * попытке принимает вызывающий, потому что только он знает, что ещё осталось.
   */
  const attemptOnce = async (
    attempt: Attempt,
    requested: Model<Api>,
    out: AssistantMessageEventStream,
    open: (model: Model<Api>, auth: ModelAuth | undefined) => AssistantMessageEventStream,
  ): Promise<
    { kind: "settled" } | { kind: "failed"; event: AssistantMessageEvent; retry: boolean }
  > => {
    const model = modelOf(attempt, requested);

    if (model === undefined) {
      return {
        kind: "failed",
        event: failure(requested, `the model ${attempt.candidate.modelId} is not available`),
        retry: true,
      };
    }

    let auth: ModelAuth | undefined;

    try {
      auth = await router.authFor(attempt);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);

      router.report(attempt, { kind: "refused", reason });

      return { kind: "failed", event: failure(model, reason), retry: true };
    }

    const inner = open(model, auth);
    /** События до первого содержательного. Пока они здесь, попытку ещё можно заменить. */
    const held: AssistantMessageEvent[] = [];
    let committed = false;

    for await (const event of inner) {
      if (event.type === "error") {
        if (committed) {
          out.push(event);
          out.end();

          return { kind: "settled" };
        }

        const verdict = classifyFailure({ message: event.error.errorMessage ?? "" });

        if (verdict.blame === "key" && attempt.keyId !== undefined) {
          router.report(attempt, verdict.verdict);
        }

        return { kind: "failed", event, retry: verdict.blame !== "none" };
      }

      if (!committed && event.type === "start") {
        held.push(event);

        continue;
      }

      if (!committed) {
        committed = true;
        router.report(attempt, "success");
        sticky = attempt;

        for (const withheld of held) {
          out.push(withheld);
        }
      }

      out.push(event);

      if (event.type === "done") {
        out.end();

        return { kind: "settled" };
      }
    }

    // Поток кончился, не сказав ни `done`, ни `error`. Для рантайма это невозможно, но молчаливое
    // зависание турна хуже названного отказа.
    return {
      kind: "failed",
      event: failure(model, "the provider stream ended without an answer"),
      retry: false,
    };
  };

  const runRoute = (
    requested: Model<Api>,
    open: (model: Model<Api>, auth: ModelAuth | undefined) => AssistantMessageEventStream,
  ): AssistantMessageEventStream => {
    const out = createAssistantMessageEventStream();

    void (async () => {
      const attempts = route(requested);
      let last: AssistantMessageEvent | undefined;
      let tried = 0;

      for (const attempt of attempts) {
        const outcome = await attemptOnce(attempt, requested, out, open);

        tried += 1;

        if (outcome.kind === "settled") {
          return;
        }

        last = outcome.event;

        if (!outcome.retry) {
          break;
        }

        const next = attempts[tried];

        if (next !== undefined) {
          router.onSwitch?.(attempt, next, reasonOf(outcome.event));
        }
      }

      out.push(last ?? failure(requested, "the session has nothing to reach the model with"));
      out.end();
    })();

    return out;
  };

  /**
   * Опции запроса под выбранный ключ. Тип здесь намеренно широкий: у `stream` он зависит от api
   * модели, а нам всё равно — мы добавляем три поля, объявленных у общего `StreamOptions`.
   */
  const withAuth = (
    streamOptions: object | undefined,
    auth: ModelAuth | undefined,
  ): ModelsSimpleStreamOptions => {
    const carried = (streamOptions ?? {}) as ModelsSimpleStreamOptions;

    if (auth === undefined) {
      return carried;
    }

    return {
      ...carried,
      ...(auth.apiKey === undefined ? {} : { apiKey: auth.apiKey }),
      // Заголовки ставятся последними и поверх собранных: авторизация выбранного ключа не должна
      // просочиться в запрос, который идёт другим ключом (docs/model-routing.md).
      transformHeaders: (assembled: ProviderHeaders) => ({ ...assembled, ...auth.headers }),
    };
  };

  const modelWith = (model: Model<Api>, auth: ModelAuth | undefined): Model<Api> =>
    auth?.baseUrl === undefined ? model : { ...model, baseUrl: auth.baseUrl };

  /**
   * Один поход по маршруту. `stream` и `streamSimple` различаются только тем, какую точку входа
   * рантайма звать, — правило перехода у них общее.
   */
  const routed = (
    model: Model<Api>,
    context: Context,
    streamOptions: object | undefined,
    kind: "stream" | "simple",
  ): AssistantMessageEventStream =>
    runRoute(model, (chosen, auth) => {
      const request = withAuth(streamOptions, auth);
      const requested = modelWith(chosen, auth);

      return kind === "simple"
        ? base.streamSimple(requested, context, request)
        : openStream(base, requested, context, request);
    });

  return {
    getProviders: () => base.getProviders(),
    getProvider: (id) => base.getProvider(id),
    getModels: (provider) => base.getModels(provider),
    getModel: (provider, id) => base.getModel(provider, id),
    refresh: (refreshOptions) => base.refresh(refreshOptions),
    checkAuth: (providerId) => base.checkAuth(providerId),
    getAvailable: (providerId) => base.getAvailable(providerId),
    getAuth: ((providerOrModel: never, overrides: never) =>
      base.getAuth(providerOrModel, overrides)) as Models["getAuth"],
    login: (providerId, type, interaction) => base.login(providerId, type, interaction),
    logout: (providerId) => base.logout(providerId),
    stream: ((model: Model<Api>, context: Context, streamOptions?: object) =>
      routed(model, context, streamOptions, "stream")) as Models["stream"],
    complete: ((model: Model<Api>, context: Context, streamOptions?: object) =>
      routed(model, context, streamOptions, "stream").result()) as Models["complete"],
    streamSimple: (model, context, streamOptions) =>
      routed(model, context, streamOptions, "simple"),
    completeSimple: (model, context, streamOptions) =>
      routed(model, context, streamOptions, "simple").result(),
  };
}

/** У `stream` тип опций зависит от api модели; в маршрутизации эта разница ничего не решает. */
function openStream(
  models: Models,
  model: Model<Api>,
  context: Context,
  streamOptions: ModelsSimpleStreamOptions,
): AssistantMessageEventStream {
  const stream = models.stream as (
    model: Model<Api>,
    context: Context,
    options?: ModelsSimpleStreamOptions,
  ) => AssistantMessageEventStream;

  return stream(model, context, streamOptions);
}

function reasonOf(event: AssistantMessageEvent): string {
  return event.type === "error" ? (event.error.errorMessage ?? "the provider request failed") : "";
}

/** Отказ до того, как рантайм успел собрать хоть что-то: сообщение приходится собрать самим. */
function failure(model: Model<Api>, reason: string): AssistantMessageEvent {
  const message: AssistantMessage = {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason: "error",
    errorMessage: reason,
    timestamp: Date.now(),
  };

  return { type: "error", reason: "error", error: message };
}
