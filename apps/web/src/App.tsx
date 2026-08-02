/**
 * Сборка интерфейса: поток, шина, настройки внешнего вида, перевод, маршрутизация и оболочка. Всё
 * долгоживущее создаётся здесь по одному экземпляру — соединение с демоном одно на вкладку
 * (docs/web-api.md), и владелец у него один.
 */

import {
  coreEventTypes,
  healthPath,
  isPluginStreamEvent,
  streamGapType,
  type AppearancePreferences,
  type AuthenticationState,
  type Health,
  type LoginStepFrame,
  type SessionDeltaFrame,
} from "@sovereign/protocol";
import {
  coreEnglish,
  coreNamespace,
  coreRussian,
  createTranslator,
  Heading,
  List,
  ListRow,
  Menu,
  Spinner,
  Text,
} from "@sovereign/ui-kit";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  applyAppearance,
  cacheAppearance,
  defaultAppearancePreferences,
  fetchAppearance,
  readCachedAppearance,
  shippedSchemes,
  writeAppearance,
} from "./appearance.ts";
import { createDiagnosticsStore, type Diagnostic } from "./diagnostics.ts";
import { createFrontendBus } from "./events/bus.ts";
import { connectEventStream, type StreamStatus } from "./events/stream.ts";
import { LoginView } from "./login/login-view.tsx";
import { PluginsView } from "./plugins/plugins-view.tsx";
import { usePlugins } from "./plugins/use-plugins.ts";
import { ProjectsView } from "./projects/projects-view.tsx";
import { useProjects } from "./projects/use-projects.ts";
import { ProvidersView } from "./providers/providers-view.tsx";
import { useProviders } from "./providers/use-providers.ts";
import { NewSessionView } from "./sessions/new-session-view.tsx";
import { SessionsView } from "./sessions/sessions-view.tsx";
import { useSessions } from "./sessions/use-sessions.ts";
import { createNavigation, type Page } from "./router.ts";
import { logIn, logOut, probeSession, register } from "./session.ts";
import { AppearanceSection } from "./settings/appearance-section.tsx";
import { DaemonSection } from "./settings/daemon-section.tsx";
import { DiagnosticsSection } from "./settings/diagnostics-section.tsx";
import { SettingsView } from "./settings/settings-view.tsx";
import { DaemonStatus } from "./shell/daemon-status.tsx";
import { readLayout, writeLayout, type ShellLayout } from "./shell/layout.ts";
import { PageView } from "./shell/page.tsx";
import { Shell } from "./shell/shell.tsx";

const catalogs = [coreEnglish, coreRussian];
const shippedLocales = catalogs.map((catalog) => catalog.locale);

/** Пока состояние входа не спрошено, показывать нечего: и оболочка, и форма были бы догадкой. */
type Access = AuthenticationState | "asking";

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
  const [page, setPage] = useState<Page>(() => navigation.current());
  const [layout, setLayout] = useState<ShellLayout>(() => readLayout(localStorage));
  const [access, setAccess] = useState<Access>("asking");
  const [loginRefusal, setLoginRefusal] = useState<string | undefined>(undefined);
  const [loginBusy, setLoginBusy] = useState(false);
  const [expired, setExpired] = useState(false);

  const authenticated = access === "authenticated";

  useEffect(() => diagnostics.subscribe(setReported), [diagnostics]);
  useEffect(() => navigation.subscribe(setPage), [navigation]);

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

  // Тема применяется записью CSS-переменных в корень документа: перерисовка не требует ре-рендера
  // дерева, поэтому переключение стоит одинаково на пустой странице и на полной (docs/ui-kit.md).
  useEffect(() => {
    applyAppearance({
      preferences,
      prefersDark,
      target: document.documentElement.style,
      root: document.documentElement,
      onDiagnostic: diagnostics.record,
    });
    cacheAppearance(localStorage, preferences);
  }, [preferences, prefersDark, diagnostics]);

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
      onStatus: setStream,
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
  }, [bus, diagnostics, authenticated]);

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
  const projects = useProjects({ bus, stream, onDiagnostic: diagnostics.record });
  const providers = useProviders({
    bus,
    stream,
    onDiagnostic: diagnostics.record,
    providerId: page.kind === "providers" ? page.providerId : undefined,
  });
  const sessions = useSessions({
    bus,
    stream,
    onDiagnostic: diagnostics.record,
    ...(page.kind === "sessions" && page.sessionId !== undefined
      ? { sessionId: page.sessionId }
      : {}),
  });

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
    [preferences.locale, diagnostics],
  );

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
    <Shell
      layout={layout}
      onLayoutChange={setLayout}
      labels={{
        left: translator.t("panel.left"),
        right: translator.t("panel.right"),
        emptyTabs: translator.t("panel.tabs.empty"),
        hideLeft: translator.t("panel.left.hide"),
        hideRight: translator.t("panel.right.hide"),
        showLeft: translator.t("panel.left.show"),
        showRight: translator.t("panel.right.show"),
      }}
      navigation={
        <div className="shell-nav">
          <Heading level={3}>{translator.t("nav.title")}</Heading>
          <List>
            <ListRow
              selected={page.kind === "home"}
              onSelect={() => navigation.navigate({ kind: "home" })}
            >
              <Text>{translator.t("nav.home")}</Text>
            </ListRow>
            <ListRow
              selected={page.kind === "projects"}
              onSelect={() => navigation.navigate({ kind: "projects" })}
            >
              <Text>{translator.t("nav.projects")}</Text>
            </ListRow>
            <ListRow
              selected={page.kind === "providers"}
              onSelect={() => navigation.navigate({ kind: "providers" })}
            >
              <Text>{translator.t("nav.providers")}</Text>
            </ListRow>
            <ListRow
              selected={page.kind === "sessions"}
              onSelect={() => navigation.navigate({ kind: "sessions" })}
            >
              <Text>{translator.t("nav.sessions")}</Text>
            </ListRow>
            <ListRow
              selected={page.kind === "plugins"}
              onSelect={() => navigation.navigate({ kind: "plugins" })}
            >
              <Text>{translator.t("nav.plugins")}</Text>
            </ListRow>
          </List>
        </div>
      }
      status={
        <div className="shell-status">
          <DaemonStatus stream={stream} health={health} failure={failure} translator={translator} />
          <Menu
            label={translator.t("account.menu")}
            trigger={translator.t("account.menu")}
            placement="above"
            block
            items={[
              {
                id: "settings",
                label: translator.t("settings.title"),
                onSelect: () => navigation.navigate({ kind: "settings" }),
              },
              {
                id: "log-out",
                label: translator.t("logout"),
                tone: "danger",
                onSelect: () => {
                  // Выход закрывает серверную запись сессии, поэтому обрывает и живой поток
                  // (docs/authentication.md); вкладка возвращается к форме, не дожидаясь этого.
                  void logOut().then(() => {
                    setExpired(false);
                    setLoginRefusal(undefined);
                    setAccess("unauthenticated");
                  });
                },
              },
            ]}
          />
        </div>
      }
      tabs={[]}
    >
      <PageView
        page={page}
        plugins={
          <PluginsView
            state={plugins.state}
            onSwitch={plugins.switchPlugin}
            translator={translator}
          />
        }
        projects={
          <ProjectsView
            state={projects.state}
            onCreate={projects.create}
            onUpdate={projects.update}
            onRemove={projects.remove}
            onDismissComplaints={projects.dismissComplaints}
            translator={translator}
          />
        }
        providers={
          <ProvidersView
            state={providers.state}
            providerId={page.kind === "providers" ? page.providerId : undefined}
            onOpen={(providerId) => navigation.navigate({ kind: "providers", providerId })}
            onBack={() => navigation.navigate({ kind: "providers" })}
            onLogIn={providers.logIn}
            onAnswer={providers.answer}
            onCancelLogin={providers.cancelLogin}
            onCloseLogin={providers.closeLogin}
            onLogOut={providers.logOut}
            translator={translator}
          />
        }
        sessions={
          <SessionsView
            state={sessions.state}
            onOpen={(sessionId) => navigation.navigate({ kind: "sessions", sessionId })}
            onStartCreating={() => navigation.navigate({ kind: "new-session" })}
            onSubmit={sessions.submitTurn}
            onSendMessage={sessions.sendMessage}
            onInterrupt={sessions.interrupt}
            onUpdate={sessions.updateSession}
            onRemove={async (sessionId) => {
              const reason = await sessions.removeSession(sessionId);

              // Удалённая сессия остаётся в адресе, и вью показало бы «сессия пропала». Уводим на
              // список сам, а не ждём, пока человек догадается уйти.
              if (reason === undefined && sessions.state.open?.id === sessionId) {
                navigation.navigate({ kind: "sessions" });
              }

              return reason;
            }}
            onFork={async (request) => {
              const outcome = await sessions.forkSession(request);

              if (outcome.kind === "done") {
                navigation.navigate({ kind: "sessions", sessionId: outcome.session.id });
              }
            }}
            onCompact={sessions.compact}
            onSetLabel={sessions.setEntryLabel}
            onNavigate={sessions.navigate}
            onShowArchived={sessions.setShowArchived}
            translator={translator}
          />
        }
        newSession={
          <NewSessionView
            {...(sessions.state.projects === undefined
              ? {}
              : { projects: sessions.state.projects })}
            {...(sessions.state.agents === undefined ? {} : { agents: sessions.state.agents })}
            {...(sessions.state.providers === undefined
              ? {}
              : { providers: sessions.state.providers })}
            models={sessions.state.models}
            onPrepareDraft={sessions.prepareDraft}
            onPickProvider={sessions.loadModels}
            onCreate={async (draft) => {
              const outcome = await sessions.createSession(draft);

              if (outcome.kind === "refused") {
                return { reason: outcome.reason };
              }

              return { sessionId: outcome.session.id };
            }}
            onSubmit={sessions.submitTurn}
            onNavigate={(sessionId) => navigation.navigate({ kind: "sessions", sessionId })}
            translator={translator}
          />
        }
        settings={
          <SettingsView
            section={page.kind === "settings" ? page.section : undefined}
            onSectionChange={(section) => navigation.navigate({ kind: "settings", section })}
            appearance={
              <AppearanceSection
                preferences={preferences}
                schemes={shippedSchemes}
                locales={shippedLocales}
                onChange={change}
                refusal={refusal}
                translator={translator}
              />
            }
            daemon={
              <DaemonSection
                stream={stream}
                health={health}
                failure={failure}
                locale={preferences.locale}
                translator={translator}
              />
            }
            diagnostics={<DiagnosticsSection diagnostics={reported} translator={translator} />}
            translator={translator}
          />
        }
        translator={translator}
      />
    </Shell>
  );
}
