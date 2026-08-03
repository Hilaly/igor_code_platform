// @vitest-environment jsdom

import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

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

it("renders providers and plugins as settings sections", () => {
  render(
    <SettingsView
      section="providers"
      onSectionChange={vi.fn()}
      appearance={<div>appearance</div>}
      providers={<div>provider content</div>}
      plugins={<div>plugin content</div>}
      daemon={<div>daemon</div>}
      diagnostics={<div>diagnostics</div>}
      translator={translator}
    />,
  );
  expect(screen.getByText("provider content")).toBeTruthy();
  expect(screen.getAllByText("Провайдеры")).toHaveLength(2);
  expect(screen.getByText("Плагины")).toBeTruthy();
});
