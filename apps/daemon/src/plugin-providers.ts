/**
 * Мост между каналом плагина и каталогом провайдеров (docs/models-and-providers.md).
 *
 * Отдельно от супервизора по той же причине, по какой отдельно `plugin-events.ts`: супервизор
 * решает, жив ли плагин, а здесь решается, что плагину ответить. Супервизор про каталог не знает.
 *
 * **Значение креда через этот мост не проходит.** Наружу уезжают только операции и статус: у
 * `ProviderSummary` поля со значением нет, и появиться ему неоткуда — единственный писатель кредов
 * платформа, а читателя нет вовсе.
 */

import type { ProviderCatalogue } from "@sovereign/agent-runtime-pi";
import {
  coreEventTypes,
  type LoginConclusion,
  type LoginNotice,
  type LoginPrompt,
  type LoginStep,
  type ModelSummary,
  type ProviderAuthState,
  type ProviderSummary,
  type RefreshReport,
} from "@sovereign/protocol";
import type {
  LoginConclusion as PluginLoginConclusion,
  LoginNotice as PluginLoginNotice,
  LoginPrompt as PluginLoginPrompt,
  LoginStep as PluginLoginStep,
  ModelSummary as PluginModelSummary,
  ProviderAuthState as PluginProviderAuthState,
  ProviderRequest,
  ProviderResponse,
  ProviderSummary as PluginProviderSummary,
  RefreshReport as PluginRefreshReport,
} from "@sovereign/sdk";

import type { ContributingPlugin } from "./contribution-registry.ts";
import type { CredentialStore } from "./credential-store.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";
import type { PluginCall } from "./plugin-supervisor.ts";
import type { PluginLoginReply } from "./plugin-wire.ts";
import type { ProviderLogins } from "./provider-logins.ts";

/**
 * Тождество копии типа. SDK объявляет `ProviderSummary`, `ModelSummary` и остальное **своей
 * копией**: он ставится извне и внутренних пакетов не тянет (docs/plugins.md). Копия обязана
 * совпадать с протоколом до поля, и ловится это здесь.
 *
 * Присваивание идёт в **обе стороны**: `toPlugin` требует, чтобы тип протокола присваивался копии,
 * `toCore` — чтобы копия присваивалась протоколу. Разъехавшись, копии перестанут компилироваться в
 * этом файле — раньше, чем автор плагина увидит поле, которого у него нет.
 */
function sameShape<Core, Plugin>(bothWays: {
  toPlugin: (value: Core) => Plugin;
  toCore: (value: Plugin) => Core;
}): (value: Core) => Plugin {
  return bothWays.toPlugin;
}

const providerForPlugin = sameShape<ProviderSummary, PluginProviderSummary>({
  toPlugin: (summary) => summary,
  toCore: (summary) => summary,
});

const modelForPlugin = sameShape<ModelSummary, PluginModelSummary>({
  toPlugin: (model) => model,
  toCore: (model) => model,
});

const authStateForPlugin = sameShape<ProviderAuthState, PluginProviderAuthState>({
  toPlugin: (state) => state,
  toCore: (state) => state,
});

const refreshReportForPlugin = sameShape<RefreshReport, PluginRefreshReport>({
  toPlugin: (report) => report,
  toCore: (report) => report,
});

const promptForPlugin = sameShape<LoginPrompt, PluginLoginPrompt>({
  toPlugin: (prompt) => prompt,
  toCore: (prompt) => prompt,
});

const noticeForPlugin = sameShape<LoginNotice, PluginLoginNotice>({
  toPlugin: (notice) => notice,
  toCore: (notice) => notice,
});

const conclusionForPlugin = sameShape<LoginConclusion, PluginLoginConclusion>({
  toPlugin: (conclusion) => conclusion,
  toCore: (conclusion) => conclusion,
});

/**
 * Шаг плагину. Конец диалога сюда не попадает: он приезжает **ответом** на вызов входа, поэтому у
 * `LoginStep` в SDK вида `conclusion` нет вовсе — у одного результата не бывает двух мест.
 */
function stepForPlugin(step: LoginStep): PluginLoginStep | undefined {
  switch (step.kind) {
    case "prompt":
      return { kind: "prompt", prompt: promptForPlugin(step.prompt) };
    case "notice":
      return { kind: "notice", notice: noticeForPlugin(step.notice) };
    case "conclusion":
      return undefined;
  }
}

export type PluginProviders = {
  /** Ответить на запрос плагина. Отдаётся супервизору как `onRequest`. */
  request: (
    plugin: ContributingPlugin,
    request: ProviderRequest,
    call: PluginCall,
  ) => Promise<ProviderResponse>;
  /** Ответ плагина на вопрос входа. Отдаётся супервизору как `onLoginReply`. */
  reply: (plugin: ContributingPlugin, reply: PluginLoginReply) => void;
  /** Плагина больше нет: занятый им слот провайдера освобождается. Супервизору — `onPluginGone`. */
  remove: (pluginKey: string) => void;
};

export type CreatePluginProvidersOptions = {
  /**
   * Каталог тот же, что у веб-API и у входа: второй экземпляр означал бы вторую коллекцию
   * провайдеров, и зарегистрированное плагином не было бы видно человеку.
   */
  catalogue: Pick<ProviderCatalogue, "snapshot" | "models" | "status" | "refresh" | "logout">;
  /** Реестр попыток тот же, что у маршрутов: провайдер занят один на всю платформу. */
  logins: Pick<
    ProviderLogins,
    "start" | "answer" | "cancel" | "cancelOwnedBy" | "runningFor" | "subscribe"
  >;
  /**
   * Поверх негодного файла кредов платформа не пишет: начинать диалог, который заведомо не сможет
   * сохранить результат, значит тратить время впустую — ровно как в маршруте входа.
   */
  credentials: Pick<CredentialStore, "problem">;
  bus: Pick<EventBus, "publish">;
  logger: Logger;
};

/** Ключ идущего входа: пара «чей плагин» и «какой вызов». Внутри воркера `requestId` уникален. */
const loginKey = (pluginKey: string, requestId: string): string => `${pluginKey}\n${requestId}`;

export function createPluginProviders(options: CreatePluginProvidersOptions): PluginProviders {
  const { catalogue } = options;

  /** Идущие входы плагинов: ключ вызова — идентификатор попытки, которую он начал. */
  const running = new Map<string, string>();

  /**
   * Вход целиком: от начала попытки до её конца. Обещание разрешается концом диалога, поэтому
   * плагин видит один результат в одном месте — там же, где позвал.
   */
  const login = (
    plugin: ContributingPlugin,
    request: Extract<ProviderRequest, { kind: "login" }>,
    call: PluginCall,
  ): Promise<ProviderResponse> =>
    new Promise<ProviderResponse>((resolve) => {
      const key = loginKey(plugin.key, call.requestId);

      // Подписка ставится **до** начала попытки: первый шаг рантайм вправе сказать ещё внутри
      // `start`, и подписавшись после, его потеряли бы. Идентификатора попытки в этот момент ещё
      // нет — зато вход в одного провайдера идёт ровно один, и провайдера хватает, чтобы узнать
      // свою попытку.
      const unsubscribe = options.logins.subscribe((attempt, step) => {
        if (attempt.providerId !== request.providerId) {
          return;
        }

        if (step.kind === "conclusion") {
          unsubscribe();
          running.delete(key);
          resolve({ kind: "login", conclusion: conclusionForPlugin(step.conclusion) });

          return;
        }

        const carried = stepForPlugin(step);

        if (carried !== undefined) {
          call.sendLoginStep(carried);
        }
      });

      const outcome = options.logins.start({
        providerId: request.providerId,
        method: request.method,
        origin: "plugin",
        // Владелец попытки — сам плагин: по нему же она гасится при его выгрузке.
        owner: plugin.key,
      });

      if (outcome.kind === "taken") {
        unsubscribe();
        resolve({
          kind: "failed",
          reason: `a login into ${request.providerId} is already running`,
        });

        return;
      }

      running.set(key, outcome.attempt.attemptId);
      options.logger.info("a plugin started a provider login", {
        plugin: plugin.key,
        providerId: request.providerId,
        attemptId: outcome.attempt.attemptId,
      });
    });

  return {
    reply: (plugin, reply) => {
      const key = loginKey(plugin.key, reply.requestId);
      const attemptId = running.get(key);

      // Попытки уже нет: она кончилась, пока ответ ехал. Отвечать нечему.
      if (attemptId === undefined) {
        return;
      }

      if (reply.kind === "login-cancel") {
        options.logins.cancel(attemptId, plugin.key);

        return;
      }

      const answered = options.logins.answer(attemptId, reply.stepId, reply.value, plugin.key);

      if (answered.kind !== "answered") {
        // Устаревший шаг — не ошибка канала: попытка могла кончиться сама. Отказ уходит в журнал,
        // а не в отмену входа.
        options.logger.debug("the answer of a plugin did not reach a login step", {
          plugin: plugin.key,
          attemptId,
          outcome: answered.kind,
        });
      }
    },
    remove: (pluginKey) => {
      // Мёртвый воркер не имеет права держать провайдера занятым: отвечать на его вопросы больше
      // некому, и без этого войти было бы нельзя до перезапуска демона.
      options.logins.cancelOwnedBy(pluginKey);

      for (const key of [...running.keys()]) {
        if (key.startsWith(`${pluginKey}\n`)) {
          running.delete(key);
        }
      }
    },
    request: async (plugin, request, call) => {
      switch (request.kind) {
        case "list": {
          const snapshot = await catalogue.snapshot();

          return { kind: "list", providers: snapshot.providers.map(providerForPlugin) };
        }
        case "models": {
          const models = catalogue.models(request.providerId);

          return {
            kind: "models",
            ...(models === undefined ? {} : { models: models.map(modelForPlugin) }),
          };
        }
        case "status": {
          const status = await catalogue.status(request.providerId);

          return {
            kind: "status",
            ...(status === undefined ? {} : { status: authStateForPlugin(status) }),
          };
        }
        case "refresh": {
          const report = await catalogue.refresh();

          // То же событие, что у маршрута обновления: динамический список моделей — глобальное
          // состояние, и обновивший его плагин обязан быть виден остальным.
          options.bus.publish(coreEventTypes.providersChanged, {});
          options.logger.info("a plugin refreshed the dynamic model catalogues", {
            plugin: plugin.key,
            providers: report.refreshed.length,
            failed: report.refreshed.filter((outcome) => outcome.error !== undefined).length,
          });

          return { kind: "refresh", report: refreshReportForPlugin(report) };
        }
        case "login": {
          const problem = options.credentials.problem();

          return problem === undefined
            ? login(plugin, request, call)
            : { kind: "failed", reason: problem };
        }
        case "logout": {
          const problem = options.credentials.problem();

          if (problem !== undefined) {
            return { kind: "failed", reason: problem };
          }

          // Сначала отмена, потом выход: идущий вход дописал бы кред обратно уже после удаления.
          const attempt = options.logins.runningFor(request.providerId);

          if (attempt !== undefined) {
            options.logins.cancel(attempt.attemptId);
          }

          await catalogue.logout(request.providerId);
          options.bus.publish(coreEventTypes.providerLogout, { providerId: request.providerId });
          options.logger.info("a plugin logged a provider out", {
            plugin: plugin.key,
            providerId: request.providerId,
          });

          return { kind: "logout" };
        }
      }
    },
  };
}
