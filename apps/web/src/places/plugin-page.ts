/**
 * Что стоит на адресе `/p/<pluginId>/<pageId>/*` прямо сейчас (docs/ui-extension-model.md).
 *
 * Состояний пять, и три из них — не отказ. Общий «не найдено» здесь запрещён моделью: выключенный
 * плагин обязан оставить свой адрес живым, чтобы включение вернуло страницу на том же URL.
 */

import {
  projectOfPluginSource,
  resolvePluginPage,
  type PluginOwnedPageRegistration,
  type PluginsSnapshot,
  type PluginStatus,
} from "@sovereign/protocol";

import { windowWideContributions } from "../plugins/window-wide.ts";

export type PluginPageState =
  | { kind: "open"; registration: PluginOwnedPageRegistration; status?: PluginStatus }
  /** Человек выключил плагин или сам вклад: адрес живой, включение вернёт страницу. */
  | { kind: "switched-off" }
  /** Плагин ставится, собирается или поднимается. Ожидание, а не отказ (ловушка среза 12b-2). */
  | { kind: "waiting" }
  | { kind: "failed"; reason?: string }
  | { kind: "missing" };

export function resolvePluginPageState(
  snapshot: PluginsSnapshot | undefined,
  pluginId: string,
  pageId: string,
): PluginPageState {
  if (snapshot === undefined) {
    return { kind: "waiting" };
  }

  // Контекст оконный: адрес страницы один на всё окно, и вклад из папки проекта его не занимает.
  const registration = resolvePluginPage(
    pluginId,
    pageId,
    windowWideContributions(snapshot.contributions),
    {},
  );

  if (registration !== undefined) {
    const status = snapshot.plugins.find(({ key }) => key === registration.pluginKey);
    return { kind: "open", registration, ...(status === undefined ? {} : { status }) };
  }

  const status = windowWideStatus(snapshot.plugins, pluginId);

  const switchedOff = resolvePluginPage(
    pluginId,
    pageId,
    windowWideContributions(snapshot.switchedOffContributions),
    {},
  );

  if (switchedOff !== undefined) {
    return { kind: "switched-off" };
  }

  if (status === undefined) {
    return { kind: "missing" };
  }

  // Плагин выключен целиком: вкладов у него в снимке нет вовсе, поэтому «выключено» видно только
  // по его состоянию. Для человека это тот же случай, что выключенный вклад.
  if (status.state === "disabled") {
    return { kind: "switched-off" };
  }

  if (status.state === "refused" || status.state === "failed") {
    return { kind: "failed", ...(status.reason === undefined ? {} : { reason: status.reason }) };
  }

  // Плагин ещё не дошёл до `running` — страница появится сама, как только он объявит свои вклады.
  return status.state === "running" || status.state === "stopped"
    ? { kind: "missing" }
    : { kind: "waiting" };
}

/**
 * Плагин узла с таким идентификатором. Копия из папки проекта сюда не годится по той же причине,
 * по которой её вклад не занимает адрес: окно рисуется и без открытого проекта.
 */
function windowWideStatus(
  plugins: readonly PluginStatus[],
  pluginId: string,
): PluginStatus | undefined {
  return plugins.find(
    (plugin) => plugin.id === pluginId && projectOfPluginSource(plugin.source) === undefined,
  );
}
