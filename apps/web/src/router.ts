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
  | { kind: "providers" }
  /** Мастер-деталь: список сессий, а с идентификатором — ещё и открытый чат. */
  | { kind: "sessions"; sessionId?: string }
  /** Голый адрес — без выбранного раздела, вью сама показывает первый. */
  | { kind: "settings"; section?: SettingsSection }
  /** Страница плагина. Открыть её пока нечем: браузерный код плагина демон ещё не собирает. */
  | { kind: "plugin"; pluginId: string; pageId: string; rest: string }
  | { kind: "unknown"; path: string };

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

  if (segments.length === 1 && `/${segments[0]}` === providersPagePath) {
    return { kind: "providers" };
  }

  if (`/${segments[0]}` === sessionsPagePath && segments.length <= 2) {
    const sessionId = segments[1];

    if (sessionId === undefined) {
      return { kind: "sessions" };
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
    case "providers":
      return providersPagePath;
    case "sessions":
      return page.sessionId === undefined
        ? sessionsPagePath
        : `${sessionsPagePath}/${page.sessionId}`;
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
