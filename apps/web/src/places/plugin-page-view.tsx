/**
 * Открытая страница плагина. Маршрут остаётся у ядра: вью резолвит страницу по снимку и отдаёт её
 * браузерному SDK вместе с адресом (docs/ui-extension-model.md).
 *
 * Заглушка всегда с возвратом, а не общий «не найдено»: выключенный плагин обязан оставить адрес
 * живым, чтобы включение вернуло страницу на том же URL.
 */

import type { CoreDestination } from "@sovereign/browser-sdk";
import { HostPluginPage, type HostPageNavigation } from "@sovereign/browser-sdk/host";
import { Button, EmptyState, type ScopedTranslator } from "@sovereign/ui-kit";
import { useMemo, type ReactNode } from "react";

import { pluginPagePrefix, type Page } from "../router.ts";
import type { PluginPageState } from "./plugin-page.ts";

export type PluginPageViewProps = {
  page: Extract<Page, { kind: "plugin" }>;
  query: Readonly<Record<string, string>>;
  /** Разбор адреса приходит готовым: его же читает шапка, и второго разбора не заводится. */
  state: PluginPageState;
  onNavigate(path: string, query: Readonly<Record<string, string>>, replace: boolean): void;
  onNavigateCore(destination: CoreDestination): void;
  translator: ScopedTranslator;
};

// Не экспортируется: у файла с компонентом экспорт не-компонента ломает Fast Refresh, а базу
// страницы больше никто не строит — адрес для ссылок считает `plugins/state.ts`.
function pluginPageBasePath(pluginId: string, pageId: string): string {
  return `/${pluginPagePrefix}/${pluginId}/${pageId}`;
}

export function PluginPageView({
  page,
  query,
  state,
  onNavigate,
  onNavigateCore,
  translator,
}: PluginPageViewProps): ReactNode {
  const { t } = translator;
  const navigation = useMemo<HostPageNavigation>(
    () => ({
      basePath: pluginPageBasePath(page.pluginId, page.pageId),
      rest: page.rest,
      query,
      onNavigate,
      onNavigateCore,
    }),
    [page.pluginId, page.pageId, page.rest, query, onNavigate, onNavigateCore],
  );
  const address = `${page.pluginId}/${page.pageId}`;
  const home = (
    <Button tone="secondary" onClick={() => onNavigateCore({ kind: "home" })}>
      {t("page.plugin.back")}
    </Button>
  );

  if (state.kind === "open") {
    return (
      <HostPluginPage
        registration={state.registration}
        navigation={navigation}
        context={{}}
        fallback={
          state.status?.state === "failed" || state.status?.state === "refused" ? (
            <EmptyState
              title={t("page.plugin.failed")}
              hint={state.status.reason ?? address}
              action={home}
            />
          ) : (
            <EmptyState title={t("page.plugin.waiting")} hint={address} />
          )
        }
      />
    );
  }

  if (state.kind === "waiting") {
    return <EmptyState title={t("page.plugin.waiting")} hint={address} />;
  }

  if (state.kind === "switched-off") {
    return (
      <EmptyState
        title={t("page.plugin.switchedOff")}
        hint={t("page.plugin.switchedOff.hint", { address })}
        action={home}
      />
    );
  }

  if (state.kind === "failed") {
    return (
      <EmptyState title={t("page.plugin.failed")} hint={state.reason ?? address} action={home} />
    );
  }

  return (
    <EmptyState
      title={t("page.plugin.missing")}
      hint={t("page.plugin.missing.hint", { address })}
      action={home}
    />
  );
}
