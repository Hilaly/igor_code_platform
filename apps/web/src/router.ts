/**
 * Свой маршрутизатор вместо библиотеки: маршрутов ядра единицы, а неймспейс страниц плагина —
 * `/p/<pluginId>/<pageId>/*` — задан моделью расширения (ui-extension-model.md), а не библиотекой.
 *
 * Вопрос внешней библиотеки задан вместе со страницами плагина и закрыт решением владельца в пользу
 * своего роутера: вложенные маршруты внутри `/p/…` строит сам плагин своим кодом, и хосту нужен от
 * них один сегмент базы и хвост строкой.
 *
 * Адрес здесь — не путь, а `Location`: путь плюс параметры. `Page` продолжает отвечать за путь,
 * потому что параметры — вторая ось адреса, и вписывать их в каждый вариант `Page` значило бы
 * поселить `query?` в одиннадцати местах ради маршрутов, у которых параметров нет ни одного.
 */

import { settingsSections, type SettingsSection } from "@sovereign/browser-sdk";
import { isSettingsSection } from "@sovereign/browser-sdk/host";
import { isSessionId } from "@sovereign/protocol";

// Перечень разделов живёт в browser SDK: он и так публичен именами мест `core.settings.<section>`.
// Реэкспорт оставлен, чтобы потребители внутри `apps/web` продолжали брать его у маршрутизатора —
// раздел для них это прежде всего адрес.
export { settingsSections, type SettingsSection };

export const pluginPagePrefix = "p";

/** Канонические адреса рабочих вью; старые системные адреса разбираются ниже для замены. */
export const pluginsPagePath = "/plugins";
export const providersPagePath = "/providers";
export const sessionsPagePath = "/sessions";
export const settingsPagePath = "/settings";

export type Page =
  | { kind: "home" }
  /** Адрес конкретного разговора; каталога сессий в центральной области больше нет. */
  | { kind: "session"; sessionId: string }
  | { kind: "session-archive" }
  /**
   * Создание сессии — отдельный адресуемый экран, а не модал: у модала фиксированная ширина, и
   * список моделей в нём не помещается. Адрес даёт ещё и рабочую кнопку «назад» и перезагрузку.
   */
  | { kind: "new-session" }
  | { kind: "new-provider" }
  | { kind: "edit-provider"; providerId: string }
  /** Выбранный раздел всегда записан в адресе и остаётся единственным источником выбора. */
  | { kind: "settings"; section: SettingsSection; providerId?: string }
  | { kind: "settings-project"; projectId: string }
  /** Административная деталь плагина; не смешивается с пользовательскими страницами `/p/...`. */
  | { kind: "settings-plugin"; pluginKey: string }
  /**
   * Страница плагина. `rest` — хвост адреса после базы, как он стоит в URL: разбирать его на
   * сегменты — дело самой страницы, только она знает, где у неё разделитель.
   */
  | { kind: "plugin"; pluginId: string; pageId: string; rest: string }
  | { kind: "unknown"; path: string };

/**
 * Полный адрес: страница и её параметры. Параметров нет ни у одного маршрута ядра — они заведены
 * ради страниц плагина, которые кладут в адрес своё состояние.
 *
 * Повторяющийся ключ теряет всё, кроме последнего значения (docs/backlog.md). Цена принята:
 * `URLSearchParams` умеет больше, но он изменяемый, и правка его копии выглядела бы переходом,
 * ничего не меняя.
 */
export type Location = { page: Page; query: Readonly<Record<string, string>> };

const withoutParameters: Readonly<Record<string, string>> = Object.freeze({});

function decodePathSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch (cause) {
    if (cause instanceof URIError) {
      return undefined;
    }

    throw cause;
  }
}

/**
 * `.` и `..` браузер считает навигацией по каталогам даже в percent-кодировке. Префикс `~` не даёт
 * сегменту стать dot-segment; точка остаётся закодированной, чтобы не спутать эти два служебных
 * представления с обычными идентификаторами `~.` и `~..`.
 */
function encodeOpaqueSegment(value: string): string {
  if (value === ".") {
    return "~%2E";
  }

  if (value === "..") {
    return "~%2E%2E";
  }

  return encodeURIComponent(value);
}

function decodeOpaqueSegment(segment: string): string | undefined {
  if (segment === "~%2E") {
    return ".";
  }

  if (segment === "~%2E%2E") {
    return "..";
  }

  return decodePathSegment(segment);
}

const encodeProviderId = encodeOpaqueSegment;
const decodeProviderId = decodeOpaqueSegment;

export function matchPage(path: string): Page {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { kind: "home" };
  }

  if (segments.length === 1 && `/${segments[0]}` === pluginsPagePath) {
    return { kind: "settings", section: "plugins" };
  }

  if (`/${segments[0]}` === providersPagePath && segments[1] === "new" && segments.length === 2) {
    return { kind: "new-provider" };
  }

  if (`/${segments[0]}` === providersPagePath && segments[2] === "edit" && segments.length === 3) {
    const providerId = segments[1] === undefined ? undefined : decodeProviderId(segments[1]);
    return providerId === undefined
      ? { kind: "unknown", path }
      : { kind: "edit-provider", providerId };
  }

  if (`/${segments[0]}` === providersPagePath && segments.length <= 2) {
    const encodedProviderId = segments[1];

    if (encodedProviderId === undefined) {
      return { kind: "settings", section: "providers" };
    }

    const providerId = decodeProviderId(encodedProviderId);

    // Идентификатор провайдера не проверяется форматом, как `sessionId`: это внешние данные
    // рантайма, и их формат — не наш контракт. «Нет такого провайдера» говорит вью по снимку,
    // а маршрут только разбирает адрес.
    return providerId === undefined
      ? { kind: "unknown", path }
      : { kind: "settings", section: "providers", providerId };
  }

  if (`/${segments[0]}` === sessionsPagePath && segments.length <= 2) {
    const sessionId = segments[1];

    if (sessionId === undefined) {
      return { kind: "home" };
    }

    // Строка "new" проходит регекс `isSessionId`, но означает экран создания, а не идентификатор.
    // Проверка строго раньше: иначе адрес `/sessions/new` становился бы сессией с id `new`.
    if (sessionId === "new") {
      return { kind: "new-session" };
    }

    if (sessionId === "archive") {
      return { kind: "session-archive" };
    }

    // Мусор в адресе не превращается в запрос, который вернёт 404: проверка та же, что у демона.
    return isSessionId(sessionId) ? { kind: "session", sessionId } : { kind: "unknown", path };
  }

  if (
    `/${segments[0]}` === settingsPagePath &&
    segments[1] === "projects" &&
    segments.length === 3
  ) {
    const projectId = segments[2] === undefined ? undefined : decodePathSegment(segments[2]);
    return projectId === undefined
      ? { kind: "unknown", path }
      : { kind: "settings-project", projectId };
  }

  if (
    `/${segments[0]}` === settingsPagePath &&
    segments[1] === "plugins" &&
    segments.length === 3
  ) {
    const pluginKey = segments[2] === undefined ? undefined : decodeOpaqueSegment(segments[2]);

    return pluginKey === undefined
      ? { kind: "unknown", path }
      : { kind: "settings-plugin", pluginKey };
  }

  if (
    `/${segments[0]}` === settingsPagePath &&
    segments[1] === "providers" &&
    segments[2] === "new" &&
    segments.length === 3
  ) {
    return { kind: "new-provider" };
  }

  if (
    `/${segments[0]}` === settingsPagePath &&
    segments[1] === "providers" &&
    segments[3] === "edit" &&
    segments.length === 4
  ) {
    const providerId = segments[2] === undefined ? undefined : decodeProviderId(segments[2]);
    return providerId === undefined
      ? { kind: "unknown", path }
      : { kind: "edit-provider", providerId };
  }

  if (`/${segments[0]}` === settingsPagePath && segments.length <= 3) {
    const section = segments[1];

    if (section === undefined) {
      return { kind: "settings", section: "appearance" };
    }

    if (!isSettingsSection(section)) {
      return { kind: "unknown", path };
    }

    const providerSegment = segments[2];

    if (providerSegment === undefined) {
      return { kind: "settings", section };
    }

    if (section !== "providers") {
      return { kind: "unknown", path };
    }

    const providerId = decodeProviderId(providerSegment);

    return providerId === undefined
      ? { kind: "unknown", path }
      : { kind: "settings", section: "providers", providerId };
  }

  if (segments[0] === pluginPagePrefix) {
    const [, encodedPluginId, encodedPageId, ...rest] = segments;

    // Полпути — не страница плагина: адрес без идентификатора страницы открывать нечем.
    if (encodedPluginId === undefined || encodedPageId === undefined) {
      return { kind: "unknown", path };
    }

    const pluginId = decodeOpaqueSegment(encodedPluginId);
    const pageId = decodeOpaqueSegment(encodedPageId);

    if (pluginId === undefined || pageId === undefined) {
      return { kind: "unknown", path };
    }

    return { kind: "plugin", pluginId, pageId, rest: rest.join("/") };
  }

  return { kind: "unknown", path };
}

export function pathOf(page: Page): string {
  switch (page.kind) {
    case "home":
      return "/";
    case "session":
      return `${sessionsPagePath}/${page.sessionId}`;
    case "session-archive":
      return `${sessionsPagePath}/archive`;
    case "new-session":
      return `${sessionsPagePath}/new`;
    case "new-provider":
      return `${settingsPagePath}/providers/new`;
    case "edit-provider":
      return `${settingsPagePath}/providers/${encodeProviderId(page.providerId)}/edit`;
    case "settings":
      return page.section === "providers" && page.providerId !== undefined
        ? `${settingsPagePath}/providers/${encodeProviderId(page.providerId)}`
        : `${settingsPagePath}/${page.section}`;
    case "settings-plugin":
      return `${settingsPagePath}/plugins/${encodeOpaqueSegment(page.pluginKey)}`;
    case "settings-project":
      return `${settingsPagePath}/projects/${encodeURIComponent(page.projectId)}`;
    case "plugin":
      return `/${pluginPagePrefix}/${encodeOpaqueSegment(page.pluginId)}/${encodeOpaqueSegment(page.pageId)}${page.rest === "" ? "" : `/${page.rest}`}`;
    case "unknown":
      return page.path;
  }
}

/**
 * Разбирает адрес целиком. Якорь отбрасывается: он адресует место внутри страницы, а не страницу, и
 * маршруту не принадлежит.
 */
export function matchLocation(url: string): Location {
  const [addressed = ""] = url.split("#");
  const questionMark = addressed.indexOf("?");
  const path = questionMark === -1 ? addressed : addressed.slice(0, questionMark);
  const search = questionMark === -1 ? "" : addressed.slice(questionMark + 1);

  return { page: matchPage(path), query: parseQuery(search) };
}

export function urlOf(location: Location): string {
  const path = pathOf(location.page);
  const search = new URLSearchParams(Object.entries(location.query)).toString();

  return search === "" ? path : `${path}?${search}`;
}

function parseQuery(search: string): Readonly<Record<string, string>> {
  if (search === "") {
    return withoutParameters;
  }

  const query: Record<string, string> = {};

  for (const [key, value] of new URLSearchParams(search)) {
    query[key] = value;
  }

  return query;
}

export type NavigateOptions = {
  /** Замена записи истории вместо новой: фильтр страницы не обязан наполнять кнопку «назад». */
  replace?: boolean;
};

export type Navigation = {
  current: () => Location;
  /** Голый `Page` значит «без параметров»: маршруты ядра о них не знают. */
  navigate: (target: Location | Page, options?: NavigateOptions) => void;
  /** Возвращает функцию отписки. Кнопка «назад» браузера — такое же событие, как наш переход. */
  subscribe: (listener: (location: Location) => void) => () => void;
};

export function createNavigation(target: Window = window): Navigation {
  const listeners = new Set<(location: Location) => void>();
  const addressed = (): string => `${target.location.pathname}${target.location.search}`;
  const readCurrent = (): Location => {
    const location = matchLocation(addressed());
    const canonicalPath = pathOf(location.page);

    // Канонизация трогает только путь. Параметры и якорь маршруту не принадлежат, и переезд со
    // старого системного адреса на новый не вправе их стирать.
    if (canonicalPath !== target.location.pathname) {
      target.history.replaceState(
        undefined,
        "",
        `${canonicalPath}${target.location.search}${target.location.hash}`,
      );
    }

    return location;
  };
  const announce = (): void => {
    const location = readCurrent();

    for (const listener of [...listeners]) {
      listener(location);
    }
  };

  return {
    current: readCurrent,
    navigate: (destination, options) => {
      const location =
        "page" in destination ? destination : { page: destination, query: withoutParameters };
      const url = urlOf(location);

      // Сравнение по полному адресу, а не по пути: переход, меняющий только параметры, — это
      // переход, и молчать о нём значило бы не пускать страницу плагина в её же адрес.
      if (url === addressed()) {
        return;
      }

      if (options?.replace === true) {
        target.history.replaceState(undefined, "", url);
      } else {
        target.history.pushState(undefined, "", url);
      }

      announce();
    },
    subscribe: (listener) => {
      // Слушатель истории живёт ровно столько, сколько есть кому слушать. Привязать его к созданию
      // навигации нельзя: снять его тогда можно только отдельным вызовом, а `StrictMode`
      // проигрывает подписку дважды — после первой же отписки кнопка «назад» переставала бы
      // доезжать до приложения, оставляя адрес и экран разошедшимися.
      if (listeners.size === 0) {
        target.addEventListener("popstate", announce);
      }

      listeners.add(listener);

      return () => {
        listeners.delete(listener);

        if (listeners.size === 0) {
          target.removeEventListener("popstate", announce);
        }
      };
    },
  };
}
