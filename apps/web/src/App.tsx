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
  type Health,
} from "@sovereign/protocol";
import {
  coreEnglish,
  coreNamespace,
  coreRussian,
  createTranslator,
  Heading,
  List,
  ListRow,
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
import { PluginsView } from "./plugins/plugins-view.tsx";
import { usePlugins } from "./plugins/use-plugins.ts";
import { createNavigation, type Page } from "./router.ts";
import { AppearancePanel } from "./shell/appearance-panel.tsx";
import { DaemonStatus } from "./shell/daemon-status.tsx";
import { DiagnosticsPanel } from "./shell/diagnostics-panel.tsx";
import { readLayout, writeLayout, type ShellLayout } from "./shell/layout.ts";
import { PageView } from "./shell/page.tsx";
import { Shell } from "./shell/shell.tsx";

const catalogs = [coreEnglish, coreRussian];
const shippedLocales = catalogs.map((catalog) => catalog.locale);

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

  useEffect(() => diagnostics.subscribe(setReported), [diagnostics]);
  useEffect(() => navigation.subscribe(setPage), [navigation]);

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

  useEffect(() => {
    reload.current();

    const connection = connectEventStream({
      bus,
      onStatus: setStream,
      onDiagnostic: diagnostics.record,
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
    };
  }, [bus, diagnostics]);

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

  return (
    <Shell
      layout={layout}
      onLayoutChange={setLayout}
      labels={{ left: translator.t("panel.left"), right: translator.t("panel.right") }}
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
              selected={page.kind === "plugins"}
              onSelect={() => navigation.navigate({ kind: "plugins" })}
            >
              <Text>{translator.t("nav.plugins")}</Text>
            </ListRow>
          </List>
        </div>
      }
      status={
        <DaemonStatus stream={stream} health={health} failure={failure} translator={translator} />
      }
      tabs={[
        {
          id: "appearance",
          label: translator.t("appearance.variant"),
          content: (
            <AppearancePanel
              preferences={preferences}
              schemes={shippedSchemes}
              locales={shippedLocales}
              onChange={change}
              refusal={refusal}
              translator={translator}
            />
          ),
        },
        {
          id: "diagnostics",
          label: translator.t("diagnostics.title"),
          content: <DiagnosticsPanel diagnostics={reported} translator={translator} />,
        },
      ]}
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
        translator={translator}
      />
    </Shell>
  );
}
