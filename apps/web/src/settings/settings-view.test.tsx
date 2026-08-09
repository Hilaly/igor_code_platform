// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

import { PluginsView } from "../plugins/plugins-view.tsx";
import { initialPluginsState } from "../plugins/state.ts";
import { ProvidersView } from "../providers/providers-view.tsx";
import { initialProvidersState } from "../providers/state.ts";
import { SettingsView } from "./settings-view.tsx";
import { ShellHeaderProvider } from "../shell/header.tsx";

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
      projects={<div>project content</div>}
      appearance={<div>appearance content</div>}
      usage={<div>usage content</div>}
      providers={<div>provider content</div>}
      plugins={<div>plugin content</div>}
      daemon={<div>daemon</div>}
      diagnostics={<div>diagnostics</div>}
      translator={translator}
    />,
  );

  expect(screen.getByRole("navigation", { name: "Разделы настроек" })).toBeTruthy();
  expect(screen.getByText("SETTINGS")).toBeTruthy();
  expect(screen.getByText("◆ Sovereign · Настройки · Провайдеры")).toBeTruthy();
  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1, name: "Провайдеры" })).toBeTruthy();
  expect(screen.getAllByRole("region", { name: "Провайдеры" })).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Провайдеры" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByText("provider content")).toBeTruthy();
  expect(screen.queryByText("appearance content")).toBeNull();
  expect(screen.queryByText("plugin content")).toBeNull();
  expect(screen.queryByText("project content")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Плагины" }));
  expect(onSectionChange).toHaveBeenCalledWith("plugins");

  fireEvent.click(screen.getByRole("button", { name: "Проекты" }));
  expect(onSectionChange).toHaveBeenLastCalledWith("projects");
});

it.each(["64rem", "24rem"])(
  "keeps the approved hierarchy without an embedded duplicate heading at %s",
  (width) => {
    render(
      <div style={{ width }}>
        <ShellHeaderProvider description={{ title: "Провайдеры" }}>
          <SettingsView
            section="providers"
            onSectionChange={vi.fn()}
            projects={<div>project content</div>}
            appearance={<div>appearance content</div>}
            usage={<div>usage content</div>}
            providers={<div>provider content</div>}
            plugins={<div>plugin content</div>}
            daemon={<div>daemon</div>}
            diagnostics={<div>diagnostics</div>}
            translator={translator}
          />
        </ShellHeaderProvider>
      </div>,
    );

    expect(screen.getByText("SETTINGS")).toBeTruthy();
    expect(screen.getByText("◆ Sovereign · Настройки · Провайдеры")).toBeTruthy();
    expect(screen.getByRole("region", { name: "Провайдеры" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Провайдеры" })).toBeNull();
  },
);

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
        projects={<div>project content</div>}
        appearance={<div>appearance content</div>}
        usage={<div>usage content</div>}
        providers={section === "providers" ? content : <div>provider content</div>}
        plugins={section === "plugins" ? content : <div>plugin content</div>}
        daemon={<div>daemon</div>}
        diagnostics={<div>diagnostics</div>}
        translator={translator}
      />,
    );

    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 1, name: heading })).toBeTruthy();
    expect(screen.queryByRole("heading", { level: 2, name: heading })).toBeNull();
  },
);

it("puts a plugin object into the full Settings context chain", () => {
  render(
    <ShellHeaderProvider description={{ title: "Usage insights" }}>
      <SettingsView
        section="plugins"
        detailTitle="Usage insights"
        onSectionChange={vi.fn()}
        projects={<div>project content</div>}
        appearance={<div>appearance content</div>}
        usage={<div>usage content</div>}
        providers={<div>provider content</div>}
        plugins={
          <>
            <h2>Usage insights summary</h2>
            <div>plugin detail content</div>
          </>
        }
        daemon={<div>daemon</div>}
        diagnostics={<div>diagnostics</div>}
        translator={translator}
      />
    </ShellHeaderProvider>,
  );

  expect(screen.getByText("◆ Sovereign · Настройки · Usage insights")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Usage insights" })).toBeNull();
  expect(screen.getByRole("heading", { level: 2, name: "Usage insights summary" })).toBeTruthy();
  expect(screen.getByText("plugin detail content")).toBeTruthy();
});

it("keeps projects selected for both the list and a project detail", () => {
  const { rerender } = render(
    <SettingsView
      section="projects"
      onSectionChange={vi.fn()}
      projects={<div>project list content</div>}
      appearance={<div>appearance content</div>}
      usage={<div>usage content</div>}
      providers={<div>provider content</div>}
      plugins={<div>plugin content</div>}
      daemon={<div>daemon</div>}
      diagnostics={<div>diagnostics</div>}
      translator={translator}
    />,
  );

  expect(screen.getByRole("button", { name: "Проекты" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("heading", { level: 1, name: "Проекты" })).toBeTruthy();
  expect(screen.getByText("project list content")).toBeTruthy();

  rerender(
    <SettingsView
      section="projects"
      detailTitle="Alpha"
      onSectionChange={vi.fn()}
      projects={
        <>
          <h2>Alpha summary</h2>
          <div>project detail content</div>
        </>
      }
      appearance={<div>appearance content</div>}
      usage={<div>usage content</div>}
      providers={<div>provider content</div>}
      plugins={<div>plugin content</div>}
      daemon={<div>daemon</div>}
      diagnostics={<div>diagnostics</div>}
      translator={translator}
    />,
  );

  expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  expect(screen.getByRole("heading", { level: 1, name: "Alpha" })).toBeTruthy();
  expect(screen.getByText("◆ Sovereign · Настройки · Alpha")).toBeTruthy();
  expect(screen.getByRole("heading", { level: 2, name: "Alpha summary" })).toBeTruthy();
  expect(screen.getByText("project detail content")).toBeTruthy();
});
