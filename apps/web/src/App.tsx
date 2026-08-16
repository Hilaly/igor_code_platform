/**
 * Сборка интерфейса: поток, шина, настройки внешнего вида, перевод, маршрутизация и оболочка. Всё
 * долгоживущее создаётся здесь по одному экземпляру — соединение с демоном одно на вкладку
 * (docs/web-api.md), и владелец у него один.
 */

import type { CoreDestination } from "@sovereign/browser-sdk";
import {
  coreEventTypes,
  healthPath,
  isPluginStreamEvent,
  streamGapType,
  type AppearancePreferences,
  type AuthenticationState,
  type Health,
  type LoginStepFrame,
  type PlaceContext,
  type SessionDeltaFrame,
} from "@sovereign/protocol";
import {
  BrandLockup,
  Button,
  CommandsIcon,
  coreNamespace,
  createTranslator,
  Spinner,
} from "@sovereign/ui-kit";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  applyAppearance,
  cacheAppearance,
  defaultAppearancePreferences,
  describeSchemes,
  fetchAppearance,
  pluginColorSchemes,
  readCachedAppearance,
  resolveEffectiveAppearance,
  shippedSchemes,
  writeAppearance,
} from "./appearance.ts";
import { availableLocales, pluginCatalogs, shippedCatalogs } from "./catalogs.ts";
import { createDiagnosticsStore, type Diagnostic } from "./diagnostics.ts";
import { createFrontendBus } from "./events/bus.ts";
import { createBrowserEventBridge } from "./events/browser-bridge.ts";
import { connectEventStream, type StreamStatus } from "./events/stream.ts";
import { LoginView } from "./login/login-view.tsx";
import { CommandPalette, useCommandPaletteShortcut } from "./commands/command-palette.tsx";
import { locationOfDestination } from "./navigation/core-destination.ts";
import {
  BrowserRuntimeProvider,
  HostPlace,
  HostPlaceCollection,
  useHostPlaceTabs,
} from "./places/place-host.tsx";
import { PluginPageView } from "./places/plugin-page-view.tsx";
import { resolvePluginPageState } from "./places/plugin-page.ts";
import { PluginsView } from "./plugins/plugins-view.tsx";
import { PluginDetailView } from "./plugins/plugin-detail-view.tsx";
import { usePlugins } from "./plugins/use-plugins.ts";
import { windowWideContributions } from "./plugins/window-wide.ts";
import { ProjectsView } from "./projects/projects-view.tsx";
import { ProjectDetailView } from "./projects/project-detail-view.tsx";
import { FileResourcesPanel } from "./projects/file-resources-panel.tsx";
import { useProjects } from "./projects/use-projects.ts";
import { useFileResources } from "./projects/use-file-resources.ts";
import { ProvidersView } from "./providers/providers-view.tsx";
import { UserProviderForm } from "./providers/user-provider-form.tsx";
import {
  createUserProvider,
  deleteUserProvider,
  fetchUserProvider,
  refreshUserProvider,
  updateUserProvider,
} from "./providers/api.ts";
import { useProviders } from "./providers/use-providers.ts";
import { NewSessionView } from "./sessions/new-session-view.tsx";
import { ArchiveSessionsView } from "./sessions/archive-sessions-view.tsx";
import { ChatView } from "./sessions/chat-view.tsx";
import { SidebarProjects } from "./sessions/sidebar-projects.tsx";
import { SessionRouteView } from "./sessions/session-route-view.tsx";
import { useSessions } from "./sessions/use-sessions.ts";
import { createNavigation, type Location } from "./router.ts";
import { logIn, logOut, probeSession, register } from "./session.ts";
import { AppearanceSection } from "./settings/appearance-section.tsx";
import { DaemonSection } from "./settings/daemon-section.tsx";
import { DiagnosticsSection } from "./settings/diagnostics-section.tsx";
import { useConfig } from "./settings/use-config.ts";
import { SettingsView } from "./settings/settings-view.tsx";
import { useUsage } from "./usage/use-usage.ts";
import { UsageView } from "./usage/usage-view.tsx";
import { AccountControl } from "./shell/account-control.tsx";
import { readLayout, writeLayout, type ShellLayout } from "./shell/layout.ts";
import { describePage, PageView } from "./shell/page.tsx";
import { Shell, type ShellProps } from "./shell/shell.tsx";

/** Пока состояние входа не спрошено, показывать нечего: и оболочка, и форма были бы догадкой. */
type Access = AuthenticationState | "asking";

/**
 * Предмет оконного места настроек: вид страницы и, когда открыта карточка, идентификатор того, что
 * на ней. Проекта в контексте нет намеренно — оконное вью плагину из папки проекта не отдаётся.
 */
const settingsSubject = (name: string, identifier: string | undefined): PlaceContext =>
  identifier === undefined
    ? { subject: { view: "list" } }
    : { subject: { view: "detail", [name]: identifier } };

export function App() {
  const diagnostics = useMemo(createDiagnosticsStore, []);
  const bus = useMemo(
    () =>
      createFrontendBus({
        onListenerError: (cause, event) =>
          diagnostics.record(
            `a subscriber failed on ${event.type}: ${cause instanceof Error ? cause.message : String(cause)}`,
          ),
      }),
    [diagnostics],
  );
  const browserEventBridge = useMemo(() => createBrowserEventBridge(bus), [bus]);
  const navigation = useMemo(() => createNavigation(), []);

  const [reported, setReported] = useState<Diagnostic[]>([]);
  const [preferences, setPreferences] = useState<AppearancePreferences>(
    () => readCachedAppearance(localStorage) ?? defaultAppearancePreferences,
  );
  const [refusal, setRefusal] = useState<string | undefined>(undefined);
  const [prefersDark, setPrefersDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const [stream, setStream] = useState<StreamStatus>("connecting");
  const [health, setHealth] = useState<Health | undefined>(undefined);
  const [failure, setFailure] = useState<string | undefined>(undefined);
  const [location, setLocation] = useState<Location>(() => navigation.current());
  const [draftProjectId, setDraftProjectId] = useState<string | undefined>(undefined);
  const [newSessionResetKey, setNewSessionResetKey] = useState(0);
  const [layout, setLayout] = useState<ShellLayout>(() => readLayout(localStorage));
  const [access, setAccess] = useState<Access>("asking");
  const [loginRefusal, setLoginRefusal] = useState<string | undefined>(undefined);
  const [loginBusy, setLoginBusy] = useState(false);
  const [expired, setExpired] = useState(false);
  const [commandsOpen, setCommandsOpen] = useState(false);

  // Страница — это то, что рисуется; параметры принадлежат странице плагина и дальше неё не идут.
  const page = location.page;
  const authenticated = access === "authenticated";
  const rightUnavailable =
    page.kind === "settings" || page.kind === "settings-project" || page.kind === "settings-plugin";

  // Аккорд слушается всегда, но палитра сама себя не покажет неаутентифицированному: до входа
  // оболочки на экране нет вовсе.
  useCommandPaletteShortcut(useCallback(() => setCommandsOpen(true), []));

  useEffect(() => diagnostics.subscribe(setReported), [diagnostics]);
  useEffect(() => navigation.subscribe(setLocation), [navigation]);

  // Выбранный проект живёт всё время маршрута новой сессии, чтобы место, форма и контроллер
  // видели один контекст. Уход с маршрута очищает его перед следующим открытием.
  useEffect(() => {
    if (page.kind !== "new-session") {
      setDraftProjectId(undefined);
    }
  }, [page.kind]);

  // Состояние входа спрашивается до всего остального: почти все маршруты защищены (docs/web-api.md),
  // и открывать поток без сессии значит получить отказ и разбирать его вместо ответа.
  useEffect(() => {
    void probeSession().then((probe) => {
      if (probe.kind === "state") {
        setAccess(probe.state);

        return;
      }

      // Спросить не удалось — демон лежит или не читает учётную запись. Форма входа при этом
      // уместнее пустого экрана: причина показана, а первый же запрос уточнит, чего платформа хочет.
      setAccess("unauthenticated");
      setLoginRefusal(probe.reason);
    });
  }, []);

  useEffect(() => {
    writeLayout(localStorage, layout);
  }, [layout]);

  useEffect(() => {
    const query = matchMedia("(prefers-color-scheme: dark)");
    const listen = (event: MediaQueryListEvent): void => setPrefersDark(event.matches);

    query.addEventListener("change", listen);

    return () => query.removeEventListener("change", listen);
  }, []);

  // Ссылка, а не функция в зависимостях: перезапрос зовут и подписка на поток, и обработчик отказа,
  // а пересоздавать из-за него соединение с демоном незачем.
  const reload = useRef(() => {
    // Правку файла руками и запись из интерфейса различать не нужно: состояние спрашивается у
    // владельца (docs/event-bus.md).
    void fetchAppearance()
      .then(setPreferences)
      .catch((cause: unknown) =>
        diagnostics.record(
          `the appearance preferences could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
        ),
      );
  });

  // Шаг входа в провайдера — не событие шины: он адресован одному инициатору и ждёт ответа
  // (docs/models-and-providers.md). Ссылкой, а не зависимостью соединения, по той же причине, что и
  // `reload`: пересоздавать поток из-за смены обработчика незачем.
  const loginStep = useRef<(frame: LoginStepFrame) => void>(() => {});

  // Дельта турна — тоже не событие шины: их сотни на один ответ модели, и на шину они не выходят
  // (docs/sessions-and-projects.md). Связь та же ссылка, по той же причине.
  const sessionDelta = useRef<(frame: SessionDeltaFrame) => void>(() => {});

  // У `EventSource` нет кода ответа, поэтому закрытая сессия выглядит из потока так же, как лежащий
  // демон: различает их только отдельный запрос (docs/authentication.md).
  const recheck = useRef(() => {
    void probeSession().then((probe) => {
      // Недоступный демон — не конец сессии: поток переоткроется сам, и выкидывать человека из
      // интерфейса на сетевой сбой нельзя.
      if (probe.kind !== "state" || probe.state === "authenticated") {
        return;
      }

      setExpired(true);
      setAccess(probe.state);
    });
  });

  useEffect(() => {
    if (!authenticated) {
      return;
    }

    reload.current();

    const connection = connectEventStream({
      bus,
      onStatus: (status) => {
        setStream(status);
        if (status === "open") browserEventBridge.recover();
      },
      onDiagnostic: diagnostics.record,
      onLoginStep: (frame) => loginStep.current(frame),
      onSessionDelta: (frame) => sessionDelta.current(frame),
      onGaveUp: () => recheck.current(),
    });

    const unsubscribe = bus.subscribe((event) => {
      if (isPluginStreamEvent(event)) {
        return;
      }

      // Пропуск в потоке — повод перезапросить своё состояние, а не показывать неполное (docs/web-api.md).
      if (event.type === coreEventTypes.preferencesChanged || event.type === streamGapType) {
        reload.current();
      }
    });

    return () => {
      unsubscribe();
      connection.close();

      // Состояние соединения сбрасывается вместе с ним: иначе следующий вход начинался бы с
      // «переподключаемся» о потоке, которого уже нет.
      setStream("connecting");
    };
  }, [bus, browserEventBridge, diagnostics, authenticated]);

  // Время работы спрашивается на подъёме соединения: пока поток жив, спрашивать незачем.
  useEffect(() => {
    if (stream !== "open") {
      return;
    }

    const controller = new AbortController();

    void fetch(healthPath, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error(`the daemon answered ${response.status}`);
        }

        return (await response.json()) as Health;
      })
      .then((answer) => {
        setHealth(answer);
        setFailure(undefined);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setFailure(cause instanceof Error ? cause.message : String(cause));
      });

    return () => controller.abort();
  }, [stream]);

  const plugins = usePlugins({ bus, stream, onDiagnostic: diagnostics.record });
  const contributions = plugins.state.snapshot?.contributions;
  // Местам достаётся снимок целиком, включая вклады из папок проектов: контекст, в котором место
  // рисуется, знает только само место, и отбор по проекту делает разрешение провайдера.
  const placeContributions = useMemo(() => contributions ?? [], [contributions]);
  const pluginStatuses = useMemo(
    () => plugins.state.snapshot?.plugins ?? [],
    [plugins.state.snapshot],
  );
  // Схема и каталог применяются ко всему окну, а снимок несёт объявления всех контекстов сразу:
  // копия плагина в папке проекта пришла бы вторым `themed.midnight` в тот же список.
  const windowWide = useMemo(() => windowWideContributions(contributions ?? []), [contributions]);
  const declaredSchemes = useMemo(() => pluginColorSchemes(windowWide), [windowWide]);
  const schemes = useMemo(() => [...shippedSchemes, ...declaredSchemes.schemes], [declaredSchemes]);
  const effectiveScheme = useMemo(
    () => resolveEffectiveAppearance(preferences, prefersDark, schemes).scheme.id,
    [preferences, prefersDark, schemes],
  );
  // Отвергнутая схема называется один раз, а не на каждый снимок плагинов: снимок приезжает на любое
  // изменение любого плагина, а сломанная схема остаётся той же самой.
  const namedRefusals = useRef(new Set<string>());

  useEffect(() => {
    for (const refusal of declaredSchemes.refusals) {
      if (namedRefusals.current.has(refusal)) {
        continue;
      }

      namedRefusals.current.add(refusal);
      diagnostics.record(refusal);
    }
  }, [declaredSchemes, diagnostics]);
  // Каталоги плагинов идут после наших: побеждает последний объявивший сообщение (docs/ui-kit.md).
  const catalogs = useMemo(() => [...shippedCatalogs, ...pluginCatalogs(windowWide)], [windowWide]);
  const locales = useMemo(() => availableLocales(catalogs), [catalogs]);

  // Тема применяется записью CSS-переменных в корень документа: перерисовка не требует ре-рендера
  // дерева, поэтому переключение стоит одинаково на пустой странице и на полной (docs/ui-kit.md).
  useEffect(() => {
    applyAppearance({
      preferences,
      prefersDark,
      schemes,
      target: document.documentElement.style,
      root: document.documentElement,
      // Пока снимок плагинов не приехал, схемы плагина ещё нет ни в одном списке, и жалоба на её
      // отсутствие была бы ложной — на каждой загрузке страницы, у каждого, кто её выбрал.
      onDiagnostic: contributions === undefined ? () => {} : diagnostics.record,
    });
    cacheAppearance(localStorage, preferences);
  }, [preferences, prefersDark, diagnostics, schemes, contributions]);

  const config = useConfig({ bus, stream, onDiagnostic: diagnostics.record });
  const projects = useProjects({ bus, stream, onDiagnostic: diagnostics.record });
  const fileResources = useFileResources(
    page.kind === "settings-project" ? page.projectId : undefined,
    bus,
    stream,
    diagnostics.record,
  );
  const providers = useProviders({
    bus,
    stream,
    onDiagnostic: diagnostics.record,
    providerId: page.kind === "settings" ? page.providerId : undefined,
  });
  const [editingProvider, setEditingProvider] = useState<
    import("@sovereign/protocol").UserProviderDefinition | undefined
  >(undefined);
  const [providerFormFailure, setProviderFormFailure] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (page.kind !== "edit-provider") {
      setEditingProvider(undefined);
      setProviderFormFailure(undefined);
      return;
    }
    const controller = new AbortController();
    setEditingProvider(undefined);
    setProviderFormFailure(undefined);
    void fetchUserProvider(page.providerId, controller.signal)
      .then((details) => {
        if (controller.signal.aborted) return;
        setEditingProvider(details.definition);
        setProviderFormFailure(undefined);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setProviderFormFailure(cause instanceof Error ? cause.message : String(cause));
      });
    return () => controller.abort();
  }, [page]);
  const sessions = useSessions({
    bus,
    stream,
    onDiagnostic: diagnostics.record,
    ...(page.kind === "session" ? { sessionId: page.sessionId } : {}),
  });
  const archivedSessions = useSessions({
    bus,
    stream: page.kind === "session-archive" ? stream : "connecting",
    onDiagnostic: diagnostics.record,
    archived: true,
  });
  const usage = useUsage({
    enabled: page.kind === "settings" && page.section === "usage",
    bus,
    stream,
    onDiagnostic: diagnostics.record,
  });

  // Контекст места считается один раз на изменение: новый объект на каждой отрисовке перерисовывал
  // бы экземпляр плагина вместе с любым событием оболочки.
  //
  // У мест базовой поставки `project` стоит только там, где место и правда принадлежит проекту.
  // Оконным вью настроек его не дают намеренно: иначе плагин из папки открытого проекта заменил бы
  // общий для окна список — решение владельца продукта (docs/ui-extension-model.md).
  const chatContext = useMemo<PlaceContext>(
    () => ({
      ...(sessions.state.open?.summary === undefined
        ? {}
        : { project: sessions.state.open.summary.projectId }),
      ...(sessions.state.open === undefined
        ? {}
        : { subject: { sessionId: sessions.state.open.id } }),
    }),
    [sessions.state.open],
  );
  const newSessionContext = useMemo<PlaceContext>(
    () => (draftProjectId === undefined ? {} : { project: draftProjectId }),
    [draftProjectId],
  );
  // Боковая полоса и полоса действий шапки принадлежат окну целиком, и предмет у них один — та
  // страница, что сейчас открыта: вклад решает по ней, показываться ли ему. Открытая сессия —
  // часть этого предмета: вкладу правой панели незачем гадать, про какой разговор она сейчас.
  const pageContext = useMemo<PlaceContext>(
    () => ({
      subject: {
        page: page.kind,
        ...(page.kind === "session" ? { sessionId: page.sessionId } : {}),
      },
    }),
    [page],
  );
  const settingsContext = useMemo<PlaceContext>(() => ({}), []);
  const settingsProjectsContext = useMemo(
    () =>
      settingsSubject("projectId", page.kind === "settings-project" ? page.projectId : undefined),
    [page],
  );
  const settingsProvidersContext = useMemo(
    () => settingsSubject("providerId", page.kind === "settings" ? page.providerId : undefined),
    [page],
  );
  const settingsPluginsContext = useMemo(
    () =>
      settingsSubject("pluginKey", page.kind === "settings-plugin" ? page.pluginKey : undefined),
    [page],
  );

  // Обработчик кадра берётся у вью провайдеров, а соединение живёт своей жизнью: связывает их
  // ссылка, и переустановка её не трогает поток.
  useEffect(() => {
    loginStep.current = providers.receiveLoginStep;
  }, [providers.receiveLoginStep]);

  useEffect(() => {
    sessionDelta.current = sessions.receiveSessionDelta;
  }, [sessions.receiveSessionDelta]);

  const translator = useMemo(
    () =>
      createTranslator({
        locale: preferences.locale,
        namespace: coreNamespace,
        catalogs,
        onDiagnostic: diagnostics.record,
      }),
    [preferences.locale, catalogs, diagnostics],
  );

  const selectDraftProject = useCallback(
    (projectId: string): void => {
      setDraftProjectId(projectId === "" ? undefined : projectId);
      sessions.selectProject(projectId);
    },
    [sessions.selectProject],
  );
  const openNewSession = useCallback(
    (projectId?: string): void => {
      setDraftProjectId(projectId);
      setNewSessionResetKey((key) => key + 1);
      navigation.navigate({ kind: "new-session" });
    },
    [navigation],
  );

  // Переход внутри страницы плагина: путь уже приведён фасадом к виду «от базы страницы».
  const navigateInPluginPage = useCallback(
    (path: string, query: Readonly<Record<string, string>>, replace: boolean): void => {
      if (page.kind !== "plugin") {
        return;
      }

      navigation.navigate(
        { page: { ...page, rest: path.split("/").filter(Boolean).join("/") }, query },
        { replace },
      );
    },
    [navigation, page],
  );
  const leavePluginPage = useCallback(
    (destination: CoreDestination): void => {
      navigation.navigate(locationOfDestination(destination));
    },
    [navigation],
  );
  // Страница резолвится один раз: шапке нужен её заголовок, вью — сама страница, и два разбора
  // одного адреса разошлись бы при первой правке правил.
  const pluginPageState =
    page.kind === "plugin"
      ? resolvePluginPageState(plugins.state.snapshot, page.pluginId, page.pageId)
      : undefined;
  const openPluginPage =
    pluginPageState?.kind === "open" ? pluginPageState.registration : undefined;

  // Проект открытой сессии: и активный, и архивный — сессию открывают по прямому адресу, а проект к
  // этому времени мог уехать в архив, и остаться без имени в полосе шапки она не должна.
  const openSessionProjectId = sessions.state.open?.summary?.projectId;
  const openSessionProject =
    openSessionProjectId === undefined
      ? undefined
      : [
          ...(projects.state.snapshot?.projects ?? []),
          ...(projects.state.snapshot?.archived ?? []),
        ].find(({ id }) => id === openSessionProjectId);

  const pageHeader = describePage(page, translator, {
    session: sessions.state.open?.summary,
    project:
      page.kind === "settings-project"
        ? [
            ...(projects.state.snapshot?.projects ?? []),
            ...(projects.state.snapshot?.archived ?? []),
          ].find(({ id }) => id === page.projectId)
        : page.kind === "session"
          ? openSessionProject
          : undefined,
    provider:
      page.kind === "settings" || page.kind === "edit-provider"
        ? providers.state.snapshot?.providers.find(({ id }) => id === page.providerId)
        : undefined,
    plugin:
      page.kind === "settings-plugin"
        ? plugins.state.snapshot?.plugins.find(({ key }) => key === page.pluginKey)
        : undefined,
    pluginPage: openPluginPage,
  });

  // Номер последней отправленной записи внешнего вида. Два быстрых переключения рвут договор:
  // второе wins локально, но первый ответ резолвится первым и затирает второе решение ответом на
  // первое. Ответ применяется, только если он последний отправленный; протухший молча отбрасывается
  // — снимок вернётся следующим событием или перезапросом.
  const appearanceSeq = useRef(0);

  const change = (next: AppearancePreferences): void => {
    // Выбранное показывается сразу, не дожидаясь ответа: запись может отказать, и тогда придёт
    // причина, а состояние вернётся перезапросом.
    setPreferences(next);
    setRefusal(undefined);

    const seq = appearanceSeq.current + 1;
    appearanceSeq.current = seq;

    void writeAppearance(next)
      .then((confirmed) => {
        if (appearanceSeq.current !== seq) {
          return;
        }

        setPreferences(confirmed);
      })
      .catch((cause: unknown) => {
        if (appearanceSeq.current !== seq) {
          return;
        }

        setRefusal(cause instanceof Error ? cause.message : String(cause));
        reload.current();
      });
  };

  const submitPassword = (password: string): void => {
    setLoginBusy(true);
    setLoginRefusal(undefined);

    const submitted = access === "registration-required" ? register(password) : logIn(password);

    void submitted.then((outcome) => {
      setLoginBusy(false);

      if (outcome.kind === "authenticated") {
        setExpired(false);
        setAccess("authenticated");

        return;
      }

      // Отдельный исход, а не текст отказа: демон говорит, что учётной записи нет, и форма меняется
      // на регистрацию (docs/authentication.md).
      if (outcome.kind === "registration-required") {
        setAccess("registration-required");

        return;
      }

      setLoginRefusal(outcome.reason);
    });
  };

  if (access === "asking") {
    return (
      <main className="login">
        <Spinner label={translator.t("login.asking")} />
      </main>
    );
  }

  if (!authenticated) {
    return (
      <LoginView
        registering={access === "registration-required"}
        refusal={loginRefusal}
        expired={expired}
        busy={loginBusy}
        onSubmit={submitPassword}
        translator={translator}
      />
    );
  }

  return (
    <BrowserRuntimeProvider
      contributions={placeContributions}
      plugins={pluginStatuses}
      onDiagnostic={diagnostics.record}
      events={browserEventBridge.events}
      locale={preferences.locale}
    >
      <ShellWithPlaceTabs
        tabsContext={pageContext}
        layout={layout}
        onLayoutChange={setLayout}
        contentMode={page.kind === "session" ? "contained" : "page"}
        header={pageHeader}
        labels={{
          left: translator.t("panel.left"),
          right: translator.t("panel.right"),
          tabs: translator.t("panel.tabs"),
          emptyTabs: translator.t("panel.tabs.empty"),
          hideLeft: translator.t("panel.left.hide"),
          hideRight: translator.t("panel.right.hide"),
          showLeft: translator.t("panel.left.show"),
          showRight: translator.t("panel.right.show"),
          moreActions: translator.t("page.actions.more"),
        }}
        headerActions={
          <>
            {/* Палитра — значок, а не подпись: она принадлежит окну, а не странице, и в полосе
                маршрута соседствует с действиями страницы, у которых подпись есть по делу. */}
            <Button
              tone="quiet"
              size="sm"
              iconOnly
              aria-label={translator.t("commands.open.hint")}
              title={translator.t("commands.open.hint")}
              onClick={() => setCommandsOpen(true)}
            >
              <CommandsIcon size="sm" />
            </Button>
            <HostPlaceCollection id="core.view.header.actions" context={pageContext} />
          </>
        }
        navigation={
          <>
            <SidebarProjects
              projects={projects.state.snapshot?.projects}
              sessions={sessions.state.sessions}
              projectsLoading={
                projects.state.snapshot === undefined && projects.state.failure === undefined
              }
              projectsFailure={projects.state.failure}
              sessionsLoading={
                sessions.state.sessions === undefined && sessions.state.failure === undefined
              }
              sessionsFailure={sessions.state.failure}
              selectedSessionId={page.kind === "session" ? page.sessionId : undefined}
              storage={localStorage}
              onOpenSession={(sessionId) => navigation.navigate({ kind: "session", sessionId })}
              onNewSession={openNewSession}
              onUpdateProject={projects.update}
              onRemoveProject={projects.remove}
              onUpdateSession={sessions.updateSession}
              onRemoveSession={sessions.removeSession}
              translator={translator}
            />
            <HostPlaceCollection id="core.sidebar.sections" context={pageContext} />
          </>
        }
        navigationHeader={
          <div className="shell-nav-header">
            <BrandLockup name={translator.t("product.name")} />
            <Button onClick={() => openNewSession()}>+ {translator.t("sessions.new")}</Button>
          </div>
        }
        status={
          <AccountControl
            stream={stream}
            failure={failure}
            onOpenArchive={() => navigation.navigate({ kind: "session-archive" })}
            onOpenSettings={() => navigation.navigate({ kind: "settings", section: "appearance" })}
            onLogOut={() => {
              void logOut().then(() => {
                setExpired(false);
                setLoginRefusal(undefined);
                setAccess("unauthenticated");
              });
            }}
            translator={translator}
          />
        }
        rightUnavailable={rightUnavailable}
      >
        <PageView
          page={page}
          pluginPage={
            page.kind === "plugin" && pluginPageState !== undefined ? (
              <PluginPageView
                page={page}
                query={location.query}
                state={pluginPageState}
                onNavigate={navigateInPluginPage}
                onNavigateCore={leavePluginPage}
                translator={translator}
              />
            ) : null
          }
          session={
            <SessionRouteView
              sessionId={page.kind === "session" ? page.sessionId : ""}
              open={sessions.state.open}
              translator={translator}
            >
              {sessions.state.open === undefined ? null : (
                <HostPlace
                  id="core.session.chat"
                  context={chatContext}
                  builtIn={
                    <ChatView
                      open={sessions.state.open}
                      {...(openSessionProject === undefined ? {} : { project: openSessionProject })}
                      providers={sessions.state.providers}
                      models={sessions.state.models}
                      onPrepareModels={sessions.prepareModels}
                      onLoadModels={sessions.loadModels}
                      onSubmit={sessions.submitTurn}
                      onQueueMessage={sessions.queueMessage}
                      onSendMessage={sessions.sendMessage}
                      onResumeQueue={sessions.resumeQueue}
                      onSteerQueuedMessage={sessions.steerQueuedMessage}
                      onDropQueuedMessage={sessions.dropQueuedMessage}
                      onDiagnostic={diagnostics.record}
                      onInterrupt={sessions.interrupt}
                      onFork={async (request) => {
                        const outcome = await sessions.forkSession(request);
                        if (outcome.kind === "done") {
                          navigation.navigate({ kind: "session", sessionId: outcome.session.id });
                        }
                      }}
                      onCompact={sessions.compact}
                      onSetLabel={sessions.setEntryLabel}
                      onUpdateSession={(update) =>
                        sessions.updateSession(sessions.state.open?.id ?? "", update)
                      }
                      onNavigate={sessions.navigate}
                      translator={translator}
                    />
                  }
                />
              )}
            </SessionRouteView>
          }
          sessionArchive={
            <ArchiveSessionsView
              sessions={archivedSessions.state.sessions}
              projects={
                projects.state.snapshot === undefined
                  ? undefined
                  : [...projects.state.snapshot.projects, ...projects.state.snapshot.archived]
              }
              loaded={archivedSessions.state.sessions !== undefined}
              failure={archivedSessions.state.failure}
              onOpen={(sessionId) => navigation.navigate({ kind: "session", sessionId })}
              onRestore={async (session) => {
                return archivedSessions.updateSession(session.id, {
                  ...(session.title === undefined ? {} : { title: session.title }),
                  archived: false,
                });
              }}
              onRemove={async (sessionId) => {
                return archivedSessions.removeSession(sessionId);
              }}
              translator={translator}
            />
          }
          newSession={
            <HostPlace
              id="core.session.new"
              context={newSessionContext}
              builtIn={
                <NewSessionView
                  {...(draftProjectId === undefined ? {} : { initialProjectId: draftProjectId })}
                  key={newSessionResetKey}
                  {...(sessions.state.projects === undefined
                    ? {}
                    : { projects: sessions.state.projects })}
                  projectAgents={sessions.projectAgents}
                  {...(sessions.state.providers === undefined
                    ? {}
                    : { providers: sessions.state.providers })}
                  models={sessions.state.models}
                  onPrepareDraft={sessions.prepareDraft}
                  onSelectProject={selectDraftProject}
                  onPickProvider={sessions.loadModels}
                  onCreate={async (draft) => {
                    const outcome = await sessions.createSession(draft);

                    if (outcome.kind === "refused") {
                      return { reason: outcome.reason };
                    }

                    return { sessionId: outcome.session.id };
                  }}
                  onSubmit={sessions.submitTurnToSession}
                  onNavigate={(sessionId) => navigation.navigate({ kind: "session", sessionId })}
                  translator={translator}
                />
              }
            />
          }
          newProvider={
            <UserProviderForm
              mode="create"
              onBack={() => navigation.navigate({ kind: "settings", section: "providers" })}
              failure={providerFormFailure}
              onSubmit={async (definition) => {
                try {
                  await createUserProvider(definition);
                  setProviderFormFailure(undefined);
                  navigation.navigate({
                    kind: "settings",
                    section: "providers",
                    providerId: definition.id,
                  });
                } catch (cause) {
                  setProviderFormFailure(cause instanceof Error ? cause.message : String(cause));
                }
              }}
              translator={translator}
            />
          }
          editProvider={
            <UserProviderForm
              mode="edit"
              initial={editingProvider}
              loading={
                page.kind === "edit-provider" &&
                editingProvider === undefined &&
                providerFormFailure === undefined
              }
              failure={providerFormFailure}
              onBack={() =>
                navigation.navigate({
                  kind: "settings",
                  section: "providers",
                  providerId: page.kind === "edit-provider" ? page.providerId : undefined,
                })
              }
              onSubmit={async (definition) => {
                try {
                  await updateUserProvider(definition.id, definition);
                  setProviderFormFailure(undefined);
                  navigation.navigate({
                    kind: "settings",
                    section: "providers",
                    providerId: definition.id,
                  });
                } catch (cause) {
                  setProviderFormFailure(cause instanceof Error ? cause.message : String(cause));
                }
              }}
              translator={translator}
            />
          }
          settings={
            <SettingsView
              section={
                page.kind === "settings-plugin"
                  ? "plugins"
                  : page.kind === "settings-project"
                    ? "projects"
                    : page.kind === "settings"
                      ? page.section
                      : "appearance"
              }
              detailTitle={
                page.kind === "settings-plugin"
                  ? plugins.state.snapshot?.plugins.find((plugin) => plugin.key === page.pluginKey)
                      ?.id
                  : page.kind === "settings-project"
                    ? projects.state.snapshot === undefined
                      ? undefined
                      : [
                          ...projects.state.snapshot.projects,
                          ...projects.state.snapshot.archived,
                        ].find(({ id }) => id === page.projectId)?.name
                    : undefined
              }
              onSectionChange={(section) => navigation.navigate({ kind: "settings", section })}
              projects={
                <HostPlace
                  id="core.settings.projects"
                  context={settingsProjectsContext}
                  builtIn={
                    <>
                      {page.kind === "settings-project" ? (
                        <ProjectDetailView
                          project={
                            projects.state.snapshot === undefined
                              ? undefined
                              : [
                                  ...projects.state.snapshot.projects,
                                  ...projects.state.snapshot.archived,
                                ].find(({ id }) => id === page.projectId)
                          }
                          loaded={projects.state.snapshot !== undefined}
                          headingLevel={2}
                          failure={projects.state.failure}
                          fileResources={
                            <FileResourcesPanel state={fileResources} translator={translator} />
                          }
                          onBack={() =>
                            navigation.navigate({ kind: "settings", section: "projects" })
                          }
                          onNewSession={() => openNewSession(page.projectId)}
                          translator={translator}
                        />
                      ) : (
                        <ProjectsView
                          headingLevel={2}
                          state={projects.state}
                          onCreate={projects.create}
                          onUpdate={projects.update}
                          onRemove={projects.remove}
                          onDismissComplaints={projects.dismissComplaints}
                          onOpen={(projectId) =>
                            navigation.navigate({ kind: "settings-project", projectId })
                          }
                          translator={translator}
                        />
                      )}
                    </>
                  }
                />
              }
              appearance={
                <HostPlace
                  id="core.settings.appearance"
                  context={settingsContext}
                  builtIn={
                    <AppearanceSection
                      preferences={preferences}
                      effectiveScheme={effectiveScheme}
                      schemes={describeSchemes(schemes, windowWide, translator)}
                      locales={locales}
                      onChange={change}
                      refusal={refusal}
                      translator={translator}
                    />
                  }
                />
              }
              usage={
                <HostPlace
                  id="core.settings.usage"
                  context={settingsContext}
                  builtIn={<UsageView state={usage} translator={translator} />}
                />
              }
              providers={
                <HostPlace
                  id="core.settings.providers"
                  context={settingsProvidersContext}
                  builtIn={
                    <ProvidersView
                      headingLevel={2}
                      state={providers.state}
                      providerId={page.kind === "settings" ? page.providerId : undefined}
                      onOpen={(providerId) =>
                        navigation.navigate({ kind: "settings", section: "providers", providerId })
                      }
                      onCreate={() => navigation.navigate({ kind: "new-provider" })}
                      onEdit={(providerId) =>
                        navigation.navigate({ kind: "edit-provider", providerId })
                      }
                      onDelete={async (providerId) => {
                        try {
                          await deleteUserProvider(providerId);
                          setProviderFormFailure(undefined);
                          navigation.navigate({ kind: "settings", section: "providers" });
                        } catch (cause) {
                          setProviderFormFailure(
                            cause instanceof Error ? cause.message : String(cause),
                          );
                          throw cause;
                        }
                      }}
                      onRefresh={async (providerId) => {
                        try {
                          await refreshUserProvider(providerId);
                          setProviderFormFailure(undefined);
                        } catch (cause) {
                          setProviderFormFailure(
                            cause instanceof Error ? cause.message : String(cause),
                          );
                          throw cause;
                        }
                      }}
                      actionFailure={providerFormFailure}
                      onBack={() => navigation.navigate({ kind: "settings", section: "providers" })}
                      onLogIn={providers.logIn}
                      onAnswer={providers.answer}
                      onCancelLogin={providers.cancelLogin}
                      onCloseLogin={providers.closeLogin}
                      onLogOut={providers.logOut}
                      onRenameKey={providers.renameKey}
                      onSelectKey={providers.selectKey}
                      onRemoveKey={providers.removeKey}
                      onSaveAlias={providers.saveAlias}
                      onRemoveAlias={providers.removeAlias}
                      translator={translator}
                    />
                  }
                />
              }
              plugins={
                <HostPlace
                  id="core.settings.plugins"
                  context={settingsPluginsContext}
                  builtIn={
                    <>
                      {page.kind === "settings-plugin" ? (
                        <PluginDetailView
                          headingLevel={2}
                          state={plugins.state}
                          pluginKey={page.pluginKey}
                          onBack={() =>
                            navigation.navigate({ kind: "settings", section: "plugins" })
                          }
                          onSwitch={plugins.switchPlugin}
                          onOpenPage={(pluginId, pageId) =>
                            navigation.navigate(
                              locationOfDestination({ kind: "plugin-page", pluginId, pageId }),
                            )
                          }
                          translator={translator}
                        />
                      ) : (
                        <PluginsView
                          headingLevel={2}
                          state={plugins.state}
                          onSwitch={plugins.switchPlugin}
                          onOpen={(pluginKey) =>
                            navigation.navigate({ kind: "settings-plugin", pluginKey })
                          }
                          translator={translator}
                        />
                      )}
                    </>
                  }
                />
              }
              daemon={
                <HostPlace
                  id="core.settings.daemon"
                  context={settingsContext}
                  builtIn={
                    <DaemonSection
                      stream={stream}
                      health={health}
                      failure={failure}
                      locale={preferences.locale}
                      config={config.state}
                      onChangeConfig={config.update}
                      translator={translator}
                    />
                  }
                />
              }
              diagnostics={
                <HostPlace
                  id="core.settings.diagnostics"
                  context={settingsContext}
                  builtIn={<DiagnosticsSection diagnostics={reported} translator={translator} />}
                />
              }
              translator={translator}
            />
          }
          translator={translator}
        />
        <CommandPalette
          open={commandsOpen}
          onClose={() => setCommandsOpen(false)}
          host={{
            navigate: navigation.navigate,
            layout,
            onLayoutChange: setLayout,
            rightUnavailable,
          }}
          context={pageContext}
          translator={translator}
        />
      </ShellWithPlaceTabs>
    </BrowserRuntimeProvider>
  );
}

/**
 * Оболочка, у которой вкладки правой панели приезжают из места `core.panel.tabs`. Отдельный
 * компонент нужен потому, что набор берётся хуком, а хук читает контекст браузерного рантайма —
 * тот самый провайдер, внутри которого оболочка и стоит.
 */
function ShellWithPlaceTabs({
  tabsContext,
  ...shell
}: Omit<ShellProps, "tabs"> & { tabsContext: PlaceContext }) {
  return (
    <Shell {...shell} tabs={useHostPlaceTabs({ id: "core.panel.tabs", context: tabsContext })} />
  );
}
