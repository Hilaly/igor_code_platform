/**
 * Центральная страница. В этом срезе на всех адресах стоит заглушка оболочки: вью плагинов встанет
 * сюда следующим, а страницы плагинов — вместе с браузерным кодом, который собирает демон (ADR-0025).
 */

import { EmptyState, Heading, type ScopedTranslator } from "@sovereign/ui-kit";

import type { Page } from "../router.ts";

export type PageViewProps = {
  page: Page;
  translator: ScopedTranslator;
};

export function PageView({ page, translator }: PageViewProps) {
  const { t } = translator;

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
