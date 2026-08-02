/**
 * Свой маршрутизатор вместо библиотеки: маршрутов ядра единицы, а неймспейс страниц плагина —
 * `/p/<pluginId>/<pageId>/*` — задан моделью расширения (ui-extension-model.md), а не библиотекой.
 * Внешняя библиотека станет вопросом тогда, когда появятся страницы плагинов со своими вложенными
 * маршрутами; до тех пор она была бы зависимостью ради `history.pushState`.
 */

import { isSessionId } from "@sovereign/protocol";

export const pluginPagePrefix = "p";

/** Вью базовой поставки живут в ядре и своего адреса не теряют (docs/architecture.md). */
export const pluginsPagePath = "/plugins";
export const projectsPagePath = "/projects";
export const providersPagePath = "/providers";
export const sessionsPagePath = "/sessions";
export const settingsPagePath = "/settings";

/** Разделы вью настроек. Список закрыт: раздел, который ядро не знает, не превращается в запрос. */
export const settingsSections = ["appearance", "daemon", "diagnostics"] as const;

export type SettingsSection = (typeof settingsSections)[number];

export type Page =
  | { kind: "home" }
  | { kind: "plugins" }
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  /**
   * Список провайдеров, а с идентификатором — страница одного: вход и модели живут там, а не в
   * раскрывающейся панели списка (docs/models-and-providers.md).
   */
  | { kind: "providers"; providerId?: string }
  /** Мастер-деталь: список сессий, а с идентификатором — ещё и открытый чат. */
  | { kind: "sessions"; sessionId?: string }
  /**
   * Создание сессии — отдельный адресуемый экран, а не модал: у модала фиксированная ширина, и
   * список моделей в нём не помещается. Адрес даёт ещё и рабочую кнопку «назад» и перезагрузку.
   */
  | { kind: "new-session" }
  /** Голый адрес — без выбранного раздела, вью сама показывает первый. */
  | { kind: "settings"; section?: SettingsSection }
  /** Страница плагина. Открыть её пока нечем: браузерный код плагина демон ещё не собирает. */
  | { kind: "plugin"; pluginId: string; pageId: string; rest: string }
  | { kind: "unknown"; path: string };

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
function encodeProviderId(providerId: string): string {
  if (providerId === ".") {
    return "~%2E";
  }

  if (providerId === "..") {
    return "~%2E%2E";
  }

  return encodeURIComponent(providerId);
}

function decodeProviderId(segment: string): string | undefined {
  if (segment === "~%2E") {
    return ".";
  }

  if (segment === "~%2E%2E") {
    return "..";
  }

  return decodePathSegment(segment);
}

export function matchPage(path: string): Page {
  const segments = path.split("/").filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return { kind: "home" };
  }

  if (segments.length === 1 && `/${segments[0]}` === pluginsPagePath) {
    return { kind: "plugins" };
  }

  if (segments.length === 1 && `/${segments[0]}` === projectsPagePath) {
    return { kind: "projects" };
  }

  if (`/${segments[0]}` === projectsPagePath && segments.length === 2) {
    const segment = segments[1];
    const projectId = segment === undefined ? undefined : decodePathSegment(segment);

    return projectId === undefined ? { kind: "unknown", path } : { kind: "project", projectId };
  }

  if (`/${segments[0]}` === providersPagePath && segments.length <= 2) {
    const encodedProviderId = segments[1];

    if (encodedProviderId === undefined) {
      return { kind: "providers" };
    }

    const providerId = decodeProviderId(encodedProviderId);

    // Идентификатор провайдера не проверяется форматом, как `sessionId`: это внешние данные
    // рантайма, и их формат — не наш контракт. «Нет такого провайдера» говорит вью по снимку,
    // а маршрут только разбирает адрес.
    return providerId === undefined ? { kind: "unknown", path } : { kind: "providers", providerId };
  }

  if (`/${segments[0]}` === sessionsPagePath && segments.length <= 2) {
    const sessionId = segments[1];

    if (sessionId === undefined) {
      return { kind: "sessions" };
    }

    // Строка "new" проходит регекс `isSessionId`, но означает экран создания, а не идентификатор.
    // Проверка строго раньше: иначе адрес `/sessions/new` становился бы сессией с id `new`.
    if (sessionId === "new") {
      return { kind: "new-session" };
    }

    // Мусор в адресе не превращается в запрос, который вернёт 404: проверка та же, что у демона.
    return isSessionId(sessionId) ? { kind: "sessions", sessionId } : { kind: "unknown", path };
  }

  if (`/${segments[0]}` === settingsPagePath && segments.length <= 2) {
    const section = segments[1];

    if (section === undefined) {
      return { kind: "settings" };
    }

    return settingsSections.includes(section as SettingsSection)
      ? { kind: "settings", section: section as SettingsSection }
      : { kind: "unknown", path };
  }

  if (segments[0] === pluginPagePrefix) {
    const [, pluginId, pageId, ...rest] = segments;

    // Полпути — не страница плагина: адрес без идентификатора страницы открывать нечем.
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
    case "plugins":
      return pluginsPagePath;
    case "projects":
      return projectsPagePath;
    case "project":
      return `${projectsPagePath}/${encodeURIComponent(page.projectId)}`;
    case "providers":
      return page.providerId === undefined
        ? providersPagePath
        : `${providersPagePath}/${encodeProviderId(page.providerId)}`;
    case "sessions":
      return page.sessionId === undefined
        ? sessionsPagePath
        : `${sessionsPagePath}/${page.sessionId}`;
    case "new-session":
      return `${sessionsPagePath}/new`;
    case "settings":
      return page.section === undefined ? settingsPagePath : `${settingsPagePath}/${page.section}`;
    case "plugin":
      return `/${pluginPagePrefix}/${page.pluginId}/${page.pageId}${page.rest === "" ? "" : `/${page.rest}`}`;
    case "unknown":
      return page.path;
  }
}

export type Navigation = {
  current: () => Page;
  navigate: (page: Page) => void;
  /** Возвращает функцию отписки. Кнопка «назад» браузера — такое же событие, как наш переход. */
  subscribe: (listener: (page: Page) => void) => () => void;
};

export function createNavigation(target: Window = window): Navigation {
  const listeners = new Set<(page: Page) => void>();
  const announce = (): void => {
    const page = matchPage(target.location.pathname);

    for (const listener of [...listeners]) {
      listener(page);
    }
  };

  target.addEventListener("popstate", announce);

  return {
    current: () => matchPage(target.location.pathname),
    navigate: (page) => {
      const path = pathOf(page);

      if (path === target.location.pathname) {
        return;
      }

      target.history.pushState(undefined, "", path);
      announce();
    },
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
  };
}
