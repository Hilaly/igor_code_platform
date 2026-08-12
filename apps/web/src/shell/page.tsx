/**
 * Центральная страница: разводит адреса по вью. Проекты, провайдеры и управление плагинами
 * собраны внутри единого Settings; страница плагина приходит собранной, как и остальные вью
 * (docs/ui-extension-model.md).
 */

import type {
  PluginOwnedPageRegistration,
  PluginStatus,
  Project,
  ProviderSummary,
  Session,
} from "@sovereign/protocol";
import { EmptyState, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import type { Page } from "../router.ts";
import type { ShellHeaderDescription } from "./header.tsx";

export type PageHeaderData = {
  session?: Session;
  project?: Project;
  provider?: ProviderSummary;
  plugin?: PluginStatus;
  /** Заголовок страницы плагина известен из снимка — до того, как загружен её код. */
  pluginPage?: PluginOwnedPageRegistration;
};

/** Stable route-level title/context. Missing remote data is intentionally not guessed. */
export function describePage(
  page: Page,
  translator: ScopedTranslator,
  data: PageHeaderData = {},
): ShellHeaderDescription {
  const { t } = translator;

  switch (page.kind) {
    case "home":
      return { title: t("page.home.title") };
    case "session":
      return {
        title: t("page.sessions.title"),
        // Имя проекта, а не путь на диске: путь длинный, обрезается первым и в полосе ничего не
        // сообщает. Он остаётся доступен подсказкой у вью чата, который знает про наведение.
        context:
          data.project === undefined
            ? data.session?.folder
            : data.project.ephemeral
              ? t("projects.ephemeral")
              : data.project.name,
      };
    case "session-archive":
      return { title: t("sessions.archive.title") };
    case "new-session":
      return { title: t("sessions.new.title") };
    case "new-provider":
      return { title: t("providers.user.new") };
    case "edit-provider":
      return {
        title: data.provider?.name ?? t("providers.user.edit", { id: page.providerId }),
        context: data.provider?.baseUrl,
      };
    case "settings":
      return {
        title: t(`settings.section.${page.section}`),
        context: page.providerId === undefined ? undefined : data.provider?.name,
      };
    case "settings-project":
      return {
        title: data.project?.name ?? t("settings.section.projects"),
        context: data.project?.folder,
      };
    case "settings-plugin":
      return {
        title: data.plugin?.id ?? t("settings.section.plugins"),
        context: data.plugin?.key,
      };
    case "plugin":
      return {
        title: data.pluginPage?.title ?? t("page.plugin.title"),
        context: `${page.pluginId}/${page.pageId}`,
      };
    case "unknown":
      return { title: t("page.unknown.title") };
  }
}

export type PageViewProps = {
  page: Page;
  /** Вью приходят собранными: страница не знает ни про шину, ни про запросы. */
  session: ReactNode;
  sessionArchive: ReactNode;
  /** Создание сессии — отдельный адресуемый экран, не часть мастер-детали. */
  newSession: ReactNode;
  newProvider: ReactNode;
  editProvider: ReactNode;
  settings: ReactNode;
  /** Страница плагина: маршрут ядра, содержимое чужое. */
  pluginPage: ReactNode;
  translator: ScopedTranslator;
};

export function PageView({
  page,
  session,
  sessionArchive,
  newSession,
  newProvider,
  editProvider,
  settings,
  pluginPage,
  translator,
}: PageViewProps) {
  const { t } = translator;

  if (page.kind === "session") {
    return session;
  }

  if (page.kind === "session-archive") {
    return sessionArchive;
  }

  if (page.kind === "new-session") {
    return newSession;
  }

  if (page.kind === "new-provider") return newProvider;

  if (page.kind === "edit-provider") return editProvider;

  if (
    page.kind === "settings" ||
    page.kind === "settings-project" ||
    page.kind === "settings-plugin"
  ) {
    return settings;
  }

  if (page.kind === "plugin") {
    return pluginPage;
  }

  if (page.kind === "unknown") {
    return (
      <EmptyState
        title={t("page.unknown.title")}
        hint={t("page.unknown.hint", { path: page.path })}
      />
    );
  }

  return (
    <div className="shell-home">
      <EmptyState title={t("state.empty")} hint={t("page.home.hint")} />
    </div>
  );
}
