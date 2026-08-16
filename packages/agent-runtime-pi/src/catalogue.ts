/**
 * Каталог провайдеров: фасад над коллекцией Pi, отдающий наружу только типы протокола
 * (docs/models-and-providers.md).
 *
 * Строится сразу, а не лениво: весь каталог обходится в 31 мс, из которых 30 — импорт пакета,
 * который всё равно случится (docs/runtime-checks.md, проверка 28).
 */

import type { MutableModels, Provider, ProviderModelsStore } from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import type {
  CustomProviderDefinition,
  CustomProviderOutcome,
  LoginKeyTarget,
  ModelSummary,
  ProviderAuthState,
  ProvidersSnapshot,
  ProviderSummary,
  ProviderOrigin,
  RefreshOutcome,
  RefreshReport,
  UserProviderDefinition,
} from "@sovereign/protocol";

import { describeKeys, toRuntimeCredentialStore, type CredentialVault } from "./credentials.ts";
import { toRuntimeProvider, toRuntimeUserProvider } from "./custom-provider.ts";
import { describeModels, describeProvider } from "./describe.ts";
import { processEnvironment, toRuntimeAuthContext, type Environment } from "./environment.ts";
import { toRuntimeInteraction, type LoginDialogue } from "./interaction.ts";
import { toRuntimeModelsStore, type ModelCatalogVault } from "./model-catalogs.ts";
import { mergeDiscoveredModels } from "./user-model-catalog.ts";

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
   *
   * Отвечает идентификатором ключа, в который лёг кред, или `undefined`, если вход не записал
   * ничего.
   */
  login: (input: LoginRequest) => Promise<string | undefined>;
  /** Выход. Ambient-кред этим не убрать: он не наш, и провайдер останется настроенным. */
  logout: (providerId: string) => Promise<void>;
  /** Убрать один ключ. `false` — такого ключа нет. Остальные ключи провайдера остаются. */
  removeKey: (providerId: string, keyId: string) => Promise<boolean>;
  /** Сделать ключ выбранным. `false` — такого ключа нет. */
  selectKey: (providerId: string, keyId: string) => Promise<boolean>;
  /** Переименовать ключ. `false` — такого ключа нет. */
  renameKey: (providerId: string, keyId: string, label: string) => Promise<boolean>;
  /**
   * Добавить провайдера из данных (docs/models-and-providers.md). Занятый идентификатор —
   * отказ: `setProvider` у рантайма перезаписывает по `id`, и встроенный подменился бы молча.
   */
  setCustomProvider: (
    definition: CustomProviderDefinition | UserProviderDefinition,
    origin?: "plugin" | "user",
  ) => CustomProviderOutcome;
  /** Заменить провайдера, только если текущая запись принадлежит тому же источнику. */
  replaceCustomProvider: (
    definition: CustomProviderDefinition | UserProviderDefinition,
    origin: "plugin" | "user",
  ) => boolean;
  /**
   * Убрать добавленного. `false` — такого кастомного провайдера нет; встроенного этим не удалить,
   * и это главное: удаление по чужому идентификатору обеднило бы каталог навсегда.
   */
  deleteCustomProvider: (providerId: string) => boolean;
  /** Источник-aware вариант удаления для постоянных пользовательских записей. */
  removeCustomProvider: (providerId: string, origin: "plugin" | "user") => boolean;
  /** Обновить каталог только одного динамического провайдера. */
  refreshProvider: (
    providerId: string,
    signal?: AbortSignal,
    origin?: "plugin" | "user",
  ) => Promise<RefreshOutcome | undefined>;
  /** Восстановить сохранённый динамический список без сети. */
  restoreProvider: (providerId: string, origin: "plugin" | "user") => Promise<boolean>;
  /** Источник записи, если она добавлена поверх встроенного каталога. */
  customProviderOrigin: (providerId: string) => "plugin" | "user" | undefined;
};

export type LoginRequest = {
  providerId: string;
  method: "api_key" | "oauth";
  dialogue: LoginDialogue;
  /**
   * В какой ключ ляжет кред. Не названа — вход добавляет ключ: у провайдера их может быть
   * несколько, и молчаливая замена стоила бы человеку рабочего ключа.
   */
  target?: LoginKeyTarget;
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
  const credentialStore = toRuntimeCredentialStore(options.credentials);
  const modelsStore =
    options.catalogs === undefined ? undefined : toRuntimeModelsStore(options.catalogs);
  const authContext = toRuntimeAuthContext(options.environment ?? processEnvironment());
  const models: MutableModels = builtinModels({
    credentials: credentialStore,
    authContext,
    ...(options.catalogs === undefined ? {} : { modelsStore }),
  });

  for (const provider of options.additionalProviders ?? []) {
    models.setProvider(provider);
  }

  /**
   * Чьи провайдеры добавлены поверх встроенных. Рантайм такого различия не делает, а снимок обязан:
   * кастомный провайдер исчезнет вместе с плагином, и человек должен видеть это заранее.
   */
  const custom = new Map<string, "plugin" | "user">();
  const userDefinitions = new Map<string, UserProviderDefinition>();

  const originOf = (providerId: string): ProviderOrigin => custom.get(providerId) ?? "builtin";
  const setCustom = (
    definition: CustomProviderDefinition | UserProviderDefinition,
    origin: "plugin" | "user",
  ): void => {
    models.setProvider(
      origin === "user"
        ? toRuntimeUserProvider(definition as UserProviderDefinition)
        : toRuntimeProvider(definition as CustomProviderDefinition),
    );
    custom.set(definition.id, origin);
    if (origin === "user") userDefinitions.set(definition.id, definition as UserProviderDefinition);
  };

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
          // Над нечитаемым файлом ключей не показываем вовсе: их набор оттуда и берётся, и
          // придуманный пустой список выглядел бы как «человек нигде не залогинен».
          const keys =
            problem === undefined ? await describeKeys(options.credentials, provider.id) : [];

          return describeProvider(provider, {
            auth,
            origin: originOf(provider.id),
            keys,
            ...(problem === undefined
              ? { selectedKey: options.credentials.selected(provider.id) }
              : {}),
          });
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
    refreshProvider: async (providerId, signal, origin) => {
      if (origin !== undefined && custom.get(providerId) !== origin) return undefined;
      const provider = models.getProvider(providerId);
      if (provider === undefined || provider.refreshModels === undefined) return undefined;

      try {
        const credential = await credentialStore.read(providerId);
        // Кэш читается независимо от наличия ключа: после рестарта провайдер должен быть полезен
        // офлайн. Сеть без credential всё равно не разрешаем.
        await provider.refreshModels({
          store: scopedStore(modelsStore, providerId),
          allowNetwork: false,
          signal,
        });
        if (credential === undefined)
          return { providerId, modelCount: describeModels(provider).length };
        await provider.refreshModels({
          credential,
          store: scopedStore(modelsStore, providerId),
          allowNetwork: true,
          force: true,
          signal,
        });
        return { providerId, modelCount: describeModels(provider).length };
      } catch (error) {
        try {
          await provider.refreshModels({
            store: scopedStore(modelsStore, providerId),
            allowNetwork: false,
            signal,
          });
        } catch {
          // Исходный отказ важнее возможного отказа восстановления кэша.
        }
        return {
          providerId,
          modelCount: describeModels(provider).length,
          error: error instanceof Error ? error.message : "model refresh failed",
        };
      }
    },
    restoreProvider: async (providerId, origin) => {
      if (custom.get(providerId) !== origin) return false;
      const provider = models.getProvider(providerId);
      if (provider?.refreshModels === undefined) return true;
      const definition = userDefinitions.get(providerId);
      const cached = await modelsStore?.read(providerId);
      if (definition !== undefined && cached !== undefined) {
        await modelsStore?.write(providerId, {
          ...cached,
          models: mergeDiscoveredModels(
            definition,
            cached.models.map((model) => model.id),
          ),
        });
      }
      await provider.refreshModels({
        store: scopedStore(modelsStore, providerId),
        allowNetwork: false,
      });
      return true;
    },
    customProviderOrigin: (providerId) => custom.get(providerId),
    login: async (input) => {
      const written = await options.credentials.withKeyTarget(
        input.providerId,
        input.target ?? { kind: "new", label: "" },
        () =>
          models.login(
            input.providerId,
            input.method,
            toRuntimeInteraction(input.dialogue, input.signal),
          ),
      );

      return written.keyId;
    },
    logout: (providerId) => models.logout(providerId),
    removeKey: (providerId, keyId) => options.credentials.removeKey(providerId, keyId),
    selectKey: (providerId, keyId) => options.credentials.select(providerId, keyId),
    renameKey: (providerId, keyId, label) => options.credentials.rename(providerId, keyId, label),
    setCustomProvider: (definition, origin = "plugin") => {
      // Занятость проверяется по всей коллекции, а не только по добавленным: спорят они за один и
      // тот же ключ, и встроенный проигрывать не должен.
      if (models.getProvider(definition.id) !== undefined) {
        return { kind: "taken" };
      }

      setCustom(definition, origin);

      return { kind: "registered" };
    },
    replaceCustomProvider: (definition, origin) => {
      if (custom.get(definition.id) !== origin) return false;
      setCustom(definition, origin);
      return true;
    },
    deleteCustomProvider: (providerId) => {
      if (custom.get(providerId) !== "plugin") {
        return false;
      }

      models.deleteProvider(providerId);
      custom.delete(providerId);

      // Кред остаётся в хранилище: он переживает плагина (docs/models-and-providers.md).
      return true;
    },
    removeCustomProvider: (providerId, origin) => {
      if (custom.get(providerId) !== origin) return false;
      models.deleteProvider(providerId);
      custom.delete(providerId);
      userDefinitions.delete(providerId);
      return true;
    },
  };
}

function scopedStore(
  store: ReturnType<typeof toRuntimeModelsStore> | undefined,
  providerId: string,
): ProviderModelsStore {
  return {
    read: () => store?.read(providerId) ?? Promise.resolve(undefined),
    write: (entry) => store?.write(providerId, entry) ?? Promise.resolve(),
    delete: () => store?.delete(providerId) ?? Promise.resolve(),
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
