/**
 * Свой маршрутизатор вместо библиотеки: маршрутов ядра единицы, а неймспейс страниц плагина —
 * `/p/<pluginId>/<pageId>/*` — задан моделью расширения (ui-extension-model.md), а не библиотекой.
 * Внешняя библиотека станет вопросом тогда, когда появятся страницы плагинов со своими вложенными
 * маршрутами; до тех пор она была бы зависимостью ради `history.pushState`.
 */

import { isSessionId } from "@sovereign/protocol";

export const pluginPagePrefix = "p";

/** Канонические адреса рабочих вью; старые системные адреса разбираются ниже для замены. */
export const pluginsPagePath = "/plugins";
export const projectsPagePath = "/projects";
export const providersPagePath = "/providers";
export const sessionsPagePath = "/sessions";
export const settingsPagePath = "/settings";

/** Разделы вью настроек. Список закрыт: раздел, который ядро не знает, не превращается в запрос. */
export const settingsSections = [
  "appearance",
  "providers",
  "plugins",
  "daemon",
  "diagnostics",
] as const;

export type SettingsSection = (typeof settingsSections)[number];

export type Page =
  | { kind: "home" }
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
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
  /** Административная деталь плагина; не смешивается с пользовательскими страницами `/p/...`. */
  | { kind: "settings-plugin"; pluginKey: string }
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

  if (segments.length === 1 && `/${segments[0]}` === projectsPagePath) {
    return { kind: "projects" };
  }

  if (`/${segments[0]}` === projectsPagePath && segments.length === 2) {
    const segment = segments[1];
    const projectId = segment === undefined ? undefined : decodePathSegment(segment);

    return projectId === undefined ? { kind: "unknown", path } : { kind: "project", projectId };
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

    if (!settingsSections.includes(section as SettingsSection)) {
      return { kind: "unknown", path };
    }

    const providerSegment = segments[2];

    if (providerSegment === undefined) {
      return { kind: "settings", section: section as SettingsSection };
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
    case "projects":
      return projectsPagePath;
    case "project":
      return `${projectsPagePath}/${encodeURIComponent(page.projectId)}`;
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
  const readCurrent = (): Page => {
    const page = matchPage(target.location.pathname);
    const canonicalPath = pathOf(page);

    if (canonicalPath !== target.location.pathname) {
      target.history.replaceState(undefined, "", canonicalPath);
    }

    return page;
  };
  const announce = (): void => {
    const page = readCurrent();

    for (const listener of [...listeners]) {
      listener(page);
    }
  };

  target.addEventListener("popstate", announce);

  return {
    current: readCurrent,
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
