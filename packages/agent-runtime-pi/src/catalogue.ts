/**
 * Каталог провайдеров: фасад над коллекцией Pi, отдающий наружу только типы протокола
 * (docs/models-and-providers.md).
 *
 * Строится сразу, а не лениво: весь каталог обходится в 31 мс, из которых 30 — импорт пакета,
 * который всё равно случится (docs/runtime-checks.md, проверка 28).
 */

import type { MutableModels } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  ModelSummary,
  ProviderAuthState,
  ProvidersSnapshot,
  ProviderSummary,
  RefreshReport,
} from "@sovereign/protocol";

import { toRuntimeCredentialStore, type CredentialVault } from "./credentials.ts";
import { describeModels, describeProvider } from "./describe.ts";
import { processEnvironment, toRuntimeAuthContext, type Environment } from "./environment.ts";
import { toRuntimeModelsStore, type ModelCatalogVault } from "./model-catalogs.ts";

export type ProviderCatalogue = {
  /** Провайдеры со статусом авторизации. Моделей в снимке нет: их больше тысячи. */
  snapshot: () => Promise<ProvidersSnapshot>;
  /** Модели одного провайдера. `undefined` — такого провайдера нет. */
  models: (providerId: string) => ModelSummary[] | undefined;
  /**
   * Перечитать динамические списки моделей. Обновление по одному провайдеру рантайм не умеет:
   * `refresh()` обходит все настроенные динамические провайдеры разом, сам обновляя перед этим
   * OAuth-токены. Разбирать его оркестрацию ради фильтра значило бы переписать её у себя.
   */
  refresh: () => Promise<RefreshReport>;
};

export type CreateProviderCatalogueOptions = {
  credentials: CredentialVault;
  /** Кэш динамических списков моделей. Без него они читаются из сети на каждый старт демона. */
  catalogs?: ModelCatalogVault;
  /** По умолчанию — настоящее окружение процесса. Подменяется только тестами. */
  environment?: Environment;
};

export function createProviderCatalogue(
  options: CreateProviderCatalogueOptions,
): ProviderCatalogue {
  const models: MutableModels = builtinModels({
    credentials: toRuntimeCredentialStore(options.credentials),
    authContext: toRuntimeAuthContext(options.environment ?? processEnvironment()),
    ...(options.catalogs === undefined
      ? {}
      : { modelsStore: toRuntimeModelsStore(options.catalogs) }),
  });

  return {
    snapshot: async () => {
      const problem = options.credentials.problem();
      // Порядок у Pi — порядок регистрации провайдеров; вью показывает список человеку, и
      // перестановка строк при обновлении рантайма выглядела бы поломкой.
      const providers = [...models.getProviders()].sort((first, second) =>
        first.id.localeCompare(second.id),
      );

      const described = await Promise.all(
        providers.map(async (provider): Promise<ProviderSummary> => {
          const auth =
            problem === undefined
              ? await authStateOf(models, provider.id)
              : ({ kind: "unknown" } as const);

          return describeProvider(provider, { auth, custom: false });
        }),
      );

      return { providers: described, ...(problem === undefined ? {} : { problem }) };
    },
    models: (providerId) => {
      const provider = models.getProvider(providerId);

      return provider === undefined ? undefined : describeModels(provider);
    },
    refresh: async () => {
      const result = await models.refresh();
      // Обход не отклоняется на ошибке провайдера: у одного список не приехал, у остальных приехал,
      // и человеку надо сказать и то, и другое.
      const refreshed = [...models.getProviders()]
        .filter((provider) => typeof provider.refreshModels === "function")
        .map((provider) => {
          const failure = result.errors.get(provider.id);

          return {
            providerId: provider.id,
            modelCount: describeModels(provider).length,
            ...(failure === undefined ? {} : { error: failure.message }),
          };
        });

      return { refreshed, aborted: result.aborted };
    },
  };
}

/**
 * Статус спрашивается через `checkAuth`, а не через `getAuth`. Разница не косметическая: `getAuth`
 * обновляет протухший OAuth-токен, то есть на отрисовке вью ходит в сеть и пишет в хранилище. Плюс
 * `ApiKeyAuth.resolve` у Pi вправе исполнять команды, а `check` объявлен проверкой без побочных
 * эффектов (docs/agent-runtime-contract.md).
 */
async function authStateOf(models: MutableModels, providerId: string): Promise<ProviderAuthState> {
  let check;

  try {
    check = await models.checkAuth(providerId);
  } catch {
    // Кред этого провайдера не читается — например, его правили руками. Остальных это не касается,
    // и «сказать нечем» здесь честнее, чем «не настроен»: чинится оно по-другому.
    return { kind: "unknown" };
  }

  if (check === undefined) {
    return { kind: "unconfigured" };
  }

  return {
    kind: "configured",
    type: check.type,
    ...(check.source === undefined ? {} : { source: check.source }),
  };
}
