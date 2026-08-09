// @vitest-environment jsdom

import type { ContributionRegistration, PluginsSnapshot } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PluginDetailView } from "./plugin-detail-view.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "en",
  namespace: coreNamespace,
  catalogs: [coreEnglish],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

const snapshot: PluginsSnapshot = {
  revision: 1,
  plugins: [
    {
      key: "data:example",
      id: "example",
      source: "data",
      directory: "/plugins/example",
      state: "running",
      attempt: 1,
      contributionProblems: ["bad contribution"],
    },
  ],
  contributions: [
    {
      kind: "event",
      ownership: "plugin",
      pluginKey: "data:example",
      pluginId: "example",
      source: "data",
      id: "example.event",
      declaredId: "event",
      title: "Example event",
      payloadSchema: { type: "object" },
    },
  ],
  switchedOffContributions: [
    {
      kind: "skill",
      ownership: "plugin",
      pluginKey: "data:example",
      pluginId: "example",
      source: "data",
      id: "example.skill",
      declaredId: "skill",
      title: "Example skill",
      name: "skill",
      location: "/plugins/example/skill",
      disableModelInvocation: false,
    },
  ],
  conflicts: [],
  routeConflicts: [],
  enablement: { "data:example": { enabled: true, disabledContributions: ["missing.id"] } },
};

it("shows plugin facts, controls each contribution, and exposes technical data", () => {
  const onSwitch = vi.fn();
  const onBack = vi.fn();
  const onOpenPage = vi.fn();
  const { container } = render(
    <PluginDetailView
      state={{ snapshot, stale: false }}
      pluginKey="data:example"
      onBack={onBack}
      onSwitch={onSwitch}
      onOpenPage={onOpenPage}
      translator={translator}
    />,
  );

  expect(screen.getByText("example")).toBeTruthy();
  expect(screen.getByText("Running")).toBeTruthy();
  expect(screen.getByText("/plugins/example")).toBeTruthy();
  expect(screen.getByText("bad contribution")).toBeTruthy();
  expect(screen.getByText("missing.id")).toBeTruthy();
  expect(screen.getByRole("group", { name: "example" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Lifecycle" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Source" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Path" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Example event" })).toBeTruthy();
  expect(screen.getByRole("group", { name: "Example skill" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "example" })).toBeTruthy();
  expect(screen.getByRole("region", { name: "Plugin" })).toBeTruthy();
  const contributions = screen.getByRole("region", { name: "Contributions · 2" });
  expect(within(contributions).getAllByRole("listitem")).toHaveLength(2);
  expect(container.querySelector(".plugin-detail-surface")).toBeNull();
  for (const [name, checked] of [
    ["Switched on", true],
    ["Example event", true],
    ["Example skill", false],
  ] as const) {
    const toggle = screen.getByRole("checkbox", { name });
    expect(toggle).toHaveProperty("checked", checked);
    expect(screen.getByRole("tooltip", { name })).toBeTruthy();
    expect(toggle.closest("label")?.querySelector('[class*="visuallyHidden"]')?.textContent).toBe(
      name,
    );
  }

  fireEvent.click(screen.getByRole("checkbox", { name: "Example event" }));
  expect(onSwitch).toHaveBeenCalledWith("data:example", {
    enabled: true,
    disabledContributions: ["missing.id", "example.event"],
  });
  fireEvent.click(screen.getByText("Payload schema"));
  expect(screen.getByText(/"type": "object"/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Back to plugins" }));
  expect(onBack).toHaveBeenCalled();
});

it("does not add a nested page heading when embedded under Settings", () => {
  render(
    <PluginDetailView
      headingLevel={2}
      state={{ snapshot, stale: false }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.queryByRole("heading", { name: "example" })).toBeNull();
});

it("shows a not-found state for an unknown plugin key", () => {
  render(
    <PluginDetailView
      state={{ snapshot, stale: false }}
      pluginKey="data:nope"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );
  expect(screen.getByText(/not found/i)).toBeTruthy();
});

it("does not claim a stale missing plugin is authoritatively absent", () => {
  render(
    <PluginDetailView
      state={{ snapshot: { ...snapshot, plugins: [] }, stale: true }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByRole("button", { name: "Back to plugins" })).toBeTruthy();
  expect(screen.getByText("What you see may be out of date")).toBeTruthy();
  expect(screen.getByText(/state is being requested again/i)).toBeTruthy();
  expect(screen.getByText("Loading…")).toBeTruthy();
  expect(screen.queryByText(/plugin not found/i)).toBeNull();
});

it("keeps a failed missing plugin non-authoritative until a later snapshot recovers", () => {
  const { rerender } = render(
    <PluginDetailView
      state={{ snapshot: { ...snapshot, plugins: [] }, stale: false, failure: "snapshot failed" }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByRole("button", { name: "Back to plugins" })).toBeTruthy();
  expect(screen.getByText("The plugins could not be read: snapshot failed")).toBeTruthy();
  expect(screen.queryByText(/plugin not found/i)).toBeNull();

  rerender(
    <PluginDetailView
      state={{ snapshot, stale: false }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByRole("region", { name: "example" })).toBeTruthy();
  expect(screen.queryByText("The plugins could not be read: snapshot failed")).toBeNull();
});

it("keeps stale and write-failure notices visible on the detail route", () => {
  render(
    <PluginDetailView
      state={{ snapshot, stale: true, failure: "write failed" }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("What you see may be out of date")).toBeTruthy();
  expect(screen.getByText(/state is being requested again/i)).toBeTruthy();
  expect(screen.getByText("The choice was not written: write failed")).toBeTruthy();
});

it("shows a stale warning while the first detail snapshot is still loading", () => {
  render(
    <PluginDetailView
      state={{ stale: true }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("What you see may be out of date")).toBeTruthy();
  expect(screen.getByText(/state is being requested again/i)).toBeTruthy();
  expect(screen.getByText("Loading…")).toBeTruthy();
});

it("names the kind of a public route and shows the address it answers at", () => {
  const withRoute: PluginsSnapshot = {
    ...snapshot,
    contributions: [
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.github-webhook",
        declaredId: "github-webhook",
        title: "GitHub webhook",
        method: "POST",
        path: "webhooks/github",
      },
    ],
    switchedOffContributions: [],
  };

  render(
    <PluginDetailView
      state={{ snapshot: withRoute, stale: false }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("public route")).toBeTruthy();
  expect(screen.getByText(/"path": "webhooks\/github"/)).toBeTruthy();
  // Адрес целиком: по нему маршрут зовут снаружи, а объявленный путь без префикса не набрать.
  expect(screen.getByText(/\/p\/example\/webhooks\/github/)).toBeTruthy();
});

/** Объявленное имя берётся из последнего сегмента места: у плагина вклад на каждое место свой. */
const component = (
  pluginId: string,
  placeId: string,
  source: "builtin" | "data" = "data",
): ContributionRegistration => {
  const declaredId = placeId.split(".").at(-1) ?? "panel";

  return {
    kind: "component",
    ownership: "plugin",
    pluginKey: `${source}:${pluginId}`,
    pluginId,
    source,
    id: `${pluginId}.${declaredId}`,
    declaredId,
    title: `${pluginId} ${declaredId}`,
    placeId,
    export: "Panel",
  };
};

const withPlaces = (contributions: ContributionRegistration[]): PluginsSnapshot => ({
  ...snapshot,
  contributions,
  switchedOffContributions: [],
});

const place = (
  pluginId: string,
  placeId: string,
  cardinality: "single" | "collection" | "action" = "single",
): ContributionRegistration => ({
  kind: "place",
  ownership: "plugin",
  pluginKey: `data:${pluginId}`,
  pluginId,
  source: "data",
  id: placeId,
  declaredId: placeId.split(".").at(-1) ?? "place",
  title: `${pluginId} ${placeId}`,
  cardinality,
  replaceable: cardinality === "single",
  ...(cardinality === "single" ? { builtIn: "Panel" } : {}),
});

const showPlaces = (next: PluginsSnapshot): void => {
  render(
    <PluginDetailView
      state={{ snapshot: next, stale: false }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );
};

it("labels a switched-off core component claim as switched off", () => {
  const off = component("example", "core.settings.plugins");
  showPlaces({ ...withPlaces([]), switchedOffContributions: [off] });

  const claim = screen.getByRole("group", { name: "core.settings.plugins" });
  expect(within(claim).getByText("switched off")).toBeTruthy();
  expect(
    within(claim).queryByText("the place is free: the contribution is switched off"),
  ).toBeNull();
});

it("uses a switched-off plugin-owned place declaration for collection cardinality", () => {
  const active = component("example", "placed.board");
  const offPlace = place("placed", "placed.board", "collection");
  showPlaces({ ...withPlaces([active]), switchedOffContributions: [offPlace] });

  const claim = screen.getByRole("group", { name: "placed.board" });
  expect(within(claim).getByText("joins the row")).toBeTruthy();
  expect(within(claim).queryByText(/nobody has declared that place yet/)).toBeNull();
});

it("labels a switched-off collection component as switched off", () => {
  const off = {
    ...component("example", "example.board"),
    id: "example.card",
    declaredId: "card",
    title: "example card",
  };
  const activePlace = place("example", "example.board", "collection");
  showPlaces({ ...withPlaces([activePlace]), switchedOffContributions: [off] });

  const claim = screen.getByRole("group", { name: "example.board" });
  expect(within(claim).getByText("switched off")).toBeTruthy();
  expect(within(claim).queryByText("joins the row")).toBeNull();
});

/**
 * Замена вью — самое заметное, что плагин делает с интерфейсом, и человеку нужен ответ не только
 * «вклад объявлен», но и «применён ли он и почему нет».
 */
it("says which places the plugin holds and why a claim did not apply", () => {
  render(
    <PluginDetailView
      state={{
        snapshot: withPlaces([
          component("example", "core.settings.plugins"),
          component("example", "core.sidebar.sections"),
          component("example", "plugin.somebody.panel"),
        ]),
        stale: false,
      }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByRole("group", { name: "core.settings.plugins" })).toBeTruthy();
  expect(screen.getByText("provides the place")).toBeTruthy();
  expect(screen.getByText("joins the row")).toBeTruthy();
  expect(screen.getByText(/nobody has declared that place yet/)).toBeTruthy();
});

/** Источник ближе к человеку побеждает: вклад базовой поставки уступает вкладу из папки данных. */
it("names the plugin that took the place instead", () => {
  render(
    <PluginDetailView
      state={{
        snapshot: {
          ...withPlaces([
            component("example", "core.settings.plugins", "builtin"),
            component("stronger", "core.settings.plugins", "data"),
          ]),
          plugins: [
            {
              key: "builtin:example",
              id: "example",
              source: "builtin",
              directory: "/builtin/example",
              state: "running",
            },
          ],
        },
        stale: false,
      }}
      pluginKey="builtin:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText(/the place is taken by stronger.plugins/)).toBeTruthy();
});

const runCommand: ContributionRegistration = {
  kind: "command",
  ownership: "plugin",
  pluginKey: "data:example",
  pluginId: "example",
  source: "data",
  id: "example.run",
  declaredId: "run",
  title: "Run the board",
  export: "RunCommand",
  placeId: "core.view.header.actions",
};

it("shows a command by its kind and by its technical data", () => {
  showPlaces(withPlaces([runCommand]));

  expect(screen.getByText("command")).toBeTruthy();
  expect(screen.getByText(/"export": "RunCommand"/)).toBeTruthy();
  expect(screen.getByText(/"placeId": "core.view.header.actions"/)).toBeTruthy();
});

/** Команда одиночное место занять не может: в полосу действий она встаёт в ряд с компонентами. */
it("reports the placement of a command as joining the row", () => {
  showPlaces(withPlaces([runCommand]));

  const claim = screen.getByRole("group", { name: "core.view.header.actions" });

  expect(within(claim).getByText("joins the row")).toBeTruthy();
});

it("reports a command assigned to a known non-action place as incompatible", () => {
  const misplaced: ContributionRegistration = {
    ...runCommand,
    ...(runCommand.kind === "command" ? { placeId: "core.sidebar.sections" } : {}),
  };

  showPlaces(withPlaces([misplaced]));

  const claim = screen.getByRole("group", { name: "core.sidebar.sections" });

  expect(within(claim).getByText("not applied: commands require an action place")).toBeTruthy();
  expect(within(claim).queryByText("joins the row")).toBeNull();
});

/** Команда без места кнопки не просит, и в разделе занятых мест ей делать нечего. */
it("leaves a command without a place out of the places section", () => {
  const placeless: ContributionRegistration = {
    ...runCommand,
    ...(runCommand.kind === "command" ? { placeId: undefined } : {}),
  };

  showPlaces(withPlaces([placeless]));

  expect(screen.queryByRole("group", { name: "core.view.header.actions" })).toBeNull();
  expect(screen.getByText("command")).toBeTruthy();
});

const page = (declaredId: string): ContributionRegistration => ({
  kind: "page",
  ownership: "plugin",
  pluginKey: "data:example",
  pluginId: "example",
  source: "data",
  id: `example.${declaredId}`,
  declaredId,
  title: "Log",
  export: "LogPage",
});

/**
 * Автоматической записи в левой панели у страницы нет, поэтому список страниц здесь — гарантия,
 * что объявленная страница видна и достижима, а не только заявлена.
 */
it("lists a declared page with its address and opens it", () => {
  const onOpenPage = vi.fn();

  render(
    <PluginDetailView
      state={{ snapshot: withPlaces([page("log")]), stale: false }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={onOpenPage}
      translator={translator}
    />,
  );

  const section = screen.getByRole("region", { name: "Pages" });

  expect(within(section).getByText("/p/example/log")).toBeTruthy();
  fireEvent.click(within(section).getByRole("button", { name: "Open" }));

  expect(onOpenPage).toHaveBeenCalledWith("example", "log");
});

it("shows a switched-off page as switched off instead of offering to open it", () => {
  render(
    <PluginDetailView
      state={{
        snapshot: { ...snapshot, contributions: [], switchedOffContributions: [page("log")] },
        stale: false,
      }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      onOpenPage={vi.fn()}
      translator={translator}
    />,
  );

  const section = screen.getByRole("region", { name: "Pages" });

  expect(within(section).getByText("switched off")).toBeTruthy();
  expect(within(section).queryByRole("button", { name: "Open" })).toBeNull();
});
