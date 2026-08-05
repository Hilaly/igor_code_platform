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
  enablement: { "data:example": { enabled: true, disabledContributions: [] } },
};

it("presents each plugin as one section with a semantic contribution list", () => {
  const onSwitch = vi.fn();
  const { container } = render(
    <PluginsView state={{ snapshot, stale: false }} onSwitch={onSwitch} translator={translator} />,
  );

  const pluginHeading = screen.getByRole("heading", { name: "example" });
  const pluginSection = pluginHeading.closest("section");

  expect(container.querySelectorAll("section")).toHaveLength(1);
  expect(pluginSection).not.toBeNull();
  expect(within(pluginSection!).getAllByRole("listitem")).toHaveLength(1);
  expect(within(pluginSection!).getByText("Running")).toBeTruthy();
  expect(within(pluginSection!).getByText(/\/plugins\/example/)).toBeTruthy();

  const pluginToggle = within(pluginSection!).getByRole("checkbox", { name: "Switched on" });
  const contributionToggle = within(pluginSection!).getByRole("checkbox", {
    name: "Example action",
  });

  expect(pluginToggle).toHaveProperty("checked", true);
  expect(contributionToggle).toHaveProperty("checked", true);

  fireEvent.click(pluginToggle);
  expect(onSwitch).toHaveBeenNthCalledWith(1, "data:example", {
    enabled: false,
    disabledContributions: [],
  });

  fireEvent.click(contributionToggle);
  expect(onSwitch).toHaveBeenNthCalledWith(2, "data:example", {
    enabled: true,
    disabledContributions: ["example.action"],
  });
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
      {
        kind: "event",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.happened",
        declaredId: "happened",
        title: "Example event",
        payloadSchema: { type: "object" },
      },
      {
        kind: "tool",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.echo",
        declaredId: "echo",
        title: "Example tool",
        description: "Says it back",
        parameters: { type: "object", properties: { text: { type: "string" } } },
      },
      {
        kind: "hook",
        ownership: "plugin",
        pluginKey: "data:example",
        pluginId: "example",
        source: "data",
        id: "example.guard",
        declaredId: "guard",
        title: "Example subscription",
        event: "before_session_start",
        criticality: "critical",
      },
    ],
  };

  render(
    <PluginsView
      state={{ snapshot: completeSnapshot, stale: false }}
      onSwitch={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("agent")).toBeTruthy();
  expect(screen.getByText("skill")).toBeTruthy();
  expect(screen.getByText("event")).toBeTruthy();
  expect(screen.getByText("tool")).toBeTruthy();
  expect(screen.getByText("subscription")).toBeTruthy();

  // У подписки видно, куда она вклинивается и чем обойдётся её молчание, у инструмента — что от
  // модели ждут аргументами: без этого человеку нечем решать, выключать вклад или терпеть.
  expect(screen.getByText("before_session_start")).toBeTruthy();
  expect(screen.getByText("critical")).toBeTruthy();
  expect(screen.getByText("Argument schema")).toBeTruthy();
});
