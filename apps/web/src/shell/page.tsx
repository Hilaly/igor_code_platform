/**
 * Центральная страница: разводит адреса по вью. Своё вью есть у управления плагинами, страницы
 * плагинов появятся вместе с браузерным кодом, который собирает демон (ADR-0025).
 */

import { EmptyState, Heading, type ScopedTranslator } from "@sovereign/ui-kit";
import type { ReactNode } from "react";

import type { Page } from "../router.ts";

export type PageViewProps = {
  page: Page;
  /** Вью плагинов приходит собранным: страница не знает ни про шину, ни про запросы. */
  plugins: ReactNode;
  translator: ScopedTranslator;
};

export function PageView({ page, plugins, translator }: PageViewProps) {
  const { t } = translator;

  if (page.kind === "plugins") {
    return plugins;
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
