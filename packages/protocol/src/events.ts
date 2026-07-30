/**
 * События шины, которые публикует ядро (docs/event-bus.md). Неймспейс `core` принадлежит ядру, и занять его
 * плагин не может (docs/event-bus.md): иначе подписчик перестал бы отличать сообщение платформы от
 * сообщения плагина.
 *
 * Тип события и его нагрузка описаны рядом: подписчик в браузере обязан разбирать ровно то, что
 * опубликовал демон, и проверить это должен компилятор, а не человек.
 */

import type { ContributionRegistration } from "./contribution.ts";
import type { PluginStatus } from "./plugin-lifecycle.ts";
import type { PluginSource } from "./plugin.ts";

/** Неймспейс ядра. Плагин занять его не может: иначе его событие неотличимо от платформенного. */
export const coreEventNamespace = "core";

/**
 * Записи журнала здесь нет намеренно: журнал не событие предметной области и на шину не публикуется
 * (docs/logging.md). Его единственный получатель — `stdout`.
 */
export const coreEventTypes = {
  /** Переход жизненного цикла плагина (docs/plugins.md). */
  pluginLifecycle: "core.plugin.lifecycle",
  /** Действующий набор вкладов изменился. */
  pluginContributions: "core.plugin.contributions",
  /**
   * Внешний вид или локаль изменились. Событие обязано быть: `preferences.json` перечитывается на
   * живом демоне (docs/data-directory.md), и правка файла руками должна доезжать до открытого браузера. О записях
   * плагинов из того же файла говорят события жизненного цикла и набора вкладов.
   */
  preferencesChanged: "core.preferences.changed",
  /**
   * Список проектов или доступность чьей-нибудь папки изменились
   * (docs/sessions-and-projects.md). Одно событие на всё: создание, переименование, архивацию,
   * восстановление, удаление и смену доступности — подписчик всё равно перечитывает список целиком.
   */
  projectsChanged: "core.projects.changed",
  /**
   * Список сессий агента или состояние какой-нибудь из них изменились
   * (docs/sessions-and-projects.md). Одно событие на всё: создание, смену фазы и удаление —
   * подписчик перечитывает список целиком. Дельты стриминга сюда **не** идут: они едут своим классом
   * кадра мимо шины, потому что их частота на два порядка выше (docs/web-api.md).
   */
  sessionsChanged: "core.sessions.changed",
  /**
   * Сессия лишилась опоры и доигрывает без неё: инструмент исчез вместе с выключенным плагином или
   * модель пропала из каталога (docs/sessions-and-projects.md). Отдельное событие, а не
   * `core.sessions.changed`: тот значит «перечитай список», а здесь произошёл факт, о котором надо
   * рассказать. Дельтой это ехать не может — дельты идут мимо шины и плагину не отдаются вовсе, а
   * подписчиком здесь должен быть в том числе плагин автоматизации.
   */
  sessionDegraded: "core.sessions.degraded",
  /**
   * Каталог провайдеров изменился: обновился динамический список моделей либо появился или исчез
   * кастомный провайдер плагина (docs/models-and-providers.md). Вход и выход это событие **не**
   * публикуют — у них свои, иначе вью перезапрашивало бы список дважды на одно действие.
   */
  providersChanged: "core.providers.changed",
  /**
   * Вход в провайдера удался. Событие есть, потому что войти может любой включённый плагин, а
   * состояние это глобальное: без него вход, сделанный одним, для остальных выглядит внезапной
   * переменой (docs/models-and-providers.md).
   */
  providerLogin: "core.provider.login",
  /** Выход из провайдера. Есть по той же причине: иначе чужой разлогин выглядит поломкой. */
  providerLogout: "core.provider.logout",
} as const;

/**
 * Не «что изменилось», а «как теперь»: набор отдаётся целиком, потому что подписчик, пропустивший
 * одно событие, при инкрементальном обновлении остался бы с испорченной картиной навсегда.
 */
export type PluginContributionsChanged = {
  /** Ревизия реестра: по ней снимок и поток сверяются, кто из них свежее (docs/event-bus.md). */
  revision: number;
  contributions: ContributionRegistration[];
};

/**
 * Нагрузки нет: событие говорит «изменилось», а состояние спрашивается у владельца — `GET
 * /api/preferences` (docs/event-bus.md). Дублировать значения в событии значит завести второй источник правды
 * о файле, который в этот момент могли перезаписать ещё раз.
 */
export type PreferencesChanged = Record<string, never>;

/**
 * Нагрузки нет по той же причине, что у `PreferencesChanged`: состояние спрашивается у владельца —
 * `GET /api/projects`. Доступность папки к тому же меняется сама по себе, и значение из события
 * успело бы устареть к моменту доставки.
 */
export type ProjectsChanged = Record<string, never>;

/** Нагрузки нет по той же причине: состояние спрашивается у владельца — `GET /api/sessions`. */
export type SessionsChanged = Record<string, never>;

/** Нагрузки нет по той же причине: состояние спрашивается у владельца — `GET /api/providers`. */
export type ProvidersChanged = Record<string, never>;

/**
 * Нагрузка есть, в отличие от «изменилось»: это факт о случившемся, и перечитать его неоткуда —
 * состояния «инструмент был и пропал» нигде не лежит, есть только момент, когда это заметили.
 */
export type SessionDegraded = {
  sessionId: string;
  /** Чего лишилась сессия: инструмента или модели. */
  kind: "tool" | "model";
  /** Имя исчезнувшего: имя инструмента или ссылка на модель. */
  name: string;
};

/**
 * У входа и выхода нагрузка есть, в отличие от остальных событий ядра: это факт о случившемся, а не
 * «состояние изменилось, перечитай». Подписчику важно, в кого именно вошли, — перечитывать ради
 * этого весь список провайдеров он не обязан.
 */
export type ProviderLogin = {
  providerId: string;
  method: "api_key" | "oauth";
};

export type ProviderLogout = {
  providerId: string;
};

export type CoreEventPayloads = {
  "core.plugin.lifecycle": PluginStatus;
  "core.plugin.contributions": PluginContributionsChanged;
  "core.preferences.changed": PreferencesChanged;
  "core.projects.changed": ProjectsChanged;
  "core.sessions.changed": SessionsChanged;
  "core.sessions.degraded": SessionDegraded;
  "core.providers.changed": ProvidersChanged;
  "core.provider.login": ProviderLogin;
  "core.provider.logout": ProviderLogout;
};

export type CoreEventType = keyof CoreEventPayloads;

/** Размеченное объединение: тип события определяет форму нагрузки. */
export type CoreEvent = {
  [Type in CoreEventType]: { type: Type; payload: CoreEventPayloads[Type] };
}[CoreEventType];

/**
 * Кто опубликовал. Подписчик обязан это знать: контракт события принадлежит автору, и без имени
 * расхождение «форма нагрузки изменилась» не на кого повесить (docs/event-bus.md).
 */
export type PluginEventOrigin = {
  /** Ключ экземпляра: идентичность вместе с источником (docs/plugins.md). */
  key: string;
  id: string;
  source: PluginSource;
};

/**
 * Событие плагина. Перечислить их типы заранее нельзя — плагин не входит в поставку, — поэтому
 * форма одна на все: имя строкой, нагрузка непрозрачная. Проверил её тот, кто опубликовал
 * (docs/event-bus.md).
 */
export type PluginBusEvent = {
  /** Полное имя, с неймспейсом публикатора: `<pluginId>.<объявленное>`. */
  type: string;
  payload: unknown;
  plugin: PluginEventOrigin;
};

/**
 * Всё, что ходит по шине. Различаются формы наличием `plugin`, а не полем-меткой: объединение
 * событий ядра остаётся закрытым, и нагрузка события ядра не деградирует до `unknown`.
 */
export type BusEvent = CoreEvent | PluginBusEvent;

export function isPluginBusEvent(event: BusEvent): event is PluginBusEvent {
  return "plugin" in event;
}
