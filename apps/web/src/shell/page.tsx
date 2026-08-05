/**
 * Центральная страница: разводит адреса по вью. Проекты, провайдеры и управление плагинами
 * собраны внутри единого Settings; страницы плагинов появятся вместе с браузерным кодом, который собирает демон
 * (docs/ui-extension-model.md).
 */

import { EmptyState, Heading, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import type { Page } from "../router.ts";

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
