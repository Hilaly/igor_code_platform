/**
 * Снимок состояния плагинной системы: ответ на вопрос «как сейчас» для того, о чём шина публикует
 * события (docs/event-bus.md). Поток говорит об изменениях, снимок — о состоянии; подписчик, который только
 * что подключился или потерял часть потока, начинает отсюда.
 */

import type {
  ContributionConflict,
  ContributionRegistration,
  PluginRouteMethod,
} from "./contribution.ts";
import type { PluginStatus } from "./plugin-lifecycle.ts";
import type { PluginPreferences } from "./settings.ts";

export const pluginsPath = "/api/plugins";

/** Действующие plugin-owned вклады, спорящие за один метод и адрес. Ни один из них не отвечает. */
export type PluginRouteConflict = {
  method: PluginRouteMethod;
  /** Форма нормализованного пути вклада, без `/api/p/<pluginId>/`; все параметрические сегменты — `:`. */
  path: string;
  contributions: string[];
  /** Ключи источников, чтобы одинаковые id из разных project-контекстов различались. */
  pluginKeys: string[];
};

export type PluginsSnapshot = {
  /**
   * Ревизия реестра вкладов на момент снимка. Та же, что в событии `core.plugin.contributions`:
   * по ней клиент понимает, не устарел ли снимок относительно уже полученного события.
   */
  revision: number;
  plugins: PluginStatus[];
  /** Действующий набор: то же, что в событии `core.plugin.contributions`. */
  contributions: ContributionRegistration[];
  /**
   * Объявленные, но выключенные человеком (docs/plugins.md). В действующий набор они не входят и не
   * участвуют ни в чём, но переключатель им нужен: иначе выключенный вклад исчез бы из интерфейса
   * и включить его обратно было бы нечем.
   */
  switchedOffContributions: ContributionRegistration[];
  conflicts: ContributionConflict[];
  /** Конфликты адресов маршрутов. Объявления остаются в `contributions`, но HTTP их не публикует. */
  routeConflicts: PluginRouteConflict[];
  /**
   * Действующее решение о включении по ключу плагина. Не содержимое файла: у плагина без записи
   * решение выведено по источнику, поэтому политика по умолчанию остаётся в демоне. Форма та же,
   * что тело `PUT /api/plugins/:key/preferences` — интерфейс читает и пишет одно и то же.
   */
  enablement: Record<string, PluginPreferences>;
};
