// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PluginsView } from "../plugins/plugins-view.tsx";
import { initialPluginsState } from "../plugins/state.ts";
import { ProvidersView } from "../providers/providers-view.tsx";
import { initialProvidersState } from "../providers/state.ts";
import { SettingsView } from "./settings-view.tsx";

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

it("shows one selected settings section and only its content", () => {
  const onSectionChange = vi.fn();

  render(
    <SettingsView
      section="providers"
      onSectionChange={onSectionChange}
      appearance={<div>appearance content</div>}
      providers={<div>provider content</div>}
      plugins={<div>plugin content</div>}
      daemon={<div>daemon</div>}
      diagnostics={<div>diagnostics</div>}
      translator={translator}
    />,
  );

  expect(screen.getByRole("navigation", { name: "Разделы настроек" })).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1, name: "Провайдеры" })).toBeTruthy();
  expect(screen.getAllByRole("region", { name: "Провайдеры" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Провайдеры" }).getAttribute("aria-current")).toBe(
    "true",
  );
  expect(screen.getByText("provider content")).toBeTruthy();
  expect(screen.queryByText("appearance content")).toBeNull();
  expect(screen.queryByText("plugin content")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Плагины" }));
  expect(onSectionChange).toHaveBeenCalledWith("plugins");
});

it.each([
  {
    section: "providers" as const,
    heading: "Провайдеры",
    content: (
      <ProvidersView
        headingLevel={2}
        state={initialProvidersState}
        providerId={undefined}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn(async () => undefined)}
        onRefresh={vi.fn(async () => undefined)}
        onBack={vi.fn()}
        onLogIn={vi.fn()}
        onAnswer={vi.fn()}
        onCancelLogin={vi.fn()}
        onCloseLogin={vi.fn()}
        onLogOut={vi.fn()}
        translator={translator}
      />
    ),
  },
  {
    section: "plugins" as const,
    heading: "Плагины",
    content: (
      <PluginsView
        headingLevel={2}
        state={initialPluginsState}
        onSwitch={vi.fn()}
        translator={translator}
      />
    ),
  },
])(
  "keeps one page heading when real $section content is embedded",
  ({ section, heading, content }) => {
    render(
      <SettingsView
        section={section}
        onSectionChange={vi.fn()}
        appearance={<div>appearance content</div>}
        providers={section === "providers" ? content : <div>provider content</div>}
        plugins={section === "plugins" ? content : <div>plugin content</div>}
        daemon={<div>daemon</div>}
        diagnostics={<div>diagnostics</div>}
        translator={translator}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: heading })).toBeTruthy();
  },
);
