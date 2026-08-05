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

it("presents a compact plugin row and opens the nested detail page", () => {
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
  expect(container.querySelectorAll("section")).toHaveLength(0);
  expect(within(row).getByText("example")).toBeTruthy();
  expect(within(row).getByText("Running")).toBeTruthy();
  expect(within(row).getByText("1 contribution")).toBeTruthy();
  expect(within(row).queryByText("Example action")).toBeNull();

  const pluginToggle = within(row).getByRole("checkbox", { name: "Switched on" });

  expect(pluginToggle).toHaveProperty("checked", true);

  fireEvent.click(pluginToggle);
  expect(onSwitch).toHaveBeenNthCalledWith(1, "data:example", {
    enabled: false,
    disabledContributions: [],
  });

  fireEvent.click(within(row).getByRole("button", { name: "Open" }));
  expect(onOpen).toHaveBeenCalledWith("data:example");
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
