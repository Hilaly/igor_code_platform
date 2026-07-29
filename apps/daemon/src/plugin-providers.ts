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
  type ModelSummary,
  type ProviderAuthState,
  type ProviderSummary,
  type RefreshReport,
} from "@sovereign/protocol";
import type {
  ModelSummary as PluginModelSummary,
  ProviderAuthState as PluginProviderAuthState,
  ProviderRequest,
  ProviderResponse,
  ProviderSummary as PluginProviderSummary,
  RefreshReport as PluginRefreshReport,
} from "@sovereign/sdk";

import type { ContributingPlugin } from "./contribution-registry.ts";
import type { EventBus } from "./event-bus.ts";
import type { Logger } from "./logger.ts";

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

export type PluginProviders = {
  /** Ответить на запрос плагина. Отдаётся супервизору как `onRequest`. */
  request: (plugin: ContributingPlugin, request: ProviderRequest) => Promise<ProviderResponse>;
};

export type CreatePluginProvidersOptions = {
  /**
   * Каталог тот же, что у веб-API и у входа: второй экземпляр означал бы вторую коллекцию
   * провайдеров, и зарегистрированное плагином не было бы видно человеку.
   */
  catalogue: Pick<ProviderCatalogue, "snapshot" | "models" | "status" | "refresh">;
  bus: Pick<EventBus, "publish">;
  logger: Logger;
};

export function createPluginProviders(options: CreatePluginProvidersOptions): PluginProviders {
  const { catalogue } = options;

  return {
    request: async (plugin, request) => {
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
      }
    },
  };
}
