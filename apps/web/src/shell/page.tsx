/**
 * Центральная страница: разводит адреса по вью. Свои вью есть у сессий, у проектов, у провайдеров и у
 * управления плагинами, страницы плагинов появятся вместе с браузерным кодом, который собирает демон
 * (docs/ui-extension-model.md).
 */

import { EmptyState, Heading, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import type { Page } from "../router.ts";

export type PageViewProps = {
  page: Page;
  /** Вью приходят собранными: страница не знает ни про шину, ни про запросы. */
  plugins: ReactNode;
  projects: ReactNode;
  project: ReactNode;
  providers: ReactNode;
  sessions: ReactNode;
  /** Создание сессии — отдельный адресуемый экран, не часть мастер-детали. */
  newSession: ReactNode;
  settings: ReactNode;
  translator: ScopedTranslator;
};

export function PageView({
  page,
  plugins,
  projects,
  project,
  providers,
  sessions,
  newSession,
  settings,
  translator,
}: PageViewProps) {
  const { t } = translator;

  if (page.kind === "plugins") {
    return plugins;
  }

  if (page.kind === "projects") {
    return projects;
  }

  if (page.kind === "project") {
    return project;
  }

  if (page.kind === "providers") {
    return providers;
  }

  if (page.kind === "sessions") {
    return sessions;
  }

  if (page.kind === "new-session") {
    return newSession;
  }

  if (page.kind === "settings") {
    return settings;
  }

  if (page.kind === "plugin") {
    return (
      <EmptyState
        title={t("page.plugin.title")}
        hint={`${t("page.plugin.hint")} (${page.pluginId}/${page.pageId})`}
      />
    );
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
      <Heading level={1}>{t("page.home.title")}</Heading>
      <EmptyState title={t("state.empty")} hint={t("page.home.hint")} />
    </div>
  );
}
