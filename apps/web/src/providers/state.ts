/**
 * Состояние вью провайдеров и его правила. Логика живёт здесь, а не в хуке, потому что проверяется
 * она тестом, а не глазами.
 *
 * Диалоги входа лежат отдельным полем и по своим правилам (`login-state.ts`): каталог провайдеров и
 * живой диалог с провайдером — разные темы, и общего у них только вью.
 */

import {
  coreEventTypes,
  isPluginStreamEvent,
  streamGapType,
  type BusStreamEvent,
  type ModelSummary,
  type ProviderSummary,
  type ProvidersSnapshot,
} from "@sovereign/protocol";

import { initialLoginsState, type LoginsState } from "./login-state.ts";

/**
 * Модели одного провайдера: их спрашивают по раскрытию строки, и каждый провайдер живёт своей
 * жизнью — у одного список читается, у другого уже отказал.
 */
export type ProviderModelsEntry =
  | { kind: "loading" }
  | { kind: "ready"; models: ModelSummary[] }
  | { kind: "failed"; reason: string };

export type ProvidersState = {
  snapshot?: ProvidersSnapshot;
  /** Почему список провайдеров не прочитан. Беда с файлом кредов сюда не попадает: она в снимке. */
  failure?: string;
  /** Раскрыт ровно один: списки моделей бывают в сотни строк, и двух таких на экране не надо. */
  openProviderId?: string;
  /** Прочитанное остаётся в памяти вкладки: каталог моделей лежит в пакете рантайма и не меняется. */
  models: Record<string, ProviderModelsEntry>;
  /** Диалоги входа: правила в `login-state.ts`, здесь они только живут. */
  logins: LoginsState;
};

export const initialProvidersState: ProvidersState = { models: {}, logins: initialLoginsState };

export type StreamOutcome = {
  state: ProvidersState;
  /** Перезапросить снимок провайдеров. */
  providers: boolean;
  /** Перезапросить идущие попытки входа. */
  logins: boolean;
};

/**
 * Событий про провайдеров три, и все они означают одно — спросить снимок заново. Что именно
 * изменилось, в нагрузке не написано, и это правильно: вход мог сделать плагин, а состояние
 * авторизации всё равно спрашивается у владельца (docs/event-bus.md).
 */
export function applyStreamEvent(state: ProvidersState, event: BusStreamEvent): StreamOutcome {
  if (isPluginStreamEvent(event)) {
    return { state, providers: false, logins: false };
  }

  // Пропуск в потоке уносит и кадры шагов входа: они нумеруются общей нумерацией (docs/web-api.md).
  // Поэтому перечитывается и то и другое — иначе диалог остался бы на позапрошлом вопросе.
  if (event.type === streamGapType) {
    return { state, providers: true, logins: true };
  }

  const changed =
    event.type === coreEventTypes.providerLogin ||
    event.type === coreEventTypes.providerLogout ||
    event.type === coreEventTypes.providersChanged;

  return { state, providers: changed, logins: false };
}

/**
 * Настроенные — первыми. Провайдеров 38 (docs/web-api.md), а кред обычно есть у единиц: без
 * группировки свой провайдер приходится искать глазами при каждом открытии вью. Внутри группы
 * порядок каталога рантайма сохраняется — переставлять его алфавитом незачем.
 */
export function orderProviders(providers: ProviderSummary[]): ProviderSummary[] {
  return [
    ...providers.filter((provider) => provider.auth.kind === "configured"),
    ...providers.filter((provider) => provider.auth.kind !== "configured"),
  ];
}

export function configuredCount(providers: ProviderSummary[]): number {
  return providers.filter((provider) => provider.auth.kind === "configured").length;
}

/** Порядок задаётся здесь, а не при отрисовке: вью рисует то, что лежит в состоянии. */
export function applySnapshot(state: ProvidersState, snapshot: ProvidersSnapshot): ProvidersState {
  return {
    ...state,
    snapshot: { ...snapshot, providers: orderProviders(snapshot.providers) },
    failure: undefined,
  };
}

export function applyFailure(state: ProvidersState, reason: string): ProvidersState {
  return { ...state, failure: reason };
}

export type OpenOutcome = {
  state: ProvidersState;
  /** Спрашивать ли модели: прочитанные не перечитываются, отказавшие — да. */
  fetch: boolean;
};

export function openProvider(state: ProvidersState, providerId: string): OpenOutcome {
  // Выбор раскрытой строки закрывает её: иначе развернуть список моделей можно, а свернуть нечем.
  if (state.openProviderId === providerId) {
    return { state: { ...state, openProviderId: undefined }, fetch: false };
  }

  const known = state.models[providerId];

  // Прочитанное не перечитывается: каталог моделей лежит в пакете рантайма и сам по себе не меняется
  // (обновление динамического списка приезжает `refresh`, и его пока нет). Отказ — другое дело:
  // причина могла уйти, и повтор по раскрытию это единственный способ попробовать снова.
  if (known?.kind === "ready" || known?.kind === "loading") {
    return { state: { ...state, openProviderId: providerId }, fetch: false };
  }

  return {
    state: {
      ...state,
      openProviderId: providerId,
      models: { ...state.models, [providerId]: { kind: "loading" } },
    },
    fetch: true,
  };
}

export function applyModels(
  state: ProvidersState,
  providerId: string,
  models: ModelSummary[],
): ProvidersState {
  return { ...state, models: { ...state.models, [providerId]: { kind: "ready", models } } };
}

/** Отказ по одному провайдеру не трогает список: он приезжает отдельным запросом. */
export function applyModelsFailure(
  state: ProvidersState,
  providerId: string,
  reason: string,
): ProvidersState {
  return { ...state, models: { ...state.models, [providerId]: { kind: "failed", reason } } };
}
