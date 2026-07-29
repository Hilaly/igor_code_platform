/**
 * Каталог провайдеров: фасад над коллекцией Pi, отдающий наружу только типы протокола
 * (docs/models-and-providers.md).
 *
 * Строится сразу, а не лениво: весь каталог обходится в 31 мс, из которых 30 — импорт пакета,
 * который всё равно случится (docs/runtime-checks.md, проверка 28).
 */

import type { MutableModels, Provider } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  CustomProviderDefinition,
  CustomProviderOutcome,
  ModelSummary,
  ProviderAuthState,
  ProvidersSnapshot,
  ProviderSummary,
  RefreshReport,
} from "@sovereign/protocol";

import { toRuntimeCredentialStore, type CredentialVault } from "./credentials.ts";
import { toRuntimeProvider } from "./custom-provider.ts";
import { describeModels, describeProvider } from "./describe.ts";
import { processEnvironment, toRuntimeAuthContext, type Environment } from "./environment.ts";
import { toRuntimeInteraction, type LoginDialogue } from "./interaction.ts";
import { toRuntimeModelsStore, type ModelCatalogVault } from "./model-catalogs.ts";

export type ProviderCatalogue = {
  /**
   * Коллекция моделей рантайма. Отдаётся наружу ради сессий агента: harness просит именно её, и
   * второй экземпляр означал бы вторые креды, второй кэш списков и второй набор кастомных
   * провайдеров. Тип из Pi, поэтому за пределами пакета этим значением можно только владеть.
   */
  models: MutableModels;
  /** Провайдеры со статусом авторизации. Моделей в снимке нет: их больше тысячи. */
  snapshot: () => Promise<ProvidersSnapshot>;
  /** Модели одного провайдера. `undefined` — такого провайдера нет. */
  modelsOf: (providerId: string) => ModelSummary[] | undefined;
  /**
   * Статус авторизации одного провайдера. `undefined` — такого провайдера нет. Есть отдельно от
   * снимка, потому что снимок спрашивает статус у всех сорока: спрашивающему про одного это лишние
   * тридцать девять обращений к хранилищу.
   */
  status: (providerId: string) => Promise<ProviderAuthState | undefined>;
  /**
   * Перечитать динамические списки моделей. Обновление по одному провайдеру рантайм не умеет:
   * `refresh()` обходит все настроенные динамические провайдеры разом, сам обновляя перед этим
   * OAuth-токены. Разбирать его оркестрацию ради фильтра значило бы переписать её у себя.
   */
  refresh: () => Promise<RefreshReport>;
  /**
   * Провести вход. Диалог ведёт вызывающий: платформа спрашивает человека или плагин, а кред
   * записывает рантайм — сам, тем же сериализованным путём, что и обновление токена.
   */
  login: (input: LoginRequest) => Promise<void>;
  /** Выход. Ambient-кред этим не убрать: он не наш, и провайдер останется настроенным. */
  logout: (providerId: string) => Promise<void>;
  /**
   * Добавить провайдера из данных (docs/models-and-providers.md). Занятый идентификатор —
   * отказ: `setProvider` у рантайма перезаписывает по `id`, и встроенный подменился бы молча.
   */
  setCustomProvider: (definition: CustomProviderDefinition) => CustomProviderOutcome;
  /**
   * Убрать добавленного. `false` — такого кастомного провайдера нет; встроенного этим не удалить,
   * и это главное: удаление по чужому идентификатору обеднило бы каталог навсегда.
   */
  deleteCustomProvider: (providerId: string) => boolean;
};

export type LoginRequest = {
  providerId: string;
  method: "api_key" | "oauth";
  dialogue: LoginDialogue;
  /** Гасит вход целиком: отмена попытки человеком, выход из платформы, выгрузка плагина. */
  signal?: AbortSignal;
};

export type CreateProviderCatalogueOptions = {
  credentials: CredentialVault;
  /** Кэш динамических списков моделей. Без него они читаются из сети на каждый старт демона. */
  catalogs?: ModelCatalogVault;
  /** По умолчанию — настоящее окружение процесса. Подменяется только тестами. */
  environment?: Environment;
  /**
   * Провайдеры сверх встроенных. Тип здесь — рантаймовый, поэтому воспользоваться этим может только
   * код внутри пакета: тесты, которым нужен двойник со сценарием входа (`./testing.ts`).
   */
  additionalProviders?: Provider[];
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

  for (const provider of options.additionalProviders ?? []) {
    models.setProvider(provider);
  }

  /**
   * Чьи провайдеры добавлены поверх встроенных. Рантайм такого различия не делает, а снимок обязан:
   * кастомный провайдер исчезнет вместе с плагином, и человек должен видеть это заранее.
   */
  const custom = new Set<string>();

  return {
    models,
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

          return describeProvider(provider, { auth, custom: custom.has(provider.id) });
        }),
      );

      return { providers: described, ...(problem === undefined ? {} : { problem }) };
    },
    modelsOf: (providerId) => {
      const provider = models.getProvider(providerId);

      return provider === undefined ? undefined : describeModels(provider);
    },
    status: async (providerId) => {
      if (models.getProvider(providerId) === undefined) {
        return undefined;
      }

      // Негодный файл кредов делает статус «сказать нечем» ровно так же, как в снимке: два ответа
      // на один вопрос о состоянии — это два разных состояния для того, кто их сравнивает.
      return options.credentials.problem() === undefined
        ? authStateOf(models, providerId)
        : { kind: "unknown" };
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
    login: async (input) => {
      await models.login(
        input.providerId,
        input.method,
        toRuntimeInteraction(input.dialogue, input.signal),
      );
    },
    logout: (providerId) => models.logout(providerId),
    setCustomProvider: (definition) => {
      // Занятость проверяется по всей коллекции, а не только по добавленным: спорят они за один и
      // тот же ключ, и встроенный проигрывать не должен.
      if (models.getProvider(definition.id) !== undefined) {
        return { kind: "taken" };
      }

      models.setProvider(toRuntimeProvider(definition));
      custom.add(definition.id);

      return { kind: "registered" };
    },
    deleteCustomProvider: (providerId) => {
      if (!custom.has(providerId)) {
        return false;
      }

      models.deleteProvider(providerId);
      custom.delete(providerId);

      // Кред остаётся в хранилище: он переживает плагина (docs/models-and-providers.md).
      return true;
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
