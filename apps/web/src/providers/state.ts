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
  /**
   * Прочитанное остаётся в памяти вкладки: каталог моделей лежит в пакете рантайма и не меняется.
   * Какой провайдер сейчас на странице, адресу знает маршрут (`providerId` в хуке), а не это поле.
   */
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

  return {
    state: event.type === coreEventTypes.providersChanged ? { ...state, models: {} } : state,
    providers: changed,
    logins: false,
  };
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

/**
 * Нужно ли спросить модели провайдера при переходе на его страницу. Прочитанное не
 * перечитывается: каталог моделей лежит в пакете рантайма и сам по себе не меняется (обновление
 * динамического списка приезжает `refresh`, и его пока нет). Отказ — другое дело: причина могла
 * уйти, и повторный заход на страницу это единственный способ попробовать снова.
 */
export function shouldFetchModels(state: ProvidersState, providerId: string): boolean {
  const known = state.models[providerId];

  return known?.kind !== "ready" && known?.kind !== "loading";
}

/** Отметить, что модели провайдера спрашиваются: крутилка встаёт сразу, до ответа маршрута. */
export function markModelsLoading(state: ProvidersState, providerId: string): ProvidersState {
  return { ...state, models: { ...state.models, [providerId]: { kind: "loading" } } };
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
