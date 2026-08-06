/**
 * Состояние вью плагинов и его правила: что делает кадр потока, какой снимок принимается, что видно
 * человеку после отказа записи. Логика живёт здесь, а не в хуке, потому что проверяется она тестом,
 * а не глазами.
 *
 * Событие — уведомление, состояние спрашивается у владельца (docs/event-bus.md). Но кадр жизненного цикла
 * несёт полный статус плагина, и запрашивать снимок на каждый переход значило бы десяток запросов на
 * подъёме четырёх плагинов: такой кадр применяется на месте.
 */

import {
  coreEventTypes,
  isPluginStreamEvent,
  streamGapType,
  type ContributionRegistration,
  type PluginPreferences,
  type PluginsSnapshot,
  type BusStreamEvent,
} from "@sovereign/protocol";

/**
 * Адрес маршрута плагина — `/p/<id плагина>/<путь>` (docs/web-api.md). Считается в одном месте на
 * оба вью: список открытых наружу маршрутов и подробности вклада обязаны называть один и тот же
 * адрес, иначе человек искал бы его глазами по двум экранам.
 */
export function routeAddress(
  registration: Extract<ContributionRegistration, { kind: "route" | "public-route" }>,
): string {
  // Маршрут объявляет только плагин: standalone-корни дают файловых агентов и скилы.
  const pluginId =
    registration.ownership === "plugin" ? registration.pluginId : registration.source;

  return registration.path === "" ? `/p/${pluginId}` : `/p/${pluginId}/${registration.path}`;
}

export type PluginsState = {
  snapshot?: PluginsSnapshot;
  /** Часть потока пропущена: показанное могло устареть, снимок запрашивается заново (docs/web-api.md). */
  stale: boolean;
  /** Почему снимок не прочитан или решение не записано. Разбираться с этим человеку. */
  failure?: string;
};

export const initialPluginsState: PluginsState = { stale: false };

export type StreamOutcome = {
  state: PluginsState;
  /** Снимок надо запросить заново: в нём есть то, чего в событии нет. */
  refetch: boolean;
};

export function applyStreamEvent(state: PluginsState, event: BusStreamEvent): StreamOutcome {
  // События плагинов вью не касаются: своих вкладов они не меняют.
  if (isPluginStreamEvent(event)) {
    return { state, refetch: false };
  }

  if (event.type === streamGapType) {
    return { state: { ...state, stale: true }, refetch: true };
  }

  // Набор вкладов изменился — а вместе с ним выключенное, споры и решения о включении: всё это
  // живёт в снимке, и события для них нет.
  if (event.type === coreEventTypes.pluginContributions) {
    return { state, refetch: true };
  }

  if (event.type !== coreEventTypes.pluginLifecycle) {
    return { state, refetch: false };
  }

  const snapshot = state.snapshot;

  // Патчить нечего: снимок ещё не пришёл, и первый запрос принесёт этот статус сам.
  if (snapshot === undefined) {
    return { state, refetch: false };
  }

  const status = event.payload;
  const known = snapshot.plugins.some((plugin) => plugin.key === status.key);
  const plugins = known
    ? snapshot.plugins.map((plugin) => (plugin.key === status.key ? status : plugin))
    : [...snapshot.plugins, status];

  return {
    state: { ...state, snapshot: { ...snapshot, plugins } },
    // Новый плагин приносит и вклады, и решение о включении: их в кадре нет.
    refetch: !known,
  };
}

/**
 * Ответ применяется целиком и всегда: ревизия для упорядочивания ответов не годится — она живёт в
 * памяти демона и сбрасывается вместе с его перезапуском, а именно после перезапуска снимок и нужен
 * больше всего. Порядок обеспечивается иначе: запрос снимка один в полёте, предыдущий отменяется
 * (`use-plugins.ts`), поэтому двум ответам разойтись негде.
 */
export function applySnapshot(_state: PluginsState, snapshot: PluginsSnapshot): PluginsState {
  return { snapshot, stale: false };
}

export function applyFailure(state: PluginsState, reason: string): PluginsState {
  return { ...state, failure: reason };
}

/**
 * Записанное решение видно сразу, не дожидаясь событий: переключение вклада, ничего не изменившего
 * в действующем наборе, не порождает ни одного кадра, а флажок обязан показывать записанное.
 */
export function applyWrittenPreferences(
  state: PluginsState,
  pluginKey: string,
  preferences: PluginPreferences,
): PluginsState {
  const snapshot = state.snapshot;

  if (snapshot === undefined) {
    return state;
  }

  return {
    ...state,
    failure: undefined,
    snapshot: { ...snapshot, enablement: { ...snapshot.enablement, [pluginKey]: preferences } },
  };
}

/**
 * Действующее решение о включении. Плагин без записи в снимке — тот, чей манифест не прочитан:
 * переключать там нечего, и вью показывает его только для чтения.
 */
export function enablementOf(
  snapshot: PluginsSnapshot,
  pluginKey: string,
): PluginPreferences | undefined {
  return snapshot.enablement[pluginKey];
}
