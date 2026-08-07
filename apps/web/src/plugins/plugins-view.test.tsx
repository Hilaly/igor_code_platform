// @vitest-environment jsdom

import type { PluginsSnapshot } from "@sovereign/protocol";
import { coreEnglish, coreNamespace, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PluginsView } from "./plugins-view.tsx";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

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
    },
  ],
  contributions: [
    {
      kind: "custom",
      ownership: "plugin",
      pluginKey: "data:example",
      pluginId: "example",
      source: "data",
      id: "example.action",
      declaredId: "action",
      title: "Example action",
    },
  ],
  switchedOffContributions: [],
  conflicts: [],
  routeConflicts: [],
  enablement: { "data:example": { enabled: true, disabledContributions: [] } },
};

it("opens the nested detail from the whole compact row but keeps its toggle independent", () => {
  const onSwitch = vi.fn();
  const onOpen = vi.fn();
  const { container } = render(
    <PluginsView
      state={{ snapshot, stale: false }}
      onSwitch={onSwitch}
      onOpen={onOpen}
      translator={translator}
    />,
  );

  const row = screen.getByRole("listitem");
  expect(within(row).getByRole("group", { name: "example" })).toBeTruthy();
  expect(container.querySelectorAll("section")).toHaveLength(0);
  expect(within(row).getByText("example")).toBeTruthy();
  expect(within(row).getByText("Running")).toBeTruthy();
  expect(within(row).getByText("1 contribution")).toBeTruthy();
  expect(within(row).queryByText("Example action")).toBeNull();
  expect(within(row).queryByText("Open")).toBeNull();

  const pluginToggle = within(row).getByRole("checkbox", { name: "Switched on" });

  expect(pluginToggle).toHaveProperty("checked", true);
  expect(within(row).getByRole("tooltip", { name: "Switched on" })).toBeTruthy();
  expect(
    pluginToggle.closest("label")?.querySelector('[class*="visuallyHidden"]')?.textContent,
  ).toBe("Switched on");

  fireEvent.click(pluginToggle);
  expect(onSwitch).toHaveBeenNthCalledWith(1, "data:example", {
    enabled: false,
    disabledContributions: [],
  });
  expect(onOpen).not.toHaveBeenCalled();

  fireEvent.click(within(row).getByRole("button", { name: "Open example" }));
  expect(onOpen).toHaveBeenCalledWith("data:example");
});

it("keeps plugin warnings in one flat notice band above the rows", () => {
  const withWarnings: PluginsSnapshot = {
    ...snapshot,
    conflicts: [{ id: "example.action", source: "data", plugins: ["data:example", "data:other"] }],
  };

  const { container } = render(
    <PluginsView
      state={{ snapshot: withWarnings, stale: true, failure: "write failed" }}
      onSwitch={vi.fn()}
      onOpen={vi.fn()}
      translator={translator}
    />,
  );

  const notices = container.querySelector(".plugins-notices");
  expect(notices).not.toBeNull();
  expect(notices?.querySelectorAll('[role="alert"]')).toHaveLength(3);
  expect(notices?.nextElementSibling?.getAttribute("role")).toBe("list");
});

it("labels every shipped contribution kind without reporting a missing translation", () => {
  const completeSnapshot: PluginsSnapshot = {
    ...snapshot,
    contributions: [
      ...snapshot.contributions,
      {
        kind: "agent",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.agent",
        declaredId: "agent",
        title: "Example agent",
        instructions: "Work carefully.",
        tools: { include: ["*"], exclude: [] },
        skills: { include: ["*"], exclude: [] },
      },
      {
        kind: "skill",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.skill",
        declaredId: "skill",
        title: "Example skill",
        name: "example-skill",
        location: "/plugins/example/skills/example",
        disableModelInvocation: false,
      },
    ],
  };

  render(
    <PluginsView
      state={{ snapshot: completeSnapshot, stale: false }}
      onSwitch={vi.fn()}
      onOpen={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("3 contributions")).toBeTruthy();
});

it("collects the routes open to the outside in one place", () => {
  const withRoutes: PluginsSnapshot = {
    ...snapshot,
    contributions: [
      ...snapshot.contributions,
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.github-webhook",
        declaredId: "github-webhook",
        method: "POST",
        path: "webhooks/github",
      },
      {
        kind: "route",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.board",
        declaredId: "board",
        method: "GET",
        path: "board",
      },
    ],
    switchedOffContributions: [
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.switched-off",
        declaredId: "switched-off",
        method: "POST",
        path: "webhooks/other",
      },
    ],
  };

  render(
    <PluginsView
      state={{ snapshot: withRoutes, stale: false }}
      onSwitch={vi.fn()}
      onOpen={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("Open to the outside")).toBeTruthy();
  expect(screen.getByText("POST /p/example/webhooks/github — example.github-webhook")).toBeTruthy();
  // Обычный маршрут наружу не открыт, а выключенный публичный не отвечает вовсе: ни того, ни
  // другого в списке открытого быть не должно.
  expect(screen.queryByText(/\/p\/example\/board/)).toBeNull();
  expect(screen.queryByText(/webhooks\/other/)).toBeNull();
});

it("does not list a public route whose address is conflicted", () => {
  const withConflict: PluginsSnapshot = {
    ...snapshot,
    contributions: [
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.first",
        declaredId: "first",
        method: "POST",
        path: "hooks/github",
      },
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.second",
        declaredId: "second",
        method: "POST",
        path: "hooks/github",
      },
    ],
    routeConflicts: [
      {
        method: "POST",
        path: "hooks/github",
        contributions: ["example.first", "example.second"],
        pluginKeys: ["data:example", "data:example"],
      },
    ],
  };

  render(
    <PluginsView
      state={{ snapshot: withConflict, stale: false }}
      onSwitch={vi.fn()}
      onOpen={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.queryByText(/POST \/p\/example\/hooks\/github/)).toBeNull();
  expect(screen.getByText("Routes not applied")).toBeTruthy();
});

it("keeps same-id routes from different project sources distinct", () => {
  const withSameId: PluginsSnapshot = {
    ...snapshot,
    contributions: [
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "project:p1:example",
        pluginId: "example",
        source: "project:p1",
        id: "example.hook",
        declaredId: "hook",
        method: "POST",
        path: "hooks/p1",
      },
      {
        kind: "public-route",
        ownership: "plugin",
        pluginKey: "project:p2:example",
        pluginId: "example",
        source: "project:p2",
        id: "example.hook",
        declaredId: "hook",
        method: "POST",
        path: "hooks/p2",
      },
    ],
  };

  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  render(
    <PluginsView
      state={{ snapshot: withSameId, stale: false }}
      onSwitch={vi.fn()}
      onOpen={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("POST /p/example/hooks/p1 — example.hook")).toBeTruthy();
  expect(screen.getByText("POST /p/example/hooks/p2 — example.hook")).toBeTruthy();
  expect(error).not.toHaveBeenCalledWith(expect.stringContaining("same key"));
  error.mockRestore();
});
