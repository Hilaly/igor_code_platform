// @vitest-environment jsdom

import type { ContributionRegistration } from "@sovereign/protocol";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";

import { BrowserRuntimeProvider } from "./host.tsx";
import { useTranslator } from "./i18n.ts";

afterEach(cleanup);

function catalog(locale: string, messages: Record<string, string>): ContributionRegistration {
  return {
    ownership: "plugin",
    kind: "locale-catalog",
    id: `mission.messages-${locale}`,
    declaredId: `messages-${locale}`,
    pluginKey: "builtin:mission",
    pluginId: "mission",
    source: "builtin",
    namespace: "mission",
    locale,
    messages,
  };
}

const english = catalog("en", { "panel.title": "Mission", "panel.empty": "No mission" });
const russian = catalog("ru", { "panel.title": "Миссия" });

function Panel() {
  const translator = useTranslator("mission");

  return (
    <>
      <p>{translator.t("panel.title")}</p>
      <p>{translator.t("panel.empty")}</p>
      <p>{translator.formatDate(new Date("2026-08-16T12:30:00.000Z"), { dateStyle: "medium" })}</p>
    </>
  );
}

function mount(locale: string, complaints: string[] = []) {
  return render(
    <BrowserRuntimeProvider
      contributions={[english, russian]}
      plugins={[]}
      onDiagnostic={(text) => complaints.push(text)}
      events={{ subscribe: () => () => {} }}
      locale={locale}
      createCache={createCache}
    >
      <Panel />
    </BrowserRuntimeProvider>,
  );
}

/**
 * Каталог доезжает снимком, а не бандлом: строки объявляет воркер, и браузерная половина плагина о
 * них ничего не знает.
 */
it("speaks the language of the window with the catalogues of the snapshot", () => {
  mount("ru");

  expect(screen.getByText("Миссия")).toBeTruthy();
  // Дата — того же языка, что и строки: своя `Intl` взяла бы локаль браузера.
  expect(screen.getByText("16 авг. 2026 г.")).toBeTruthy();
});

it("shows the base string of an untranslated key and says the hole is there", () => {
  const complaints: string[] = [];
  mount("ru", complaints);

  expect(screen.getByText("No mission")).toBeTruthy();
  expect(complaints.join("\n")).toMatch(/mission:ru has no translation for panel.empty/u);
});

it("refuses to work outside the runtime provider", () => {
  expect(() => render(<Panel />)).toThrow(/BrowserRuntimeProvider/u);
});

function createCache() {
  return {
    load: () => ({ kind: "loading" as const }),
    peek: () => undefined,
    version: () => 0,
    retain: () => {},
    subscribe: () => () => {},
    dispose: () => {},
  };
}
