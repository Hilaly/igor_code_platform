// @vitest-environment jsdom

import type { PluginOwnedPageRegistration, PluginStatus } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BrowserRuntimeProvider } from "./place-host.tsx";
import { PluginPageView } from "./plugin-page-view.tsx";
import type { PluginPageState } from "./plugin-page.ts";

afterEach(cleanup);

const translator = createTranslator({
  locale: "en",
  namespace: coreNamespace,
  catalogs: [coreEnglish],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const placed: PluginStatus = {
  key: "data:placed",
  id: "placed",
  source: "data",
  directory: "/plugins/placed",
  state: "running",
  browser: { revision: "r1", entry: "/assets/placed-r1.js" },
};

const registration: PluginOwnedPageRegistration = {
  ownership: "plugin",
  pluginKey: placed.key,
  pluginId: "placed",
  source: "data",
  kind: "page",
  id: "placed.log",
  declaredId: "log",
  title: "Log",
  export: "LogPage",
};

function view(state: PluginPageState, onNavigateCore = vi.fn()) {
  render(
    <BrowserRuntimeProvider
      contributions={[registration]}
      plugins={[placed]}
      onDiagnostic={() => {}}
      events={{ subscribe: () => () => {} }}
    >
      <PluginPageView
        page={{ kind: "plugin", pluginId: "placed", pageId: "log", rest: "" }}
        query={{}}
        state={state}
        onNavigate={() => {}}
        onNavigateCore={onNavigateCore}
        translator={translator}
      />
    </BrowserRuntimeProvider>,
  );

  return onNavigateCore;
}

describe("PluginPageView", () => {
  /**
   * Выключенный плагин обязан оставить адрес живым: общий «не найдено» здесь запрещён моделью,
   * потому что включение возвращает страницу на тот же URL.
   */
  it("offers a way back instead of a bare not-found when the page is switched off", () => {
    const onNavigateCore = view({ kind: "switched-off" });

    expect(screen.getByText("This page is switched off")).toBeTruthy();
    fireEvent.click(screen.getByText("Go to the shell"));

    expect(onNavigateCore).toHaveBeenCalledWith({ kind: "home" });
  });

  it("waits while the plugin is getting ready, and offers no way back from waiting", () => {
    view({ kind: "waiting" });

    expect(screen.getByText("The plugin is getting ready")).toBeTruthy();
    expect(screen.queryByText("Go to the shell")).toBeNull();
  });

  it("names the reason a plugin did not start", () => {
    view({ kind: "failed", reason: "the bundle does not build" });

    expect(screen.getByText("the bundle does not build")).toBeTruthy();
  });

  it("says which address nobody declares", () => {
    view({ kind: "missing" });

    expect(screen.getByText("No plugin declares the page placed/log.")).toBeTruthy();
  });

  /** Страница объявлена, но её бандл ещё грузится: на её месте стоит ожидание, а не отказ. */
  it("waits on the page itself while its bundle is loading", () => {
    view({ kind: "open", registration, status: placed });

    expect(screen.getByText("The plugin is getting ready")).toBeTruthy();
  });
});
