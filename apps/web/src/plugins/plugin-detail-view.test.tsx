// @vitest-environment jsdom

import type { PluginsSnapshot } from "@sovereign/protocol";
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
  const { container } = render(
    <PluginDetailView
      state={{ snapshot, stale: false }}
      pluginKey="data:example"
      onBack={onBack}
      onSwitch={onSwitch}
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
      translator={translator}
    />,
  );
  expect(screen.getByText(/not found/i)).toBeTruthy();
});

it("keeps stale and write-failure notices visible on the detail route", () => {
  render(
    <PluginDetailView
      state={{ snapshot, stale: true, failure: "write failed" }}
      pluginKey="data:example"
      onBack={vi.fn()}
      onSwitch={vi.fn()}
      translator={translator}
    />,
  );

  expect(screen.getByText("What you see may be out of date")).toBeTruthy();
  expect(screen.getByText(/state is being requested again/i)).toBeTruthy();
  expect(screen.getByText("The choice was not written: write failed")).toBeTruthy();
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
      translator={translator}
    />,
  );

  expect(screen.getByText("public route")).toBeTruthy();
  expect(screen.getByText(/"path": "webhooks\/github"/)).toBeTruthy();
  // Адрес целиком: по нему маршрут зовут снаружи, а объявленный путь без префикса не набрать.
  expect(screen.getByText(/\/p\/example\/webhooks\/github/)).toBeTruthy();
});
