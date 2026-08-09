/**
 * Страница плагина и её фасад навигации (docs/ui-extension-model.md).
 *
 * Фасад — хук, а не пропсы корневого компонента: навигация нужна на любой глубине внутри страницы,
 * и пропсами её пришлось бы протаскивать вниз руками через код автора плагина.
 *
 * Адресом владеет хост: сюда он передаёт готовые базу, хвост и параметры, а обратно получает путь,
 * уже приведённый к виду «от базы страницы». Так правило «страница не выходит из своего поддерева»
 * живёт в одном месте и проверяется здесь же, а не повторяется у каждого, кто рисует страницу.
 */

import type { PluginOwnedPageRegistration } from "@sovereign/protocol";
import { createContext, useContext, useMemo, type ReactNode } from "react";

import { PlaceInstance } from "./host.tsx";
import type { CoreDestination } from "./navigation.ts";
import { normalizePagePath } from "./page-path.ts";
import type { PlaceContext } from "./runtime-context.tsx";

export type PageNavigateOptions = {
  query?: Readonly<Record<string, string>>;
  /** Замена записи истории вместо новой: фильтр не обязан наполнять кнопку «назад». */
  replace?: boolean;
};

export type PageNavigation = {
  /** База страницы: `/p/<pluginId>/<pageId>`. */
  basePath: string;
  /**
   * Путь внутри страницы, всегда с ведущим слэшем; на корне — `/`. Передан так, как стоит в адресе,
   * то есть percent-кодированным: где у сегмента разделитель, знает только сама страница.
   */
  path: string;
  query: Readonly<Record<string, string>>;
  /**
   * Переход внутри страницы. Путь считается от базы страницы — с ведущим слэшем или без него;
   * относительных переходов «от текущего места» нет: на странице, которая сама решает, где у неё
   * уровень, они читаются двусмысленно.
   */
  navigate(path: string, options?: PageNavigateOptions): void;
  /** Выход на адреса, которыми владеет ядро. */
  navigateCore(destination: CoreDestination): void;
};

/** То, что о странице знает хост: он владеет адресом, а страница — тем, что внутри неё. */
export type HostPageNavigation = {
  basePath: string;
  /** Хвост адреса после базы, как он стоит в URL. */
  rest: string;
  query: Readonly<Record<string, string>>;
  onNavigate(path: string, query: Readonly<Record<string, string>>, replace: boolean): void;
  onNavigateCore(destination: CoreDestination): void;
};

export type HostPluginPageProps = {
  registration: PluginOwnedPageRegistration;
  navigation: HostPageNavigation;
  context: PlaceContext;
  /** Что стоит на месте страницы, пока её код не загружен или если он не загрузился. */
  fallback: ReactNode;
};

const PageNavigationContext = createContext<PageNavigation | undefined>(undefined);

const withoutParameters: Readonly<Record<string, string>> = Object.freeze({});

export function usePageNavigation(): PageNavigation {
  const navigation = useContext(PageNavigationContext);

  // Ошибка автора, а не состояние: рассказывать о ней данными некому. Падение ловит граница
  // экземпляра, поэтому оболочка остаётся живой, а отказ виден в диагностике вью плагинов.
  if (navigation === undefined) {
    throw new Error("usePageNavigation works only inside a page of a plugin");
  }

  return navigation;
}

export function HostPluginPage({
  registration,
  navigation,
  context,
  fallback,
}: HostPluginPageProps): ReactNode {
  const { basePath, rest, query, onNavigate, onNavigateCore } = navigation;
  const facade = useMemo<PageNavigation>(
    () => ({
      basePath,
      path: normalizePagePath(rest),
      query,
      navigate: (path, options) =>
        onNavigate(
          normalizePagePath(path),
          options?.query ?? withoutParameters,
          options?.replace ?? false,
        ),
      navigateCore: onNavigateCore,
    }),
    [basePath, rest, query, onNavigate, onNavigateCore],
  );

  return (
    <PageNavigationContext value={facade}>
      <PlaceInstance
        reference={{
          pluginKey: registration.pluginKey,
          contributionId: registration.id,
          exportName: registration.export,
        }}
        context={context}
        fallback={fallback}
        subject="page"
      />
    </PageNavigationContext>
  );
}
